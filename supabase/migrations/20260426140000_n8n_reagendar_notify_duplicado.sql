-- Impede cs_agendar duplicado (mesmo cliente + profissional + dia) — causa dois AGEND. no painel
-- quando o agente devia usar cs_reagendar.
-- Reforça cs_reagendar: libertar slot antigo com date_trunc(minute) e cancelar duplicados órfãos no slot antigo.

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
  v_existing_id       uuid;
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

  INSERT INTO public.cs_clientes(nome, telefone, clinic_id)
  VALUES (v_nome_cli, p_telefone, v_clinic_id)
  ON CONFLICT (clinic_id, telefone) WHERE clinic_id IS NOT NULL
  DO UPDATE SET nome = excluded.nome, updated_at = now()
  RETURNING id INTO v_cliente_id;

  SELECT a.id
  INTO v_existing_id
  FROM public.cs_agendamentos a
  WHERE a.cliente_id = v_cliente_id
    AND coalesce(a.clinic_id, v_clinic_id) = v_clinic_id
    AND a.profissional_id = p_profissional_id
    AND a.data_agendamento = p_data
    AND a.status NOT IN ('cancelado', 'concluido')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'ja_existe_agendamento_mesmo_dia',
      'message',
      'Este cliente já tem consulta neste dia com este profissional. Use cs_reagendar com o agendamento_id para mudar horário — não chame cs_agendar de novo.',
      'agendamento_id', v_existing_id
    );
  END IF;

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
  v_cur_prof      uuid;
  v_cur_date      date;
  v_cur_time      time;
  v_cliente_id    uuid;
  v_ag_upd        int;
BEGIN
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

  SELECT a.profissional_id, a.data_agendamento, a.horario, a.cliente_id
  INTO v_cur_prof, v_cur_date, v_cur_time, v_cliente_id
  FROM public.cs_agendamentos a
  WHERE a.id = p_agendamento_id
    AND a.status NOT IN ('cancelado', 'concluido');

  IF NOT FOUND OR v_cur_prof IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'agendamento_nao_encontrado',
      'message', 'Agendamento inexistente ou já cancelado/concluído.'
    );
  END IF;

  v_same_slot :=
    p_novo_profissional_id = v_cur_prof
    AND p_nova_data = v_cur_date
    AND p_novo_horario = v_cur_time;

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

  UPDATE public.cs_horarios_disponiveis
  SET disponivel = true
  WHERE profissional_id = v_cur_prof
    AND data    = v_cur_date
    AND date_trunc('minute', horario) = date_trunc('minute', v_cur_time);

  UPDATE public.cs_agendamentos
  SET
    data_agendamento  = p_nova_data,
    horario           = p_novo_horario,
    profissional_id   = p_novo_profissional_id,
    nome_profissional = v_nome_prof,
    status            = 'reagendado',
    clinic_id         = v_clinic_id,
    atualizado_em     = now()
  WHERE id = p_agendamento_id
    AND status NOT IN ('cancelado', 'concluido');

  GET DIAGNOSTICS v_ag_upd = ROW_COUNT;
  IF v_ag_upd <> 1 THEN
    RAISE EXCEPTION 'n8n_cs_reagendar: falha ao atualizar agendamento %', p_agendamento_id;
  END IF;

  UPDATE public.cs_agendamentos d
  SET
    status        = 'cancelado',
    atualizado_em = now()
  WHERE d.clinic_id = v_clinic_id
    AND d.cliente_id = v_cliente_id
    AND d.id <> p_agendamento_id
    AND d.status NOT IN ('cancelado', 'concluido')
    AND d.profissional_id = v_cur_prof
    AND d.data_agendamento = v_cur_date
    AND date_trunc('minute', d.horario) = date_trunc('minute', v_cur_time);

  RETURN jsonb_build_object(
    'ok',                  true,
    'agendamento_id',      p_agendamento_id,
    'profissional_whatsapp', v_prof_whatsapp
  );
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO anon;

REVOKE ALL ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time) TO anon;

-- Janela um pouco maior para o Code auto-notify após respostas longas do agente
CREATE OR REPLACE FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(
  p_clinic_id uuid,
  p_telefone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits      text;
  v_cliente_id  uuid;
  v_ag_id       uuid;
  v_prof_id     uuid;
  v_atual       timestamptz;
  v_status      text;
  v_whatsapp    text;
BEGIN
  IF p_clinic_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clinic_id_obrigatorio');
  END IF;

  v_digits := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  IF v_digits = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'telefone_invalido');
  END IF;

  SELECT c.id
  INTO v_cliente_id
  FROM public.cs_clientes c
  WHERE c.clinic_id = p_clinic_id
    AND (
      regexp_replace(c.telefone, '\D', '', 'g') = v_digits
      OR regexp_replace(c.telefone, '\D', '', 'g') = right(v_digits, 11)
      OR regexp_replace(c.telefone, '\D', '', 'g') = ('55' || right(v_digits, 11))
      OR regexp_replace(c.telefone, '\D', '', 'g') = right(('55' || v_digits), 13)
    )
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_cliente_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cliente_nao_encontrado');
  END IF;

  SELECT a.id, a.profissional_id, a.atualizado_em, a.status
  INTO v_ag_id, v_prof_id, v_atual, v_status
  FROM public.cs_agendamentos a
  WHERE a.clinic_id = p_clinic_id
    AND a.cliente_id = v_cliente_id
    AND a.atualizado_em >= (now() - interval '45 minutes')
  ORDER BY a.atualizado_em DESC
  LIMIT 1;

  IF v_ag_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem_mudanca_recente');
  END IF;

  SELECT prof.whatsapp
  INTO v_whatsapp
  FROM public.cs_profissionais csp
  LEFT JOIN public.professionals prof
    ON prof.cs_profissional_id = csp.id
    AND prof.clinic_id = csp.clinic_id
  WHERE csp.id = v_prof_id;

  RETURN jsonb_build_object(
    'ok', true,
    'agendamento_id', v_ag_id,
    'profissional_whatsapp', v_whatsapp,
    'status_agendamento', v_status,
    'atualizado_em', v_atual
  );
END;
$$;

COMMENT ON FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(uuid, text) IS
  'Usado pelo n8n (Code após agente_agendador): devolve WhatsApp do profissional do agendamento alterado nos últimos 45 min.';

REVOKE ALL ON FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(uuid, text) TO service_role;
