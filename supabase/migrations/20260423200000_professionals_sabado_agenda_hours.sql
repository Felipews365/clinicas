-- Horários próprios ao sábado por profissional (quando atende aos sábados).
-- NULL = comportamento anterior: usa agenda_hours personalizado ou a grade da clínica nesse sábado.

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS sabado_agenda_hours integer[] NULL;

COMMENT ON COLUMN public.professionals.sabado_agenda_hours IS
  'Blocos 6–22h em que o profissional atende ao sábado; intersecção com a grade da clínica nesse dia. NULL = mesma lógica que dias úteis (agenda_hours ou clínica).';

CREATE OR REPLACE FUNCTION public.cs_prof_panel_hours_for_prof_date (
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
  v_works_sat boolean;
  v_dow int;
  v_sat_spec int[];
BEGIN
  IF p_clinic_id IS NULL OR p_profissional_id IS NULL OR p_data IS NULL THEN
    RETURN ARRAY[]::integer[];
  END IF;

  v_clinic := public.clinic_hours_for_date (p_clinic_id, p_data);
  IF v_clinic IS NULL OR cardinality (v_clinic) = 0 THEN
    RETURN ARRAY[]::integer[];
  END IF;

  SELECT pr.agenda_hours, COALESCE (pr.works_saturday, true), pr.sabado_agenda_hours
  INTO v_pr, v_works_sat, v_sat_spec
  FROM public.professionals pr
  WHERE pr.clinic_id = p_clinic_id
    AND pr.cs_profissional_id = p_profissional_id
    AND COALESCE (pr.is_active, true) = true
  LIMIT 1;

  v_dow := EXTRACT (DOW FROM p_data)::int;

  IF v_dow = 6 AND NOT COALESCE (v_works_sat, true) THEN
    RETURN ARRAY[]::integer[];
  END IF;

  IF v_dow = 6
     AND COALESCE (v_works_sat, true)
     AND v_sat_spec IS NOT NULL
     AND cardinality (v_sat_spec) > 0 THEN
    SELECT coalesce (
      (
        SELECT array_agg (u.h ORDER BY u.h)
        FROM (
          SELECT DISTINCT unnest (v_sat_spec) AS h
        ) u
        WHERE u.h = ANY (v_clinic) AND u.h BETWEEN 6 AND 22
      ),
      ARRAY[]::integer[]
    ) INTO v_base;
  ELSIF v_pr IS NOT NULL AND cardinality (v_pr) > 0 THEN
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
