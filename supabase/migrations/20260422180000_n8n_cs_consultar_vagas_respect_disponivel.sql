-- Alinha lista de vagas com o flag disponivel (mesma lógica visual do painel).
-- Evita sugerir slot que está marcado indisponível sem agendamento órfão.

CREATE OR REPLACE FUNCTION public.n8n_cs_consultar_vagas(p_clinic_id uuid, p_data date, p_profissional_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hours int[];
BEGIN
  IF p_clinic_id IS NULL OR p_data IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(c.agenda_visible_hours, ARRAY[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[])
  INTO v_hours
  FROM public.clinics c
  WHERE c.id = p_clinic_id;

  IF v_hours IS NULL OR cardinality(v_hours) = 0 THEN
    v_hours := ARRAY[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[];
  END IF;

  INSERT INTO public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel, bloqueio_manual)
  SELECT
    p.id,
    p_data,
    make_time(s.h::int, 0, 0),
    true,
    false
  FROM public.cs_profissionais p
  LEFT JOIN public.professionals pr
    ON pr.cs_profissional_id = p.id
    AND pr.clinic_id = p_clinic_id
    AND pr.is_active = true
  CROSS JOIN LATERAL unnest(COALESCE(pr.agenda_hours, v_hours)) AS s(h)
  WHERE p.ativo = true
    AND (p.clinic_id IS NULL OR p.clinic_id = p_clinic_id)
    AND s.h BETWEEN 6 AND 22
    AND (p_profissional_id IS NULL OR p.id = p_profissional_id)
  ON CONFLICT (profissional_id, data, horario) DO NOTHING;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'horario_id', h.id,
          'data', to_char(h.data, 'DD/MM/YYYY'),
          'dia_semana', trim(to_char(h.data, 'Day')),
          'horario', to_char(h.horario, 'HH24:MI'),
          'profissional_id', p.id,
          'profissional', p.nome,
          'especialidade', p.especialidade
        ) ORDER BY h.horario
      )
      FROM public.cs_horarios_disponiveis h
      INNER JOIN public.cs_profissionais p ON p.id = h.profissional_id
      INNER JOIN public.clinics cl ON cl.id = p_clinic_id
      WHERE p.clinic_id = p_clinic_id
        AND h.data = p_data
        AND p.ativo = true
        AND COALESCE(h.disponivel, true) = true
        AND COALESCE(h.bloqueio_manual, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM public.cs_agendamentos a
          WHERE a.profissional_id = h.profissional_id
            AND a.data_agendamento = h.data
            AND a.horario = h.horario
            AND a.status NOT IN ('cancelado', 'concluido')
        )
        AND (p_profissional_id IS NULL OR p.id = p_profissional_id)
        AND EXTRACT(hour FROM h.horario)::integer = ANY(
          COALESCE(cl.agenda_visible_hours, ARRAY[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[])
        )
    ),
    '[]'::jsonb
  );
END;
$function$;
