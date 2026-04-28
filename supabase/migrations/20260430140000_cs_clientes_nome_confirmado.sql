-- Nome usado pelo agente só após confirmação no atendimento (cs_salvar_nome ou agendamento com nome).
-- Evita tratar o pushName do WhatsApp (ex.: "Streaming suporte") como nome do cliente.

ALTER TABLE public.cs_clientes
  ADD COLUMN IF NOT EXISTS nome_confirmado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cs_clientes.nome_confirmado IS
  'true quando o nome em cs_clientes.nome foi informado pelo cliente no atendimento (RPC n8n_cs_salvar_nome) ou ao agendar com nome explícito; false = ignorar nome no contexto do agente.';

UPDATE public.cs_clientes
SET nome_confirmado = true
WHERE btrim(coalesce(nome, '')) <> '';

-- ---------------------------------------------------------------------------
-- n8n_cs_salvar_nome: marca nome como confirmado pelo cliente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.n8n_cs_salvar_nome (
  p_clinic_id uuid,
  p_telefone text,
  p_nome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_telefone text;
  v_rows int;
BEGIN
  v_telefone := regexp_replace(trim(p_telefone), '\D', '', 'g');

  UPDATE public.cs_clientes
  SET
    nome = trim(p_nome),
    nome_confirmado = true,
    updated_at = now()
  WHERE clinic_id = p_clinic_id
    AND telefone = v_telefone;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 AND length(v_telefone) > 11 THEN
    UPDATE public.cs_clientes
    SET
      nome = trim(p_nome),
      nome_confirmado = true,
      updated_at = now()
    WHERE clinic_id = p_clinic_id
      AND regexp_replace(telefone, '\D', '', 'g') = substring(v_telefone FROM 3);

    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', v_rows > 0,
    'nome', trim(p_nome),
    'rows', v_rows
  );
END;
$$;

COMMENT ON FUNCTION public.n8n_cs_salvar_nome (uuid, text, text) IS
  'Persiste o nome que o cliente digitou na conversa; define nome_confirmado = true.';

REVOKE ALL ON FUNCTION public.n8n_cs_salvar_nome (uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_salvar_nome (uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.n8n_cs_salvar_nome (uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_salvar_nome (uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- n8n_cs_agendar: nome_confirmado só true quando veio nome não vazio no pedido
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.n8n_cs_agendar (
  p_nome_cliente text,
  p_telefone text,
  p_profissional_id uuid,
  p_servico_id uuid,
  p_data date,
  p_horario time,
  p_observacoes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id uuid;
  v_existing_id uuid;
  v_ag_id uuid;
  v_updated int;
  v_nome_prof text;
  v_nome_serv text;
  v_nome_cli text;
  v_clinic_id uuid;
  v_servico_id_fk uuid;
  v_prof_whatsapp text;
  v_dur_min int := 60;
  v_conf boolean;
BEGIN
  v_nome_cli := trim(p_nome_cliente);
  v_conf := btrim(v_nome_cli) <> '';

  SELECT csp.nome, csp.clinic_id, prof.whatsapp
  INTO v_nome_prof, v_clinic_id, v_prof_whatsapp
  FROM public.cs_profissionais csp
  LEFT JOIN public.professionals prof
    ON prof.cs_profissional_id = csp.id
    AND prof.clinic_id = csp.clinic_id
  WHERE csp.id = p_profissional_id;

  IF v_nome_prof IS NULL THEN
    RAISE EXCEPTION 'profissional_id inválido: %', p_profissional_id;
  END IF;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'profissional sem clinic_id — associe-o a uma clínica antes de agendar';
  END IF;

  SELECT p.name, p.duration_minutes
  INTO v_nome_serv, v_dur_min
  FROM public.clinic_procedures p
  WHERE p.id = p_servico_id
    AND p.clinic_id = v_clinic_id;

  IF v_nome_serv IS NOT NULL THEN
    v_servico_id_fk := NULL;
    IF v_dur_min IS NULL OR v_dur_min < 1 THEN
      v_dur_min := 60;
    END IF;
  ELSE
    SELECT s.nome INTO v_nome_serv
    FROM public.cs_servicos s
    WHERE s.id = p_servico_id;

    IF v_nome_serv IS NOT NULL THEN
      v_servico_id_fk := p_servico_id;
      v_dur_min := 60;
    END IF;
  END IF;

  IF v_nome_serv IS NULL THEN
    RAISE EXCEPTION 'servico_id inválido: % — não encontrado em clinic_procedures nem em cs_servicos', p_servico_id;
  END IF;

  INSERT INTO public.cs_clientes (nome, telefone, clinic_id, nome_confirmado)
  VALUES (v_nome_cli, p_telefone, v_clinic_id, v_conf)
  ON CONFLICT (clinic_id, telefone) WHERE clinic_id IS NOT NULL
  DO UPDATE SET
    nome = CASE
      WHEN btrim(excluded.nome) <> '' THEN excluded.nome
      ELSE public.cs_clientes.nome
    END,
    nome_confirmado = CASE
      WHEN btrim(excluded.nome) <> '' THEN true
      ELSE public.cs_clientes.nome_confirmado
    END,
    updated_at = now()
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
      'ok', false,
      'error', 'horario_indisponivel',
      'message', 'Este horário não está disponível. Consulte as vagas antes de agendar.'
    );
  END IF;

  INSERT INTO public.cs_agendamentos (
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
      status_funil = 'agendado'::public.crm_status_funil,
      data_ultimo_contato = now()
    WHERE c.id = v_cliente_id
      AND c.clinic_id = v_clinic_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'agendamento_id', v_ag_id,
    'cliente_id', v_cliente_id,
    'profissional_whatsapp', v_prof_whatsapp
  );
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_cs_agendar (text, text, uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar (text, text, uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar (text, text, uuid, uuid, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar (text, text, uuid, uuid, date, time, text) TO anon;

-- ---------------------------------------------------------------------------
-- Painel: ao zerar nome, volta a tratar como não confirmado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.painel_limpar_sessao_agente (
  p_clinic_id uuid,
  p_session_id text,
  p_limpar_nome boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int := 0;
  v_updated int := 0;
  v_remote_jid text;
  v_telefone text;
  v_colon int;
  v_prefix text;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_session_id IS NULL OR length(trim(p_session_id)) < 40 THEN
    RAISE EXCEPTION 'invalid session_id' USING errcode = 'P0001', message = 'session_id inválido';
  END IF;

  v_colon := position(':' IN p_session_id);
  IF v_colon < 2 THEN
    RAISE EXCEPTION 'invalid session_id' USING errcode = 'P0001', message = 'session_id inválido';
  END IF;

  v_prefix := substring(p_session_id FROM 1 FOR v_colon - 1);
  IF v_prefix::uuid IS DISTINCT FROM p_clinic_id THEN
    RAISE EXCEPTION 'session_clinic_mismatch' USING errcode = 'P0001', message = 'Sessão não pertence a esta clínica';
  END IF;

  v_remote_jid := substring(p_session_id FROM v_colon + 1);
  IF v_remote_jid IS NULL OR v_remote_jid = '' THEN
    RAISE EXCEPTION 'invalid session_id' USING errcode = 'P0001', message = 'remoteJid em falta';
  END IF;

  DELETE FROM public.n8n_chat_histories
  WHERE session_id = p_session_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  v_telefone := regexp_replace(trim(v_remote_jid), '\D', '', 'g');

  IF p_limpar_nome AND length(v_telefone) > 0 THEN
    UPDATE public.cs_clientes c
    SET
      nome = '',
      nome_confirmado = false,
      updated_at = now()
    WHERE c.clinic_id = p_clinic_id
      AND (
        c.telefone = v_telefone
        OR regexp_replace(c.telefone, '\D', '', 'g') = v_telefone
        OR (
          length(v_telefone) > 11
          AND regexp_replace(c.telefone, '\D', '', 'g') = substring(v_telefone FROM 3)
        )
        OR (
          length(v_telefone) = 11
          AND left(v_telefone, 2) IS DISTINCT FROM '55'
          AND regexp_replace(c.telefone, '\D', '', 'g') = ('55' || v_telefone)
        )
        OR (
          length(regexp_replace(c.telefone, '\D', '', 'g')) BETWEEN 10 AND 13
          AND length(v_telefone) BETWEEN 10 AND 13
          AND right(regexp_replace(c.telefone, '\D', '', 'g'), 11) = right(v_telefone, 11)
        )
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'historico_removido', v_deleted,
    'cadastro_nome_limpo', v_updated
  );
END;
$$;

COMMENT ON FUNCTION public.painel_limpar_sessao_agente (uuid, text, boolean) IS
  'Painel: apaga n8n_chat_histories; zera nome e nome_confirmado em cs_clientes.';

REVOKE ALL ON FUNCTION public.painel_limpar_sessao_agente (uuid, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_limpar_sessao_agente (uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_limpar_sessao_agente (uuid, text, boolean) TO service_role;
