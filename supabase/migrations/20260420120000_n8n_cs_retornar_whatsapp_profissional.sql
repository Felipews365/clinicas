-- Atualiza n8n_cs_agendar, n8n_cs_reagendar e n8n_cs_cancelar para retornar
-- profissional_whatsapp no JSON de resposta. O agente usa esse valor para
-- notificar o profissional via cs_notificar_profissional (Evolution API).
--
-- A ligação é: cs_profissionais.id ← professionals.cs_profissional_id
-- Se o profissional não tiver whatsapp cadastrado no painel, retorna null
-- e o agente pula a notificação.

-- ─── n8n_cs_agendar ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.n8n_cs_agendar(
  p_nome_cliente    text,
  p_telefone        text,
  p_profissional_id uuid,
  p_servico_id      uuid,
  p_data            date,
  p_horario         time,
  p_observacoes     text default ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id        uuid;
  v_ag_id             uuid;
  v_updated           int;
  v_nome_prof         text;
  v_nome_serv         text;
  v_nome_cli          text;
  v_clinic_id         uuid;
  v_servico_id_fk     uuid;
  v_prof_whatsapp     text;
BEGIN
  v_nome_cli := trim(p_nome_cliente);

  -- Resolve profissional + whatsapp do painel
  SELECT csp.nome, csp.clinic_id, prof.whatsapp
  INTO   v_nome_prof, v_clinic_id, v_prof_whatsapp
  FROM   public.cs_profissionais csp
  LEFT JOIN public.professionals prof
    ON prof.cs_profissional_id = csp.id
    AND prof.clinic_id = csp.clinic_id
  WHERE  csp.id = p_profissional_id;

  IF v_nome_prof IS NULL THEN
    RAISE EXCEPTION 'profissional_id inválido: %', p_profissional_id;
  END IF;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'profissional sem clinic_id — associe-o a uma clínica antes de agendar';
  END IF;

  -- Resolve serviço: tenta clinic_procedures (v2 — painel atual) primeiro
  SELECT p.name INTO v_nome_serv
  FROM   public.clinic_procedures p
  WHERE  p.id = p_servico_id
    AND  p.clinic_id = v_clinic_id;

  IF v_nome_serv IS NOT NULL THEN
    v_servico_id_fk := NULL;
  ELSE
    SELECT s.nome INTO v_nome_serv
    FROM   public.cs_servicos s
    WHERE  s.id = p_servico_id;

    IF v_nome_serv IS NOT NULL THEN
      v_servico_id_fk := p_servico_id;
    END IF;
  END IF;

  IF v_nome_serv IS NULL THEN
    RAISE EXCEPTION 'servico_id inválido: % — não encontrado em clinic_procedures nem em cs_servicos', p_servico_id;
  END IF;

  -- Bloqueia o slot
  UPDATE public.cs_horarios_disponiveis
  SET disponivel = false
  WHERE profissional_id = p_profissional_id
    AND data    = p_data
    AND horario = p_horario
    AND disponivel = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'horario_indisponivel',
      'message', 'Este horário não está disponível. Consulte as vagas antes de agendar.'
    );
  END IF;

  -- Upsert cliente
  INSERT INTO public.cs_clientes(nome, telefone, clinic_id)
  VALUES (v_nome_cli, p_telefone, v_clinic_id)
  ON CONFLICT (clinic_id, telefone) WHERE clinic_id IS NOT NULL
  DO UPDATE SET nome = excluded.nome, updated_at = now()
  RETURNING id INTO v_cliente_id;

  -- Cria agendamento
  INSERT INTO public.cs_agendamentos(
    cliente_id, profissional_id, servico_id,
    data_agendamento, horario, status, observacoes,
    nome_cliente, nome_profissional, nome_procedimento,
    clinic_id
  )
  VALUES (
    v_cliente_id, p_profissional_id, v_servico_id_fk,
    p_data, p_horario, 'confirmado', coalesce(nullif(trim(p_observacoes), ''), ''),
    v_nome_cli, v_nome_prof, v_nome_serv,
    v_clinic_id
  )
  RETURNING id INTO v_ag_id;

  -- Atualiza CRM se disponível
  IF public.crm_clinic_has_access(v_clinic_id) THEN
    UPDATE public.cs_clientes c
    SET
      status_funil        = 'agendado'::public.crm_status_funil,
      data_ultimo_contato = now()
    WHERE c.id       = v_cliente_id
      AND c.clinic_id = v_clinic_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'agendamento_id',      v_ag_id,
    'cliente_id',          v_cliente_id,
    'profissional_whatsapp', v_prof_whatsapp
  );
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO anon;


-- ─── n8n_cs_reagendar ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.n8n_cs_reagendar(
  p_agendamento_id       uuid,
  p_nova_data            date,
  p_novo_horario         time,
  p_novo_profissional_id uuid,
  p_profissional_antigo_id uuid,
  p_data_antiga          date,
  p_horario_antigo       time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome_prof     text;
  v_same_slot     boolean;
  v_booked        int;
  v_clinic_id     uuid;
  v_prof_whatsapp text;
BEGIN
  -- Resolve profissional + whatsapp do painel
  SELECT csp.nome, csp.clinic_id, prof.whatsapp
  INTO   v_nome_prof, v_clinic_id, v_prof_whatsapp
  FROM   public.cs_profissionais csp
  LEFT JOIN public.professionals prof
    ON prof.cs_profissional_id = csp.id
    AND prof.clinic_id = csp.clinic_id
  WHERE  csp.id = p_novo_profissional_id;

  IF v_nome_prof IS NULL THEN
    RAISE EXCEPTION 'p_novo_profissional_id inválido: %', p_novo_profissional_id;
  END IF;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'profissional sem clinic_id (associar à clínica antes de reagendar)';
  END IF;

  v_same_slot :=
    p_novo_profissional_id = p_profissional_antigo_id
    AND p_nova_data = p_data_antiga
    AND p_novo_horario = p_horario_antigo;

  IF v_same_slot THEN
    UPDATE public.cs_agendamentos
    SET
      clinic_id     = coalesce(clinic_id, v_clinic_id),
      atualizado_em = now()
    WHERE id = p_agendamento_id;

    RETURN jsonb_build_object(
      'ok',                  true,
      'agendamento_id',      p_agendamento_id,
      'profissional_whatsapp', v_prof_whatsapp
    );
  END IF;

  -- Bloqueia novo slot
  UPDATE public.cs_horarios_disponiveis
  SET disponivel = false
  WHERE profissional_id = p_novo_profissional_id
    AND data    = p_nova_data
    AND horario = p_novo_horario
    AND disponivel = true;

  GET DIAGNOSTICS v_booked = ROW_COUNT;
  IF v_booked = 0 THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'horario_indisponivel',
      'message', 'O novo horário não está disponível. Consulte as vagas antes de reagendar.'
    );
  END IF;

  -- Libera slot antigo
  UPDATE public.cs_horarios_disponiveis
  SET disponivel = true
  WHERE profissional_id = p_profissional_antigo_id
    AND data    = p_data_antiga
    AND horario = p_horario_antigo;

  -- Atualiza agendamento
  UPDATE public.cs_agendamentos
  SET
    data_agendamento  = p_nova_data,
    horario           = p_novo_horario,
    profissional_id   = p_novo_profissional_id,
    nome_profissional = v_nome_prof,
    status            = 'reagendado',
    clinic_id         = v_clinic_id,
    atualizado_em     = now()
  WHERE id = p_agendamento_id;

  RETURN jsonb_build_object(
    'ok',                  true,
    'agendamento_id',      p_agendamento_id,
    'profissional_whatsapp', v_prof_whatsapp
  );
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time) TO anon;


-- ─── n8n_cs_cancelar ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.n8n_cs_cancelar(
  p_agendamento_id  uuid,
  p_profissional_id uuid,
  p_data            date,
  p_horario         time,
  p_motivo          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prof_whatsapp text;
BEGIN
  -- Busca whatsapp do profissional via painel
  SELECT prof.whatsapp
  INTO   v_prof_whatsapp
  FROM   public.cs_profissionais csp
  LEFT JOIN public.professionals prof
    ON prof.cs_profissional_id = csp.id
    AND prof.clinic_id = csp.clinic_id
  WHERE  csp.id = p_profissional_id;

  -- Cancela agendamento
  UPDATE public.cs_agendamentos
  SET
    status              = 'cancelado',
    motivo_cancelamento = p_motivo,
    atualizado_em       = now()
  WHERE id = p_agendamento_id;

  -- Libera slot
  UPDATE public.cs_horarios_disponiveis
  SET disponivel = true
  WHERE profissional_id = p_profissional_id
    AND data    = p_data
    AND horario = p_horario;

  RETURN jsonb_build_object(
    'ok',                  true,
    'agendamento_id',      p_agendamento_id,
    'profissional_whatsapp', v_prof_whatsapp
  );
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO anon;
