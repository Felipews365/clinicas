-- Horas extra por profissional: só num dia (agenda) ou em todos os dias em que a clínica abre (recorrente).
-- Unifica com clinic_hours_for_date + professionals.agenda_hours para o agente e o painel.

CREATE TABLE public.cs_profissional_hora_extra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  profissional_id uuid NOT NULL REFERENCES public.cs_profissionais (id) ON DELETE CASCADE,
  data date NOT NULL,
  hora integer NOT NULL CHECK (hora >= 6 AND hora <= 22),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cs_profissional_hora_extra_unique UNIQUE (profissional_id, data, hora)
);

CREATE INDEX cs_profissional_hora_extra_clinic_prof_data_idx
  ON public.cs_profissional_hora_extra (clinic_id, profissional_id, data);

CREATE TABLE public.cs_profissional_hora_recorrente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  profissional_id uuid NOT NULL REFERENCES public.cs_profissionais (id) ON DELETE CASCADE,
  hora integer NOT NULL CHECK (hora >= 6 AND hora <= 22),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cs_profissional_hora_recorrente_unique UNIQUE (profissional_id, hora)
);

CREATE INDEX cs_profissional_hora_recorrente_clinic_prof_idx
  ON public.cs_profissional_hora_recorrente (clinic_id, profissional_id);

ALTER TABLE public.cs_profissional_hora_extra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_profissional_hora_recorrente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_prof_hora_extra_access ON public.cs_profissional_hora_extra;
CREATE POLICY cs_prof_hora_extra_access ON public.cs_profissional_hora_extra
  FOR ALL TO authenticated
  USING (
    clinic_id IS NOT NULL
    AND public.rls_has_clinic_access (clinic_id)
  )
  WITH CHECK (
    clinic_id IS NOT NULL
    AND public.rls_has_clinic_access (clinic_id)
  );

DROP POLICY IF EXISTS cs_prof_hora_recorrente_access ON public.cs_profissional_hora_recorrente;
CREATE POLICY cs_prof_hora_recorrente_access ON public.cs_profissional_hora_recorrente
  FOR ALL TO authenticated
  USING (
    clinic_id IS NOT NULL
    AND public.rls_has_clinic_access (clinic_id)
  )
  WITH CHECK (
    clinic_id IS NOT NULL
    AND public.rls_has_clinic_access (clinic_id)
  );

COMMENT ON TABLE public.cs_profissional_hora_extra IS 'Bloco extra só na data indicada (ex.: almoço num dia específico).';
COMMENT ON TABLE public.cs_profissional_hora_recorrente IS 'Bloco extra em todos os dias em que a clínica tem agenda (seg–sex conforme clínica; sábado se aberto).';

-- Grade efetiva do profissional na data (clínica aberta + agenda_hours + extras + recorrentes).
CREATE OR REPLACE FUNCTION public.cs_effective_hours_for_prof_date (
  p_clinic_id uuid,
  p_profissional_id uuid,
  p_data date
) RETURNS integer[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic int[];
  v_pr int[];
  v_rec int[];
  v_day int[];
  v_base int[];
BEGIN
  IF p_clinic_id IS NULL OR p_profissional_id IS NULL OR p_data IS NULL THEN
    RETURN ARRAY[]::integer[];
  END IF;

  v_clinic := public.clinic_hours_for_date (p_clinic_id, p_data);
  IF v_clinic IS NULL OR cardinality (v_clinic) = 0 THEN
    RETURN ARRAY[]::integer[];
  END IF;

  SELECT pr.agenda_hours INTO v_pr
  FROM public.professionals pr
  WHERE pr.clinic_id = p_clinic_id
    AND pr.cs_profissional_id = p_profissional_id
    AND COALESCE (pr.is_active, true) = true
  LIMIT 1;

  IF v_pr IS NOT NULL AND cardinality (v_pr) > 0 THEN
    v_base := v_pr;
  ELSE
    v_base := v_clinic;
  END IF;

  SELECT coalesce (array_agg (r.hora ORDER BY r.hora), ARRAY[]::integer[]) INTO v_rec
  FROM public.cs_profissional_hora_recorrente r
  WHERE r.clinic_id = p_clinic_id
    AND r.profissional_id = p_profissional_id;

  SELECT coalesce (array_agg (e.hora ORDER BY e.hora), ARRAY[]::integer[]) INTO v_day
  FROM public.cs_profissional_hora_extra e
  WHERE e.clinic_id = p_clinic_id
    AND e.profissional_id = p_profissional_id
    AND e.data = p_data;

  RETURN coalesce (
    (
      SELECT array_agg (sub.v ORDER BY sub.v)
      FROM (
        SELECT DISTINCT v
        FROM unnest (
          v_base || coalesce (v_rec, ARRAY[]::integer[]) || coalesce (v_day, ARRAY[]::integer[])
        ) AS v
        WHERE v BETWEEN 6 AND 22
      ) sub
    ),
    ARRAY[]::integer[]
  );
END;
$$;

-- Adiciona hora fora da grade base da clínica: escopo dia_unico | recorrente.
CREATE OR REPLACE FUNCTION public.painel_cs_add_profissional_hora (
  p_clinic_id uuid,
  p_profissional_id uuid,
  p_data date,
  p_hora int,
  p_escopo text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_eff int[];
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_hora IS NULL OR p_hora < 6 OR p_hora > 22 THEN
    RETURN jsonb_build_object ('ok', false, 'error', 'invalid_hour');
  END IF;

  IF p_data IS NULL OR cardinality (public.clinic_hours_for_date (p_clinic_id, p_data)) = 0 THEN
    RETURN jsonb_build_object ('ok', false, 'error', 'clinic_closed_day');
  END IF;

  SELECT true INTO v_ok
  FROM public.cs_profissionais p
  WHERE p.id = p_profissional_id
    AND p.clinic_id = p_clinic_id
    AND p.ativo = true
  LIMIT 1;

  IF v_ok IS DISTINCT FROM true THEN
    RETURN jsonb_build_object ('ok', false, 'error', 'profissional_not_found');
  END IF;

  IF lower(trim(p_escopo)) = 'dia_unico' THEN
    INSERT INTO public.cs_profissional_hora_extra (clinic_id, profissional_id, data, hora)
    VALUES (p_clinic_id, p_profissional_id, p_data, p_hora)
    ON CONFLICT (profissional_id, data, hora) DO NOTHING;
  ELSIF lower(trim(p_escopo)) = 'recorrente' THEN
    INSERT INTO public.cs_profissional_hora_recorrente (clinic_id, profissional_id, hora)
    VALUES (p_clinic_id, p_profissional_id, p_hora)
    ON CONFLICT (profissional_id, hora) DO NOTHING;
  ELSE
    RETURN jsonb_build_object ('ok', false, 'error', 'invalid_scope');
  END IF;

  INSERT INTO public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel, bloqueio_manual)
  VALUES (
    p_profissional_id,
    p_data,
    make_time (p_hora::int, 0, 0),
    true,
    false
  )
  ON CONFLICT (profissional_id, data, horario) DO NOTHING;

  v_eff := public.cs_effective_hours_for_prof_date (p_clinic_id, p_profissional_id, p_data);
  IF NOT (p_hora = ANY (v_eff)) THEN
    RETURN jsonb_build_object ('ok', false, 'error', 'hour_not_effective');
  END IF;

  RETURN jsonb_build_object ('ok', true);
END;
$$;

-- n8n: semear e listar com grade efetiva por profissional
CREATE OR REPLACE FUNCTION public.n8n_cs_consultar_vagas (
  p_clinic_id uuid,
  p_data date,
  p_profissional_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clinic int[];
BEGIN
  IF p_clinic_id IS NULL OR p_data IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_clinic := public.clinic_hours_for_date (p_clinic_id, p_data);

  IF v_clinic IS NULL OR cardinality (v_clinic) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  INSERT INTO public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel, bloqueio_manual)
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
    AND (p.clinic_id IS NULL OR p.clinic_id = p_clinic_id)
    AND s.h BETWEEN 6 AND 22
    AND (p_profissional_id IS NULL OR p.id = p_profissional_id)
  ON CONFLICT (profissional_id, data, horario) DO NOTHING;

  RETURN coalesce (
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'horario_id', h.id,
          'data', to_char (h.data, 'DD/MM/YYYY'),
          'dia_semana', trim (to_char (h.data, 'Day')),
          'horario', to_char (h.horario, 'HH24:MI'),
          'profissional_id', p.id,
          'profissional', p.nome,
          'especialidade', p.especialidade
        ) ORDER BY h.horario
      )
      FROM public.cs_horarios_disponiveis h
      INNER JOIN public.cs_profissionais p ON p.id = h.profissional_id
      WHERE p.clinic_id = p_clinic_id
        AND h.data = p_data
        AND p.ativo = true
        AND coalesce (h.disponivel, true) = true
        AND coalesce (h.bloqueio_manual, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM public.cs_agendamentos a
          WHERE a.profissional_id = h.profissional_id
            AND a.data_agendamento = h.data
            AND a.horario = h.horario
            AND a.status NOT IN ('cancelado', 'concluido')
        )
        AND (p_profissional_id IS NULL OR p.id = p_profissional_id)
        AND EXTRACT (hour FROM h.horario)::integer = ANY (
          public.cs_effective_hours_for_prof_date (p_clinic_id, p.id, p_data)
        )
    ),
    '[]'::jsonb
  );
END;
$function$;

-- Painel: slots do dia
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
            WHEN coalesce (h.bloqueio_manual, false) THEN false
            WHEN EXISTS (
              SELECT 1 FROM public.cs_agendamentos a
              WHERE a.profissional_id = h.profissional_id
                AND a.data_agendamento = h.data
                AND a.horario = h.horario
                AND a.status NOT IN ('cancelado', 'concluido')
                AND coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
            ) THEN false
            ELSE true
          END,
          'indisponivel_por', CASE
            WHEN coalesce (h.bloqueio_manual, false) THEN 'medico'
            WHEN EXISTS (
              SELECT 1 FROM public.cs_agendamentos a
              WHERE a.profissional_id = h.profissional_id
                AND a.data_agendamento = h.data
                AND a.horario = h.horario
                AND a.status NOT IN ('cancelado', 'concluido')
                AND coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
            ) THEN 'cliente'
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

CREATE OR REPLACE FUNCTION public.painel_cs_set_slot_disponivel (
  p_clinic_id uuid,
  p_horario_id uuid,
  p_disponivel boolean
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

  UPDATE public.cs_horarios_disponiveis
  SET
    disponivel = p_disponivel,
    bloqueio_manual = CASE WHEN p_disponivel THEN false ELSE true END
  WHERE id = p_horario_id;

  RETURN jsonb_build_object ('ok', true, 'disponivel', p_disponivel);
END;
$$;

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

  UPDATE public.cs_horarios_disponiveis h
  SET
    disponivel = true,
    bloqueio_manual = false
  FROM public.cs_profissionais p
  WHERE h.profissional_id = p.id
    AND h.data = p_data
    AND p.ativo = true
    AND p.clinic_id = p_clinic_id
    AND coalesce (h.bloqueio_manual, false) = false
    AND h.disponivel = false
    AND NOT EXISTS (
      SELECT 1 FROM public.cs_agendamentos a
      WHERE a.profissional_id = h.profissional_id
        AND a.data_agendamento = h.data
        AND a.horario = h.horario
        AND a.status NOT IN ('cancelado', 'concluido')
        AND coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
    );

  RETURN jsonb_build_object ('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cs_effective_hours_for_prof_date (uuid, uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION public.cs_effective_hours_for_prof_date (uuid, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cs_effective_hours_for_prof_date (uuid, uuid, date) TO service_role;

REVOKE ALL ON FUNCTION public.painel_cs_add_profissional_hora (uuid, uuid, date, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_cs_add_profissional_hora (uuid, uuid, date, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cs_add_profissional_hora (uuid, uuid, date, int, text) TO service_role;
