-- Alinha n8n_cs_consultar_vagas com o painel: agendamentos de outro tenant não
-- devem esconder horário (NOT EXISTS ignorava clinic_id em cs_agendamentos).

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
            AND coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
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
