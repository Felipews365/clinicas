-- Fins de semana: domingo sempre fechado; sábado configurável (abre/fecha + grade de horas).

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS sabado_aberto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sabado_agenda_hours integer[] NULL;

COMMENT ON COLUMN public.clinics.sabado_aberto IS 'Se true, sábado usa sabado_agenda_hours; se essa coluna for null, usa agenda_visible_hours.';
COMMENT ON COLUMN public.clinics.sabado_agenda_hours IS 'Horas inteiras 6–22 visíveis aos sábados; null = mesmo que agenda_visible_hours quando sabado_aberto.';

-- Helper: horas de grade válidas para uma data (timezone da clínica não entra aqui — só calendário civil da data).
CREATE OR REPLACE FUNCTION public.clinic_hours_for_date(p_clinic_id uuid, p_data date)
RETURNS integer[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_rec record;
  v_dow int;
  v_out int[];
  v_default int[] := ARRAY[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[];
BEGIN
  IF p_clinic_id IS NULL OR p_data IS NULL THEN
    RETURN ARRAY[]::integer[];
  END IF;

  SELECT c.agenda_visible_hours, c.sabado_aberto, c.sabado_agenda_hours
  INTO c_rec
  FROM public.clinics c
  WHERE c.id = p_clinic_id;

  IF NOT FOUND THEN
    RETURN v_default;
  END IF;

  v_dow := EXTRACT(DOW FROM p_data)::int;

  -- 0 = domingo: sem atendimento
  IF v_dow = 0 THEN
    RETURN ARRAY[]::integer[];
  END IF;

  IF v_dow = 6 THEN
    IF NOT COALESCE(c_rec.sabado_aberto, false) THEN
      RETURN ARRAY[]::integer[];
    END IF;
    IF c_rec.sabado_agenda_hours IS NOT NULL AND cardinality(c_rec.sabado_agenda_hours) > 0 THEN
      v_out := c_rec.sabado_agenda_hours;
    ELSE
      v_out := COALESCE(c_rec.agenda_visible_hours, v_default);
    END IF;
  ELSE
    v_out := COALESCE(c_rec.agenda_visible_hours, v_default);
  END IF;

  IF v_out IS NULL OR cardinality(v_out) = 0 THEN
    RETURN v_default;
  END IF;

  RETURN v_out;
END;
$$;

-- n8n: vagas respeitam dia da semana + disponivel
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

  v_hours := public.clinic_hours_for_date(p_clinic_id, p_data);

  IF v_hours IS NULL OR cardinality(v_hours) = 0 THEN
    RETURN '[]'::jsonb;
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
        AND EXTRACT(hour FROM h.horario)::integer = ANY(v_hours)
    ),
    '[]'::jsonb
  );
END;
$function$;

-- Painel: slots do dia usam a mesma regra
CREATE OR REPLACE FUNCTION public.painel_cs_slots_dia(p_clinic_id uuid, p_data date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours int[];
BEGIN
  IF NOT public.rls_has_clinic_access(p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  v_hours := public.clinic_hours_for_date(p_clinic_id, p_data);

  IF v_hours IS NULL OR cardinality(v_hours) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'horario_id', h.id,
          'profissional_id', p.id,
          'profissional_nome', p.nome,
          'especialidade', p.especialidade,
          'nome_procedimento', (
            SELECT COALESCE(NULLIF(trim(a.nome_procedimento), ''), sv.nome)::text
            FROM public.cs_agendamentos a
            INNER JOIN public.cs_servicos sv ON sv.id = a.servico_id
            WHERE a.profissional_id = h.profissional_id
              AND a.data_agendamento = h.data
              AND a.horario = h.horario
              AND a.status NOT IN ('cancelado', 'concluido')
              AND COALESCE(a.clinic_id, p.clinic_id) = p_clinic_id
            LIMIT 1
          ),
          'data', h.data,
          'horario', to_char(h.horario, 'HH24:MI'),
          'disponivel', CASE
            WHEN COALESCE(h.bloqueio_manual, false) THEN false
            WHEN EXISTS (
              SELECT 1 FROM public.cs_agendamentos a
              WHERE a.profissional_id = h.profissional_id
                AND a.data_agendamento = h.data
                AND a.horario = h.horario
                AND a.status NOT IN ('cancelado', 'concluido')
                AND COALESCE(a.clinic_id, p.clinic_id) = p_clinic_id
            ) THEN false
            ELSE true
          END,
          'indisponivel_por', CASE
            WHEN COALESCE(h.bloqueio_manual, false) THEN 'medico'
            WHEN EXISTS (
              SELECT 1 FROM public.cs_agendamentos a
              WHERE a.profissional_id = h.profissional_id
                AND a.data_agendamento = h.data
                AND a.horario = h.horario
                AND a.status NOT IN ('cancelado', 'concluido')
                AND COALESCE(a.clinic_id, p.clinic_id) = p_clinic_id
            ) THEN 'cliente'
            ELSE NULL
          END,
          'bloqueio_manual', COALESCE(h.bloqueio_manual, false)
        )
        ORDER BY p.nome ASC, h.horario ASC
      )
      FROM public.cs_horarios_disponiveis h
      INNER JOIN public.cs_profissionais p ON p.id = h.profissional_id
      WHERE h.data = p_data
        AND p.ativo = true
        AND p.clinic_id = p_clinic_id
        AND EXTRACT(hour FROM h.horario)::integer = ANY(v_hours)
    ),
    '[]'::jsonb
  );
END;
$$;

-- Validar clique na grade conforme o dia do slot
CREATE OR REPLACE FUNCTION public.painel_cs_set_slot_disponivel(
  p_clinic_id uuid,
  p_horario_id uuid,
  p_disponivel boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_hour int;
  v_hours int[];
  v_slot_date date;
BEGIN
  IF NOT public.rls_has_clinic_access(p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT h.data, EXTRACT(hour FROM h.horario)::integer
  INTO v_slot_date, v_hour
  FROM public.cs_horarios_disponiveis h
  WHERE h.id = p_horario_id;

  v_hours := public.clinic_hours_for_date(p_clinic_id, v_slot_date);

  IF v_hour IS NULL OR NOT (v_hour = ANY(v_hours)) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'hour_not_in_clinic_agenda',
      'message', 'Este horário não está habilitado para este dia na configuração da clínica.'
    );
  END IF;

  SELECT true
  INTO v_ok
  FROM public.cs_horarios_disponiveis h
  INNER JOIN public.cs_profissionais p ON p.id = h.profissional_id
  WHERE h.id = p_horario_id
    AND p.ativo = true
    AND p.clinic_id = p_clinic_id
  LIMIT 1;

  IF v_ok IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found_or_forbidden');
  END IF;

  UPDATE public.cs_horarios_disponiveis
  SET
    disponivel = p_disponivel,
    bloqueio_manual = CASE WHEN p_disponivel THEN false ELSE true END
  WHERE id = p_horario_id;

  RETURN jsonb_build_object('ok', true, 'disponivel', p_disponivel);
END;
$$;
