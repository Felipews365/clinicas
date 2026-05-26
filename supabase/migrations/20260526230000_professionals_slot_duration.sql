-- Duração de slot por profissional (intervalo da grade: 10, 20, 30, 40, 50 ou 60 min).
-- O profissional define de quanto em quanto tempo os slots aparecem para o agente e no painel.
-- Ex.: slot_duration_minutes = 30 → grade 8:00, 8:30, 9:00, 9:30…

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS slot_duration_minutes integer DEFAULT 60
    CHECK (slot_duration_minutes IN (15, 30, 60));

ALTER TABLE public.cs_profissionais
  ADD COLUMN IF NOT EXISTS slot_duration_minutes integer DEFAULT 60;

-- Sync trigger: propaga slot_duration_minutes de professionals → cs_profissionais
CREATE OR REPLACE FUNCTION public.trg_sync_professional_to_cs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cs_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cs_profissionais (nome, especialidade, ativo, clinic_id, gender, slot_duration_minutes)
    VALUES (
      NEW.name,
      NEW.specialty,
      coalesce(NEW.is_active, true),
      NEW.clinic_id,
      NEW.gender,
      coalesce(NEW.slot_duration_minutes, 60)
    )
    RETURNING id INTO v_cs_id;

    UPDATE public.professionals
    SET cs_profissional_id = v_cs_id
    WHERE id = NEW.id;

  ELSIF TG_OP = 'UPDATE' AND NEW.cs_profissional_id IS NOT NULL THEN
    UPDATE public.cs_profissionais
    SET
      nome                 = NEW.name,
      especialidade        = NEW.specialty,
      ativo                = coalesce(NEW.is_active, true),
      gender               = NEW.gender,
      slot_duration_minutes = coalesce(NEW.slot_duration_minutes, 60)
    WHERE id = NEW.cs_profissional_id;

  ELSIF TG_OP = 'DELETE' AND OLD.cs_profissional_id IS NOT NULL THEN
    UPDATE public.cs_profissionais
    SET ativo = false
    WHERE id = OLD.cs_profissional_id;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_professional_to_cs ON public.professionals;
CREATE TRIGGER trg_sync_professional_to_cs
  AFTER INSERT OR UPDATE OR DELETE
  ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_professional_to_cs();

-- painel_cs_ensure_slots_grid: gera slots sub-horários por profissional
-- Cada hora habilitada gera N slots conforme slot_duration_minutes do profissional.
CREATE OR REPLACE FUNCTION public.painel_cs_ensure_slots_grid(
  p_clinic_id   uuid,
  p_data        date,
  p_hora_inicio int DEFAULT 6,
  p_hora_fim    int DEFAULT 22
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours int[];
BEGIN
  IF NOT public.rls_is_clinic_owner(p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT coalesce(c.agenda_visible_hours,
           ARRAY[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[])
  INTO v_hours
  FROM public.clinics c
  WHERE c.id = p_clinic_id;

  IF v_hours IS NULL OR cardinality(v_hours) = 0 THEN
    v_hours := ARRAY[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[];
  END IF;

  INSERT INTO public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel)
  SELECT
    p.id,
    p_data,
    make_time((s.slot_min / 60)::int, (s.slot_min % 60)::int, 0),
    true
  FROM public.cs_profissionais p
  LEFT JOIN public.professionals pr
    ON pr.cs_profissional_id = p.id AND pr.clinic_id = p_clinic_id
  CROSS JOIN LATERAL (
    SELECT (bh * 60 + offs) AS slot_min
    FROM unnest(v_hours) AS bh
    CROSS JOIN generate_series(0, 59, COALESCE(pr.slot_duration_minutes, p.slot_duration_minutes, 60)) AS offs
    WHERE bh * 60 + offs < 23 * 60
  ) AS s
  WHERE p.ativo = true
    AND (p.clinic_id IS NULL OR p.clinic_id = p_clinic_id)
    AND s.slot_min / 60 BETWEEN 6 AND 22
  ON CONFLICT (profissional_id, data, horario) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- n8n_cs_consultar_vagas: gera slots sub-horários conforme slot_duration_minutes do profissional
CREATE OR REPLACE FUNCTION public.n8n_cs_consultar_vagas(
  p_clinic_id           uuid,
  p_data                date,
  p_profissional_id     text DEFAULT NULL,
  p_clinic_procedure_id text DEFAULT NULL,
  p_procedimento_nome   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_clinic      int[];
  v_proc        uuid;
  v_prof        uuid;
  v_nom         text;
  v_dur         int := 60;
  v_cutoff_time time;
BEGIN
  IF p_clinic_id IS NULL OR p_data IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_data = CURRENT_DATE THEN
    v_cutoff_time := (NOW() AT TIME ZONE 'America/Sao_Paulo')::time;
  ELSE
    v_cutoff_time := '00:00:00'::time;
  END IF;

  v_prof := NULL;
  IF p_profissional_id IS NOT NULL AND btrim(p_profissional_id) <> ''
    AND lower(btrim(p_profissional_id)) <> 'null' THEN
    BEGIN
      v_prof := btrim(p_profissional_id)::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN v_prof := NULL;
    END;
  END IF;

  v_proc := NULL;
  IF p_clinic_procedure_id IS NOT NULL AND btrim(p_clinic_procedure_id) <> ''
    AND lower(btrim(p_clinic_procedure_id)) <> 'null' THEN
    BEGIN
      v_proc := btrim(p_clinic_procedure_id)::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN v_proc := NULL;
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
    IF v_prof IS NOT NULL THEN
      SELECT COALESCE(pp.duration_minutes, cp.duration_minutes) INTO v_dur
      FROM public.clinic_procedures cp
      LEFT JOIN public.professional_procedures pp
        ON pp.clinic_procedure_id = cp.id
        AND pp.professional_id = (
          SELECT pr.id FROM public.professionals pr
          WHERE pr.cs_profissional_id = v_prof AND pr.clinic_id = p_clinic_id
          LIMIT 1
        )
      WHERE cp.id = v_proc AND cp.clinic_id = p_clinic_id;
    ELSE
      SELECT cp.duration_minutes INTO v_dur
      FROM public.clinic_procedures cp
      WHERE cp.id = v_proc AND cp.clinic_id = p_clinic_id;
    END IF;
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

  -- Gera slots sub-horários conforme slot_duration_minutes de cada profissional
  INSERT INTO public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel, bloqueio_manual)
  SELECT
    p.id,
    p_data,
    make_time((s.slot_min / 60)::int, (s.slot_min % 60)::int, 0),
    true,
    false
  FROM public.cs_profissionais p
  INNER JOIN public.professionals pr
    ON pr.cs_profissional_id = p.id
    AND pr.clinic_id = p_clinic_id
    AND COALESCE(pr.is_active, true) = true
  CROSS JOIN LATERAL (
    SELECT (bh * 60 + offs) AS slot_min
    FROM unnest(public.cs_prof_panel_hours_for_prof_date(p_clinic_id, p.id, p_data)) AS bh
    CROSS JOIN generate_series(0, 59, COALESCE(pr.slot_duration_minutes, p.slot_duration_minutes, 60)) AS offs
    WHERE bh * 60 + offs < 23 * 60
  ) AS s
  WHERE p.ativo = true
    AND p.clinic_id = p_clinic_id
    AND s.slot_min / 60 BETWEEN 6 AND 22
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
      'horario_id',              h.id,
      'data',                    to_char(h.data, 'DD/MM/YYYY'),
      'dia_semana',              trim(to_char(h.data, 'Day')),
      'horario',                 to_char(h.horario, 'HH24:MI'),
      'profissional_id',         p.id,
      'profissional',            p.nome,
      'especialidade',           p.especialidade,
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

REVOKE ALL ON FUNCTION public.n8n_cs_consultar_vagas(uuid, date, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.n8n_cs_consultar_vagas(uuid, date, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.n8n_cs_consultar_vagas(uuid, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_consultar_vagas(uuid, date, text, text, text) TO service_role;
