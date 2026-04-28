-- Rastrear última alteração de marcações cs: agente (n8n/WhatsApp) vs painel.
-- NULL = sem alteração registada desde esta coluna (criação ou legado).

ALTER TABLE public.cs_agendamentos
  ADD COLUMN IF NOT EXISTS mutacao_origem text
    NULL
    CONSTRAINT cs_agendamentos_mutacao_origem_chk
      CHECK (mutacao_origem IS NULL OR mutacao_origem IN ('agente', 'painel'));

COMMENT ON COLUMN public.cs_agendamentos.mutacao_origem IS
  'Última mutação relevante: agente (RPC n8n) ou painel. NULL se só criação ou dados antigos.';

-- ---------------------------------------------------------------------------
-- n8n_cs_reagendar: 8º parâmetro p_mutacao_origem default agente
-- (Remove assinatura antiga 7 args para o PostgREST resolver só esta.)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time);

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

REVOKE ALL ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_reagendar(uuid, date, time, uuid, uuid, date, time, text) TO anon;

-- ---------------------------------------------------------------------------
-- painel_reagendar_cs_agendamento → mutacao painel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.painel_reagendar_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid,
  p_nova_data date,
  p_novo_cs_profissional_id uuid,
  p_novo_horario time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_novo_prof uuid;
  v_res jsonb;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT
    a.id,
    a.profissional_id,
    a.data_agendamento,
    a.horario,
    a.status
  INTO v
  FROM public.cs_agendamentos a
  INNER JOIN public.cs_profissionais p ON p.id = a.profissional_id
  WHERE
    a.id = p_cs_agendamento_id
    AND p.clinic_id = p_clinic_id
    AND coalesce(a.clinic_id, p.clinic_id) = p_clinic_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v.status IN ('cancelado', 'concluido') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  v_novo_prof := coalesce(p_novo_cs_profissional_id, v.profissional_id);

  IF v_novo_prof IS DISTINCT FROM v.profissional_id THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.cs_profissionais csp
      WHERE csp.id = v_novo_prof
        AND csp.clinic_id = p_clinic_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'profissional_invalido');
    END IF;
  END IF;

  v_res := public.n8n_cs_reagendar(
    p_cs_agendamento_id,
    p_nova_data,
    p_novo_horario,
    v_novo_prof,
    v.profissional_id,
    v.data_agendamento,
    v.horario,
    'painel'
  );

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.painel_reagendar_cs_agendamento (uuid, uuid, date, uuid, time) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_reagendar_cs_agendamento (uuid, uuid, date, uuid, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_reagendar_cs_agendamento (uuid, uuid, date, uuid, time) TO service_role;

-- ---------------------------------------------------------------------------
-- n8n_cs_cancelar → mutacao agente
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
  v_upd           int;
BEGIN
  SELECT a.profissional_id, a.data_agendamento, a.horario, a.status
  INTO   v_row_prof, v_row_data, v_row_horario, v_row_status
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

REVOKE ALL ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO anon;

-- ---------------------------------------------------------------------------
-- painel_cancel_cs_agendamento → mutacao painel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.painel_cancel_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_slot uuid;
  v_whatsapp text;
  v_prof_nome text;
  v_prof_genero text;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT
    a.id,
    a.profissional_id,
    a.data_agendamento,
    a.horario,
    a.status,
    coalesce(nullif(trim(a.nome_cliente), ''), '') AS nome_cliente,
    coalesce(nullif(trim(a.nome_procedimento), ''), '') AS nome_procedimento
  INTO v
  FROM public.cs_agendamentos a
  INNER JOIN public.cs_profissionais p ON p.id = a.profissional_id
  WHERE
    a.id = p_cs_agendamento_id
    AND p.clinic_id = p_clinic_id
    AND coalesce(a.clinic_id, p.clinic_id) = p_clinic_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v.status = 'cancelado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_cancelled');
  END IF;

  SELECT h.id INTO v_slot
  FROM public.cs_horarios_disponiveis h
  WHERE
    h.profissional_id = v.profissional_id
    AND h.data = v.data_agendamento
    AND h.horario = v.horario
  FOR UPDATE OF h;

  IF FOUND THEN
    UPDATE public.cs_horarios_disponiveis
    SET disponivel = true
    WHERE id = v_slot;
  END IF;

  UPDATE public.cs_agendamentos
  SET
    status = 'cancelado',
    motivo_cancelamento = coalesce(motivo_cancelamento, 'Cancelado pelo painel'),
    atualizado_em = now(),
    mutacao_origem = 'painel'
  WHERE id = v.id;

  SELECT prof.name, prof.whatsapp, prof.gender
  INTO v_prof_nome, v_whatsapp, v_prof_genero
  FROM public.professionals prof
  WHERE
    prof.cs_profissional_id = v.profissional_id
    AND prof.clinic_id = p_clinic_id;

  IF coalesce(trim(v_prof_nome), '') = '' THEN
    SELECT p.nome, p.gender INTO v_prof_nome, v_prof_genero
    FROM public.cs_profissionais p
    WHERE p.id = v.profissional_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profissional_whatsapp', v_whatsapp,
    'profissional_nome', nullif(trim(v_prof_nome), ''),
    'profissional_genero', CASE
      WHEN v_prof_genero IN ('M', 'F') THEN v_prof_genero
      ELSE NULL
    END,
    'nome_cliente', nullif(trim(v.nome_cliente), ''),
    'nome_procedimento', nullif(trim(v.nome_procedimento), ''),
    'data_agendamento', v.data_agendamento,
    'horario', to_char(v.horario, 'HH24:MI')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- painel_list_cs_agendamentos: expõe cs_mutacao_origem
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.painel_list_cs_agendamentos (p_clinic_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz text;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT c.timezone INTO tz FROM public.clinics c WHERE c.id = p_clinic_id;
  tz := coalesce(nullif(trim(tz), ''), 'America/Sao_Paulo');

  RETURN coalesce(
    (
      SELECT jsonb_agg(obj ORDER BY sort_ts)
      FROM (
        SELECT
          jsonb_build_object(
            'id', 'cs:' || a.id::text,
            'starts_at', to_jsonb(((a.data_agendamento + a.horario)::timestamp AT TIME ZONE tz)),
            'ends_at', to_jsonb(
              ((a.data_agendamento + a.horario)::timestamp AT TIME ZONE tz)
              + make_interval(mins => coalesce(s.duracao_minutos, 60))
            ),
            'service_name', nullif(trim(coalesce(a.nome_procedimento, s.nome)), ''),
            'status', CASE a.status
              WHEN 'cancelado' THEN 'cancelled'
              WHEN 'concluido' THEN 'completed'
              ELSE 'scheduled'
            END,
            'source', CASE
              WHEN coalesce(a.painel_confirmado, false) THEN 'painel'
              ELSE 'whatsapp'
            END,
            'cs_mutacao_origem', to_jsonb(a.mutacao_origem),
            'notes', nullif(trim(a.observacoes), ''),
            'patients', jsonb_build_object(
              'name', nullif(trim(coalesce(a.nome_cliente, c.nome)), ''),
              'phone', c.telefone
            ),
            'professionals', jsonb_build_object(
              'id', pr_panel.id,
              'name', coalesce(nullif(trim(a.nome_profissional), ''), p.nome),
              'specialty', coalesce(pr_panel.specialty, p.especialidade),
              'panel_color', pr_panel.panel_color,
              'avatar_path', pr_panel.avatar_path,
              'avatar_emoji', pr_panel.avatar_emoji,
              'gender', coalesce(pr_panel.gender, p.gender)
            )
          ) AS obj,
          ((a.data_agendamento + a.horario)::timestamp AT TIME ZONE tz) AS sort_ts
        FROM public.cs_agendamentos a
        INNER JOIN public.cs_profissionais p
          ON p.id = a.profissional_id
          AND p.clinic_id = p_clinic_id
        INNER JOIN public.cs_clientes c ON c.id = a.cliente_id
        LEFT JOIN public.cs_servicos s ON s.id = a.servico_id
        LEFT JOIN public.professionals pr_panel
          ON pr_panel.clinic_id = p_clinic_id
          AND (pr_panel.cs_profissional_id = p.id OR pr_panel.id = p.id)
        WHERE a.clinic_id = p_clinic_id
      ) sub
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.painel_list_cs_agendamentos (uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_list_cs_agendamentos (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_list_cs_agendamentos (uuid) TO service_role;
