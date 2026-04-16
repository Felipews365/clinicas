-- Corrige n8n_cs_agendar para aceitar servico_id tanto de clinic_procedures (v2/painel)
-- quanto de cs_servicos (legado). O painel salva procedimentos em clinic_procedures,
-- mas a função validava apenas em cs_servicos — causando "servico_id inválido" em 100% dos agendamentos.
--
-- Lógica: tenta clinic_procedures primeiro; se não achar, tenta cs_servicos.
-- Quando o serviço vem de clinic_procedures, servico_id é salvo como NULL em cs_agendamentos
-- (campo sem FK/NOT NULL) para evitar referências cruzadas inválidas; nome_procedimento preservado.

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
  v_cliente_id     uuid;
  v_ag_id          uuid;
  v_updated        int;
  v_nome_prof      text;
  v_nome_serv      text;
  v_nome_cli       text;
  v_clinic_id      uuid;
  v_servico_id_fk  uuid;   -- NULL quando ID vem de clinic_procedures
BEGIN
  v_nome_cli := trim(p_nome_cliente);

  -- Resolve profissional (sempre em cs_profissionais)
  SELECT p.nome, p.clinic_id
  INTO   v_nome_prof, v_clinic_id
  FROM   public.cs_profissionais p
  WHERE  p.id = p_profissional_id;

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
    -- ID vem de clinic_procedures; não armazena FK em cs_agendamentos (tabelas diferentes)
    v_servico_id_fk := NULL;
  ELSE
    -- Fallback: cs_servicos (legado)
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
    'ok',            true,
    'agendamento_id', v_ag_id,
    'cliente_id',    v_cliente_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) TO service_role;
