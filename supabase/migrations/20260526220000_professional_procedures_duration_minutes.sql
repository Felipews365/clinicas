-- Duração por profissional por procedimento.
-- Permite que cada profissional tenha um tempo de atendimento diferente para o mesmo procedimento.
-- Se preenchida, sobrepõe a duração padrão (clinic_procedures.duration_minutes) no agendamento.
ALTER TABLE public.professional_procedures
  ADD COLUMN IF NOT EXISTS duration_minutes integer
    CHECK (duration_minutes IS NULL OR (duration_minutes >= 5 AND duration_minutes <= 480));

-- Atualiza RPC para usar duração específica do profissional quando disponível (fallback: duração da clínica).
-- Também incorpora o fix do cutoff (now() exato, sem janela de -30min).
CREATE OR REPLACE FUNCTION n8n_cs_consultar_vagas(
  p_clinic_id uuid,
  p_data date,
  p_profissional_id text DEFAULT NULL,
  p_clinic_procedure_id text DEFAULT NULL,
  p_procedimento_nome text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_clinic int[];
  v_proc uuid;
  v_prof uuid;
  v_nom text;
  v_dur int := 60;
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

  INSERT INTO public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel, bloqueio_manual)
  SELECT p.id, p_data, make_time(s.h::int, 0, 0), true, false
  FROM public.cs_profissionais p
  INNER JOIN public.professionals pr ON pr.cs_profissional_id = p.id AND pr.clinic_id = p_clinic_id AND COALESCE(pr.is_active, true) = true
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
    INNER JOIN public.professionals pr ON pr.cs_profissional_id = p.id AND pr.clinic_id = p_clinic_id AND COALESCE(pr.is_active, true) = true
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
