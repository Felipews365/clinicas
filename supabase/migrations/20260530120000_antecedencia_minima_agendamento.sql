-- Antecedência mínima de agendamento por clínica (SaaS multi-tenant).
-- Lê `agent_instructions->>'antecedencia_minima_minutos'` (default 30 min).
-- Aplica-se a: consultar_vagas (cutoff de hoje), agendar, reagendar (só agente), cancelar.
-- Reagendamentos pelo painel (p_mutacao_origem = 'painel') ignoram a regra.

-- ---------------------------------------------------------------------------
-- Helper único reutilizado pelas 4 RPCs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._clinic_antecedencia_minutos(p_clinic_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(
      CASE
        WHEN jsonb_typeof(agent_instructions::jsonb) = 'object'
          THEN (agent_instructions::jsonb)->>'antecedencia_minima_minutos'
        ELSE NULL
      END,
      ''
    )::integer,
    30
  )
  FROM public.clinics
  WHERE id = p_clinic_id;
$$;

COMMENT ON FUNCTION public._clinic_antecedencia_minutos(uuid) IS
  'Antecedência mínima (minutos) configurada em clinics.agent_instructions. Default 30.';

-- ---------------------------------------------------------------------------
-- n8n_cs_consultar_vagas: cutoff = now() + antecedência (para data=hoje).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.n8n_cs_consultar_vagas(
  p_clinic_id uuid,
  p_data date,
  p_profissional_id text DEFAULT NULL,
  p_clinic_procedure_id text DEFAULT NULL,
  p_procedimento_nome text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic int[];
  v_proc uuid;
  v_prof uuid;
  v_nom text;
  v_dur int := 60;
  v_cutoff_time time;
  v_antec int;
BEGIN
  IF p_clinic_id IS NULL OR p_data IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_antec := public._clinic_antecedencia_minutos(p_clinic_id);

  IF p_data = CURRENT_DATE THEN
    v_cutoff_time := ((NOW() AT TIME ZONE 'America/Sao_Paulo')
                      + (v_antec || ' minutes')::interval)::time;
  ELSE
    v_cutoff_time := '00:00:00'::time;
  END IF;

  v_prof := NULL;
  IF p_profissional_id IS NOT NULL AND btrim(p_profissional_id) <> ''
    AND lower(btrim(p_profissional_id)) <> 'null' THEN
    BEGIN
      v_prof := btrim(p_profissional_id)::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        v_prof := NULL;
    END;
  END IF;

  v_proc := NULL;
  IF p_clinic_procedure_id IS NOT NULL AND btrim(p_clinic_procedure_id) <> ''
    AND lower(btrim(p_clinic_procedure_id)) <> 'null' THEN
    BEGIN
      v_proc := btrim(p_clinic_procedure_id)::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        v_proc := NULL;
    END;
  END IF;

  IF v_proc IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clinic_procedures c
    WHERE c.id = v_proc AND c.clinic_id = p_clinic_id
  ) THEN
    v_proc := NULL;
  END IF;

  v_nom := nullif(trim(p_procedimento_nome), '');

  IF v_proc IS NULL AND v_nom IS NOT NULL THEN
    SELECT cp.id INTO v_proc
    FROM public.clinic_procedures cp
    WHERE cp.clinic_id = p_clinic_id
      AND cp.is_active = true
      AND (
        lower(trim(cp.name)) = lower(v_nom)
        OR lower(cp.name) LIKE '%' || lower(v_nom) || '%'
      )
    ORDER BY
      CASE WHEN lower(trim(cp.name)) = lower(v_nom) THEN 0 ELSE 1 END,
      length(trim(cp.name))
    LIMIT 1;
  END IF;

  IF v_proc IS NOT NULL THEN
    SELECT cp.duration_minutes INTO v_dur
    FROM public.clinic_procedures cp
    WHERE cp.id = v_proc AND cp.clinic_id = p_clinic_id;
    IF v_dur IS NULL OR v_dur < 1 THEN v_dur := 60; END IF;
  END IF;

  IF v_prof IS NOT NULL AND v_proc IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.professionals pr
      WHERE pr.clinic_id = p_clinic_id
        AND pr.cs_profissional_id = v_prof
        AND COALESCE(pr.is_active, true) = true
        AND EXISTS (
          SELECT 1 FROM public.professional_procedures pp1
          WHERE pp1.professional_id = pr.id AND pp1.clinic_procedure_id = v_proc
        )
    ) THEN
      v_prof := NULL;
    END IF;
  END IF;

  v_clinic := public.clinic_hours_for_date(p_clinic_id, p_data);
  IF v_clinic IS NULL OR cardinality(v_clinic) = 0 THEN RETURN '[]'::jsonb; END IF;

  INSERT INTO public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel, bloqueio_manual)
  SELECT p.id, p_data, make_time(s.h::int, 0, 0), true, false
  FROM public.cs_profissionais p
  INNER JOIN public.professionals pr
    ON pr.cs_profissional_id = p.id
    AND pr.clinic_id = p_clinic_id
    AND COALESCE(pr.is_active, true) = true
  CROSS JOIN LATERAL unnest(public.cs_prof_panel_hours_for_prof_date(p_clinic_id, p.id, p_data)) AS s(h)
  WHERE p.ativo = true AND p.clinic_id = p_clinic_id AND s.h BETWEEN 6 AND 22
    AND (v_prof IS NULL OR p.id = v_prof)
    AND (
      v_proc IS NULL
      OR EXISTS (
        SELECT 1 FROM public.professional_procedures pp1
        WHERE pp1.professional_id = pr.id AND pp1.clinic_procedure_id = v_proc
      )
    )
  ON CONFLICT (profissional_id, data, horario) DO NOTHING;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'horario_id', h.id,
      'data', to_char(h.data, 'DD/MM/YYYY'),
      'dia_semana', trim(to_char(h.data, 'Day')),
      'horario', to_char(h.horario, 'HH24:MI'),
      'profissional_id', p.id,
      'profissional', p.nome,
      'especialidade', p.especialidade,
      'duracao_consulta_minutos', CASE WHEN v_proc IS NOT NULL THEN v_dur ELSE NULL END
    ) ORDER BY h.horario)
    FROM public.cs_horarios_disponiveis h
    INNER JOIN public.cs_profissionais p ON p.id = h.profissional_id
    INNER JOIN public.professionals pr
      ON pr.cs_profissional_id = p.id
      AND pr.clinic_id = p_clinic_id
      AND COALESCE(pr.is_active, true) = true
    WHERE p.clinic_id = p_clinic_id
      AND h.data = p_data
      AND p.ativo = true
      AND coalesce(h.disponivel, true) = true
      AND coalesce(h.bloqueio_manual, false) = false
      AND h.horario >= v_cutoff_time
      AND NOT EXISTS (
        SELECT 1 FROM public.cs_agendamentos a
        WHERE a.profissional_id = h.profissional_id
          AND a.data_agendamento = h.data
          AND a.status NOT IN ('cancelado', 'concluido')
          AND coalesce(a.clinic_id, p.clinic_id) = p_clinic_id
          AND (a.data_agendamento + a.horario) < (h.data + h.horario) + (v_dur || ' minutes')::interval
          AND (a.data_agendamento + a.horario) + (coalesce(a.duracao_minutos, 60) || ' minutes')::interval > (h.data + h.horario)
      )
      AND (v_prof IS NULL OR p.id = v_prof)
      AND (
        v_proc IS NULL
        OR EXISTS (
          SELECT 1 FROM public.professional_procedures pp1
          WHERE pp1.professional_id = pr.id AND pp1.clinic_procedure_id = v_proc
        )
      )
      AND EXTRACT(hour FROM h.horario)::integer = ANY(public.cs_prof_panel_hours_for_prof_date(p_clinic_id, p.id, p_data))
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- n8n_cs_agendar: bloqueia se alvo < now() + antecedência da clínica.
-- ---------------------------------------------------------------------------
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
  v_dur_min           int := 60;
  v_antec             int;
  v_alvo              timestamptz;
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

  -- Validação de antecedência mínima (clínica).
  v_antec := public._clinic_antecedencia_minutos(v_clinic_id);
  v_alvo  := ((p_data + p_horario)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  IF v_alvo < (NOW() + (v_antec || ' minutes')::interval) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'antecedencia_minima',
      'antecedencia_minutos', v_antec,
      'message', 'O horário escolhido está dentro da janela mínima de antecedência da clínica.'
    );
  END IF;

  SELECT p.name, p.duration_minutes
  INTO   v_nome_serv, v_dur_min
  FROM   public.clinic_procedures p
  WHERE  p.id = p_servico_id
    AND  p.clinic_id = v_clinic_id;

  IF v_nome_serv IS NOT NULL THEN
    v_servico_id_fk := NULL;
    IF v_dur_min IS NULL OR v_dur_min < 1 THEN
      v_dur_min := 60;
    END IF;
  ELSE
    SELECT s.nome INTO v_nome_serv
    FROM   public.cs_servicos s
    WHERE  s.id = p_servico_id;

    IF v_nome_serv IS NOT NULL THEN
      v_servico_id_fk := p_servico_id;
      v_dur_min := 60;
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

  UPDATE public.cs_horarios_disponiveis h
  SET disponivel = false
  WHERE h.profissional_id = p_profissional_id
    AND h.data = p_data
    AND h.disponivel = true
    AND (h.data + h.horario) < (p_data + p_horario) + (v_dur_min || ' minutes')::interval
    AND (h.data + h.horario) + interval '1 hour' > (p_data + p_horario);

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
    clinic_id, duracao_minutos
  )
  VALUES (
    v_cliente_id, p_profissional_id, v_servico_id_fk,
    p_data, p_horario, 'confirmado', coalesce(nullif(trim(p_observacoes), ''), ''),
    v_nome_cli, v_nome_prof, v_nome_serv,
    v_clinic_id, v_dur_min
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

-- ---------------------------------------------------------------------------
-- n8n_cs_reagendar: bloqueia novo slot < now()+antec (só quando origem = agente).
-- Versão única de 8 parâmetros (a antiga de 7 já foi removida em 20260528200000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.n8n_cs_reagendar(
  p_agendamento_id uuid,
  p_nova_data date,
  p_novo_horario time,
  p_novo_profissional_id uuid,
  p_profissional_antigo_id uuid,
  p_data_antiga date,
  p_horario_antigo time,
  p_mutacao_origem text DEFAULT 'agente'
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
  v_mu            text;
  v_antec         int;
  v_alvo          timestamptz;
BEGIN
  v_mu := lower(trim(coalesce(p_mutacao_origem, 'agente')));
  IF v_mu NOT IN ('agente', 'painel') THEN
    v_mu := 'agente';
  END IF;

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

  -- Antecedência mínima — só para o agente; painel sempre pode reagendar.
  IF v_mu = 'agente' THEN
    v_antec := public._clinic_antecedencia_minutos(v_clinic_id);
    v_alvo  := ((p_nova_data + p_novo_horario)::timestamp AT TIME ZONE 'America/Sao_Paulo');
    IF v_alvo < (NOW() + (v_antec || ' minutes')::interval) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'antecedencia_minima',
        'antecedencia_minutos', v_antec,
        'message', 'O novo horário está dentro da janela mínima de antecedência da clínica.'
      );
    END IF;
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
      clinic_id        = coalesce(clinic_id, v_clinic_id),
      atualizado_em    = now(),
      mutacao_origem   = v_mu
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
    atualizado_em     = now(),
    mutacao_origem    = v_mu
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

-- ---------------------------------------------------------------------------
-- n8n_cs_cancelar: bloqueia se consulta começa em < now()+antec da clínica.
-- (Painel usa painel_cancel_cs_agendamento — não passa por aqui.)
-- ---------------------------------------------------------------------------
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
  v_row_prof      uuid;
  v_row_data      date;
  v_row_horario   time;
  v_row_status    text;
  v_row_clinic    uuid;
  v_upd           int;
  v_antec         int;
  v_alvo          timestamptz;
BEGIN
  SELECT a.profissional_id, a.data_agendamento, a.horario, a.status,
         coalesce(a.clinic_id, (SELECT csp.clinic_id FROM public.cs_profissionais csp WHERE csp.id = a.profissional_id))
  INTO   v_row_prof, v_row_data, v_row_horario, v_row_status, v_row_clinic
  FROM   public.cs_agendamentos a
  WHERE  a.id = p_agendamento_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'agendamento_nao_encontrado',
      'message', 'Não existe cs_agendamentos com este id.'
    );
  END IF;

  SELECT prof.whatsapp
  INTO   v_prof_whatsapp
  FROM   public.cs_profissionais csp
  LEFT JOIN public.professionals prof
    ON prof.cs_profissional_id = csp.id
    AND prof.clinic_id = csp.clinic_id
  WHERE  csp.id = v_row_prof;

  IF v_row_status IN ('cancelado', 'concluido') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'agendamento_id', p_agendamento_id,
      'profissional_whatsapp', v_prof_whatsapp,
      'already_terminal', true
    );
  END IF;

  -- Antecedência mínima para cancelamento via agente.
  IF v_row_clinic IS NOT NULL THEN
    v_antec := public._clinic_antecedencia_minutos(v_row_clinic);
    v_alvo  := ((v_row_data + v_row_horario)::timestamp AT TIME ZONE 'America/Sao_Paulo');
    IF v_alvo < (NOW() + (v_antec || ' minutes')::interval) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'antecedencia_minima',
        'antecedencia_minutos', v_antec,
        'message', 'O cancelamento está dentro da janela mínima de antecedência da clínica.'
      );
    END IF;
  END IF;

  UPDATE public.cs_agendamentos
  SET
    status              = 'cancelado',
    motivo_cancelamento = coalesce(nullif(trim(p_motivo), ''), 'Cancelado pelo cliente'),
    atualizado_em       = now(),
    mutacao_origem      = 'agente'
  WHERE id = p_agendamento_id
    AND status NOT IN ('cancelado', 'concluido');

  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd <> 1 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'cancelamento_falhou',
      'message', 'Não foi possível cancelar (estado inesperado).'
    );
  END IF;

  UPDATE public.cs_horarios_disponiveis
  SET disponivel = true
  WHERE profissional_id = v_row_prof
    AND data = v_row_data
    AND date_trunc('minute', horario) = date_trunc('minute', v_row_horario);

  RETURN jsonb_build_object(
    'ok', true,
    'agendamento_id', p_agendamento_id,
    'profissional_whatsapp', v_prof_whatsapp
  );
END;
$$;

-- Grants (preservar política das migrations anteriores).
REVOKE ALL ON FUNCTION public._clinic_antecedencia_minutos(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public._clinic_antecedencia_minutos(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._clinic_antecedencia_minutos(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._clinic_antecedencia_minutos(uuid) TO anon;

REVOKE ALL ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO anon;

REVOKE ALL ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time, text) TO anon;

REVOKE ALL ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO anon;
