-- Marcar vaga: bloqueio manual (explícito) vs só indisponível (disponivel=false, bloqueio_manual=false).
-- O agente não lista em ambos os casos; o painel distingue visualmente.

DROP FUNCTION IF EXISTS public.painel_cs_set_slot_disponivel (uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.painel_cs_set_slot_disponivel (
  p_clinic_id uuid,
  p_horario_id uuid,
  p_disponivel boolean,
  p_bloqueio_manual boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_hour int;
  v_eff int[];
  v_slot_date date;
  v_prof uuid;
  v_bm boolean;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT h.data, h.profissional_id, EXTRACT (hour FROM h.horario)::integer
  INTO v_slot_date, v_prof, v_hour
  FROM public.cs_horarios_disponiveis h
  WHERE h.id = p_horario_id;

  v_eff := public.cs_effective_hours_for_prof_date (p_clinic_id, v_prof, v_slot_date);

  IF v_hour IS NULL OR v_prof IS NULL OR NOT (v_hour = ANY (v_eff)) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'hour_not_in_clinic_agenda',
      'message', 'Este horário não está na grade efectiva deste profissional para este dia.'
    );
  END IF;

  SELECT true INTO v_ok
  FROM public.cs_horarios_disponiveis h
  INNER JOIN public.cs_profissionais p ON p.id = h.profissional_id
  WHERE h.id = p_horario_id
    AND p.ativo = true
    AND p.clinic_id = p_clinic_id
  LIMIT 1;

  IF v_ok IS DISTINCT FROM true THEN
    RETURN jsonb_build_object ('ok', false, 'error', 'slot_not_found_or_forbidden');
  END IF;

  IF p_disponivel THEN
    v_bm := false;
  ELSE
    v_bm := COALESCE (p_bloqueio_manual, true);
  END IF;

  UPDATE public.cs_horarios_disponiveis
  SET
    disponivel = p_disponivel,
    bloqueio_manual = v_bm
  WHERE id = p_horario_id;

  RETURN jsonb_build_object ('ok', true, 'disponivel', p_disponivel, 'bloqueio_manual', v_bm);
END;
$$;

REVOKE ALL ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean, boolean) TO service_role;

-- painel_cs_slots_dia: reflectir coluna disponivel + indisponivel sem bloqueio
CREATE OR REPLACE FUNCTION public.painel_cs_slots_dia (p_clinic_id uuid, p_data date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic int[];
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  v_clinic := public.clinic_hours_for_date (p_clinic_id, p_data);

  IF v_clinic IS NULL OR cardinality (v_clinic) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce (
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'horario_id', h.id,
          'profissional_id', p.id,
          'profissional_nome', p.nome,
          'especialidade', p.especialidade,
          'nome_procedimento', (
            SELECT coalesce (nullif (trim (a.nome_procedimento), ''), sv.nome)::text
            FROM public.cs_agendamentos a
            INNER JOIN public.cs_servicos sv ON sv.id = a.servico_id
            WHERE a.profissional_id = h.profissional_id
              AND a.data_agendamento = h.data
              AND a.horario = h.horario
              AND a.status NOT IN ('cancelado', 'concluido')
              AND coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
            LIMIT 1
          ),
          'data', h.data,
          'horario', to_char (h.horario, 'HH24:MI'),
          'disponivel', CASE
            WHEN EXISTS (
              SELECT 1 FROM public.cs_agendamentos a
              WHERE a.profissional_id = h.profissional_id
                AND a.data_agendamento = h.data
                AND a.horario = h.horario
                AND a.status NOT IN ('cancelado', 'concluido')
                AND coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
            ) THEN false
            WHEN coalesce (h.bloqueio_manual, false) THEN false
            WHEN coalesce (h.disponivel, true) = false THEN false
            ELSE true
          END,
          'indisponivel_por', CASE
            WHEN EXISTS (
              SELECT 1 FROM public.cs_agendamentos a
              WHERE a.profissional_id = h.profissional_id
                AND a.data_agendamento = h.data
                AND a.horario = h.horario
                AND a.status NOT IN ('cancelado', 'concluido')
                AND coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
            ) THEN 'cliente'
            WHEN coalesce (h.bloqueio_manual, false) THEN 'medico'
            WHEN coalesce (h.disponivel, true) = false THEN 'indisponivel'
            ELSE NULL
          END,
          'bloqueio_manual', coalesce (h.bloqueio_manual, false)
        )
        ORDER BY p.nome ASC, h.horario ASC
      )
      FROM public.cs_horarios_disponiveis h
      INNER JOIN public.cs_profissionais p ON p.id = h.profissional_id
      WHERE h.data = p_data
        AND p.ativo = true
        AND p.clinic_id = p_clinic_id
        AND EXTRACT (hour FROM h.horario)::integer = ANY (
          public.cs_effective_hours_for_prof_date (p_clinic_id, p.id, p_data)
        )
    ),
    '[]'::jsonb
  );
END;
$$;

-- Não repor automaticamente disponivel=true quando o médico marcou só «indisponível» (sem bloqueio).
CREATE OR REPLACE FUNCTION public.painel_cs_ensure_slots_grid (
  p_clinic_id uuid,
  p_data date,
  p_hora_inicio int DEFAULT 6,
  p_hora_fim int DEFAULT 22
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic int[];
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  v_clinic := public.clinic_hours_for_date (p_clinic_id, p_data);

  IF v_clinic IS NULL OR cardinality (v_clinic) = 0 THEN
    RETURN jsonb_build_object ('ok', true, 'skipped', 'clinic_closed');
  END IF;

  INSERT INTO public.cs_horarios_disponiveis (
    profissional_id,
    data,
    horario,
    disponivel,
    bloqueio_manual
  )
  SELECT
    p.id,
    p_data,
    make_time (s.h::int, 0, 0),
    true,
    false
  FROM public.cs_profissionais p
  CROSS JOIN LATERAL unnest (
    public.cs_effective_hours_for_prof_date (p_clinic_id, p.id, p_data)
  ) AS s(h)
  WHERE p.ativo = true
    AND p.clinic_id = p_clinic_id
    AND s.h BETWEEN 6 AND 22
  ON CONFLICT (profissional_id, data, horario) DO NOTHING;

  RETURN jsonb_build_object ('ok', true);
END;
$$;
