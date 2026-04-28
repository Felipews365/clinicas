-- Filtra vagas por procedimento (clinic_procedures.id = servico_id do agente).
-- Profissional sem linhas em professional_procedures → continua a poder todos os serviços.
-- Profissional com linhas → só aparece se uma delas for p_clinic_procedure_id.

DROP FUNCTION IF EXISTS public.n8n_cs_consultar_vagas (uuid, date, uuid);

CREATE OR REPLACE FUNCTION public.n8n_cs_consultar_vagas (
  p_clinic_id uuid,
  p_data date,
  p_profissional_id uuid DEFAULT NULL::uuid,
  p_clinic_procedure_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clinic int[];
  v_proc uuid;
BEGIN
  IF p_clinic_id IS NULL OR p_data IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_proc := p_clinic_procedure_id;
  IF v_proc IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.clinic_procedures c
    WHERE c.id = v_proc
      AND c.clinic_id = p_clinic_id
  ) THEN
    v_proc := NULL;
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
  INNER JOIN public.professionals pr
    ON pr.cs_profissional_id = p.id
    AND pr.clinic_id = p_clinic_id
    AND COALESCE (pr.is_active, true) = true
  CROSS JOIN LATERAL unnest (
    public.cs_prof_panel_hours_for_prof_date (p_clinic_id, p.id, p_data)
  ) AS s(h)
  WHERE p.ativo = true
    AND p.clinic_id = p_clinic_id
    AND s.h BETWEEN 6 AND 22
    AND (p_profissional_id IS NULL OR p.id = p_profissional_id)
    AND (
      v_proc IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.professional_procedures pp0
        WHERE pp0.professional_id = pr.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.professional_procedures pp1
        WHERE pp1.professional_id = pr.id
          AND pp1.clinic_procedure_id = v_proc
      )
    )
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
      INNER JOIN public.professionals pr
        ON pr.cs_profissional_id = p.id
        AND pr.clinic_id = p_clinic_id
        AND COALESCE (pr.is_active, true) = true
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
            AND coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
        )
        AND (p_profissional_id IS NULL OR p.id = p_profissional_id)
        AND (
          v_proc IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM public.professional_procedures pp0
            WHERE pp0.professional_id = pr.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.professional_procedures pp1
            WHERE pp1.professional_id = pr.id
              AND pp1.clinic_procedure_id = v_proc
          )
        )
        AND EXTRACT (hour FROM h.horario)::integer = ANY (
          public.cs_prof_panel_hours_for_prof_date (p_clinic_id, p.id, p_data)
        )
    ),
    '[]'::jsonb
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.n8n_cs_consultar_vagas (uuid, date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.n8n_cs_consultar_vagas (uuid, date, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.n8n_cs_consultar_vagas (uuid, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_consultar_vagas (uuid, date, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.n8n_cs_consultar_vagas (uuid, date, uuid, uuid) IS
  'Vagas por dia; p_clinic_procedure_id opcional — restringe a profissionais que realizam esse procedimento (ou sem restrição no painel).';
