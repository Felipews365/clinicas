-- Opt-out por profissional: não atende aos sábados (clínica pode estar aberta).

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS works_saturday boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.professionals.works_saturday IS
  'Se false, o profissional não tem grade aos sábados (painel e agente), mesmo com sabado_aberto na clínica.';

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
  v_works_sat boolean;
BEGIN
  IF p_clinic_id IS NULL OR p_profissional_id IS NULL OR p_data IS NULL THEN
    RETURN ARRAY[]::integer[];
  END IF;

  v_clinic := public.clinic_hours_for_date (p_clinic_id, p_data);
  IF v_clinic IS NULL OR cardinality (v_clinic) = 0 THEN
    RETURN ARRAY[]::integer[];
  END IF;

  SELECT pr.agenda_hours, COALESCE (pr.works_saturday, true)
  INTO v_pr, v_works_sat
  FROM public.professionals pr
  WHERE pr.clinic_id = p_clinic_id
    AND pr.cs_profissional_id = p_profissional_id
    AND COALESCE (pr.is_active, true) = true
  LIMIT 1;

  IF EXTRACT (DOW FROM p_data)::int = 6 AND NOT COALESCE (v_works_sat, true) THEN
    RETURN ARRAY[]::integer[];
  END IF;

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
