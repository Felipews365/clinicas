-- Horas «só indisponíveis» com escopo: um dia ou todos os dias com agenda (recorrente).
-- cs_prof_panel_hours_* = grade oferecida no painel; cs_effective_hours_* = grade que o agente semeia (após ocultar).

CREATE TABLE IF NOT EXISTS public.cs_profissional_hora_oculta_dia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  profissional_id uuid NOT NULL REFERENCES public.cs_profissionais (id) ON DELETE CASCADE,
  data date NOT NULL,
  hora integer NOT NULL CHECK (hora >= 6 AND hora <= 22),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cs_prof_hora_oculta_dia_unique UNIQUE (profissional_id, data, hora)
);

CREATE INDEX IF NOT EXISTS cs_prof_hora_oculta_dia_clinic_prof_data_idx
  ON public.cs_profissional_hora_oculta_dia (clinic_id, profissional_id, data);

CREATE TABLE IF NOT EXISTS public.cs_profissional_hora_oculta_recorrente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  profissional_id uuid NOT NULL REFERENCES public.cs_profissionais (id) ON DELETE CASCADE,
  hora integer NOT NULL CHECK (hora >= 6 AND hora <= 22),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cs_prof_hora_oculta_rec_unique UNIQUE (profissional_id, hora)
);

CREATE INDEX IF NOT EXISTS cs_prof_hora_oculta_rec_clinic_prof_idx
  ON public.cs_profissional_hora_oculta_recorrente (clinic_id, profissional_id);

ALTER TABLE public.cs_profissional_hora_oculta_dia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_profissional_hora_oculta_recorrente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_prof_hora_oculta_dia_access ON public.cs_profissional_hora_oculta_dia;
CREATE POLICY cs_prof_hora_oculta_dia_access ON public.cs_profissional_hora_oculta_dia
  FOR ALL TO authenticated
  USING (clinic_id IS NOT NULL AND public.rls_has_clinic_access (clinic_id))
  WITH CHECK (clinic_id IS NOT NULL AND public.rls_has_clinic_access (clinic_id));

DROP POLICY IF EXISTS cs_prof_hora_oculta_rec_access ON public.cs_profissional_hora_oculta_recorrente;
CREATE POLICY cs_prof_hora_oculta_rec_access ON public.cs_profissional_hora_oculta_recorrente
  FOR ALL TO authenticated
  USING (clinic_id IS NOT NULL AND public.rls_has_clinic_access (clinic_id))
  WITH CHECK (clinic_id IS NOT NULL AND public.rls_has_clinic_access (clinic_id));

COMMENT ON TABLE public.cs_profissional_hora_oculta_dia IS
  'Remove este bloco da grade do agente só na data (indisponível suave, escopo dia).';
COMMENT ON TABLE public.cs_profissional_hora_oculta_recorrente IS
  'Remove este bloco em todos os dias em que a clínica tem agenda.';

-- Grade completa no painel (antes de subtrair ocultações).
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

-- Grade que o agente usa (painel semeia vagas «oferecíveis» com esta lista).
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
  v_merged int[];
  v_hide_d int[];
  v_hide_r int[];
BEGIN
  v_merged := public.cs_prof_panel_hours_for_prof_date (p_clinic_id, p_profissional_id, p_data);
  IF v_merged IS NULL OR cardinality (v_merged) = 0 THEN
    RETURN ARRAY[]::integer[];
  END IF;

  SELECT coalesce (array_agg (x.hora ORDER BY x.hora), ARRAY[]::integer[]) INTO v_hide_d
  FROM public.cs_profissional_hora_oculta_dia x
  WHERE x.clinic_id = p_clinic_id
    AND x.profissional_id = p_profissional_id
    AND x.data = p_data;

  SELECT coalesce (array_agg (x.hora ORDER BY x.hora), ARRAY[]::integer[]) INTO v_hide_r
  FROM public.cs_profissional_hora_oculta_recorrente x
  WHERE x.clinic_id = p_clinic_id
    AND x.profissional_id = p_profissional_id;

  RETURN coalesce (
    (
      SELECT array_agg (sub.v ORDER BY sub.v)
      FROM (
        SELECT DISTINCT v
        FROM unnest (v_merged) AS v
        WHERE v BETWEEN 6 AND 22
          AND NOT (
            v = ANY (coalesce (v_hide_d, ARRAY[]::integer[]) || coalesce (v_hide_r, ARRAY[]::integer[]))
          )
      ) sub
    ),
    ARRAY[]::integer[]
  );
END;
$$;

-- Liberta regras de ocultação para este bloco (usado ao libertar, bloquear ou marcar disponível).
CREATE OR REPLACE FUNCTION public.painel_cs_clear_hora_oculta (
  p_clinic_id uuid,
  p_profissional_id uuid,
  p_data date,
  p_hora int
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  DELETE FROM public.cs_profissional_hora_oculta_dia
  WHERE clinic_id = p_clinic_id
    AND profissional_id = p_profissional_id
    AND data = p_data
    AND hora = p_hora;

  DELETE FROM public.cs_profissional_hora_oculta_recorrente
  WHERE clinic_id = p_clinic_id
    AND profissional_id = p_profissional_id
    AND hora = p_hora;
END;
$$;

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
  v_panel int[];
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

  v_panel := public.cs_prof_panel_hours_for_prof_date (p_clinic_id, v_prof, v_slot_date);

  IF v_hour IS NULL OR v_prof IS NULL OR NOT (v_hour = ANY (v_panel)) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'hour_not_in_clinic_agenda',
      'message', 'Este horário não está na grade deste profissional para este dia.'
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
    PERFORM public.painel_cs_clear_hora_oculta (p_clinic_id, v_prof, v_slot_date, v_hour);
  ELSE
    v_bm := COALESCE (p_bloqueio_manual, true);
    IF v_bm THEN
      PERFORM public.painel_cs_clear_hora_oculta (p_clinic_id, v_prof, v_slot_date, v_hour);
    END IF;
  END IF;

  UPDATE public.cs_horarios_disponiveis
  SET
    disponivel = p_disponivel,
    bloqueio_manual = v_bm
  WHERE id = p_horario_id;

  RETURN jsonb_build_object ('ok', true, 'disponivel', p_disponivel, 'bloqueio_manual', v_bm);
END;
$$;

CREATE OR REPLACE FUNCTION public.painel_cs_marcar_indisponivel_soft (
  p_clinic_id uuid,
  p_horario_id uuid,
  p_escopo text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prof uuid;
  v_date date;
  v_hour int;
  v_panel int[];
  v_scope text;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT h.profissional_id, h.data, EXTRACT (hour FROM h.horario)::integer
  INTO v_prof, v_date, v_hour
  FROM public.cs_horarios_disponiveis h
  INNER JOIN public.cs_profissionais p ON p.id = h.profissional_id
  WHERE h.id = p_horario_id
    AND p.clinic_id = p_clinic_id
    AND p.ativo = true;

  IF v_prof IS NULL OR v_date IS NULL OR v_hour IS NULL THEN
    RETURN jsonb_build_object ('ok', false, 'error', 'slot_not_found_or_forbidden');
  END IF;

  v_panel := public.cs_prof_panel_hours_for_prof_date (p_clinic_id, v_prof, v_date);
  IF NOT (v_hour = ANY (v_panel)) THEN
    RETURN jsonb_build_object ('ok', false, 'error', 'hour_not_in_clinic_agenda');
  END IF;

  v_scope := lower(trim(p_escopo));
  IF v_scope = 'dia_unico' THEN
    DELETE FROM public.cs_profissional_hora_oculta_recorrente
    WHERE clinic_id = p_clinic_id
      AND profissional_id = v_prof
      AND hora = v_hour;
    INSERT INTO public.cs_profissional_hora_oculta_dia (clinic_id, profissional_id, data, hora)
    VALUES (p_clinic_id, v_prof, v_date, v_hour)
    ON CONFLICT (profissional_id, data, hora) DO NOTHING;
  ELSIF v_scope = 'recorrente' THEN
    DELETE FROM public.cs_profissional_hora_oculta_dia
    WHERE clinic_id = p_clinic_id
      AND profissional_id = v_prof
      AND hora = v_hour;
    INSERT INTO public.cs_profissional_hora_oculta_recorrente (clinic_id, profissional_id, hora)
    VALUES (p_clinic_id, v_prof, v_hour)
    ON CONFLICT (profissional_id, hora) DO NOTHING;
  ELSE
    RETURN jsonb_build_object ('ok', false, 'error', 'invalid_scope');
  END IF;

  UPDATE public.cs_horarios_disponiveis
  SET
    disponivel = false,
    bloqueio_manual = false
  WHERE id = p_horario_id;

  RETURN jsonb_build_object ('ok', true, 'escopo', v_scope);
END;
$$;

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
          public.cs_prof_panel_hours_for_prof_date (p_clinic_id, p.id, p_data)
        )
    ),
    '[]'::jsonb
  );
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
    make_time (ph.h::int, 0, 0),
    false,
    false
  FROM public.cs_profissionais p
  CROSS JOIN LATERAL (
    SELECT x.v AS h
    FROM unnest (
      public.cs_prof_panel_hours_for_prof_date (p_clinic_id, p.id, p_data)
    ) AS x(v)
    WHERE NOT (
      x.v = ANY (
        coalesce (
          public.cs_effective_hours_for_prof_date (p_clinic_id, p.id, p_data),
          ARRAY[]::integer[]
        )
      )
    )
  ) AS ph
  WHERE p.ativo = true
    AND p.clinic_id = p_clinic_id
    AND ph.h BETWEEN 6 AND 22
  ON CONFLICT (profissional_id, data, horario) DO UPDATE
  SET
    disponivel = false,
    bloqueio_manual = false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cs_agendamentos a
    WHERE a.profissional_id = cs_horarios_disponiveis.profissional_id
      AND a.data_agendamento = cs_horarios_disponiveis.data
      AND a.horario = cs_horarios_disponiveis.horario
      AND a.status NOT IN ('cancelado', 'concluido')
      AND coalesce (a.clinic_id, p_clinic_id) = p_clinic_id
  )
    AND coalesce (cs_horarios_disponiveis.bloqueio_manual, false) = false;

  RETURN jsonb_build_object ('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cs_prof_panel_hours_for_prof_date (uuid, uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION public.cs_prof_panel_hours_for_prof_date (uuid, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cs_prof_panel_hours_for_prof_date (uuid, uuid, date) TO service_role;

REVOKE ALL ON FUNCTION public.painel_cs_clear_hora_oculta (uuid, uuid, date, int) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_cs_clear_hora_oculta (uuid, uuid, date, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cs_clear_hora_oculta (uuid, uuid, date, int) TO service_role;

REVOKE ALL ON FUNCTION public.painel_cs_marcar_indisponivel_soft (uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_cs_marcar_indisponivel_soft (uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cs_marcar_indisponivel_soft (uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) TO service_role;
