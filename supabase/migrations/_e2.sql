CREATE OR REPLACE FUNCTION public.n8n_cs_reagendar(
  p_agendamento_id       uuid,
  p_nova_data            date,
  p_novo_horario         time,
  p_novo_profissional_id uuid,
  p_profissional_antigo_id uuid,
  p_data_antiga          date,
  p_horario_antigo       time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome_prof     text;
  v_same_slot     boolean;
  v_booked        int;
  v_clinic_id     uuid;
  v_prof_whatsapp text;
  v_cur_prof      uuid;
  v_cur_date      date;
  v_cur_time      time;
  v_cliente_id    uuid;
  v_ag_upd        int;
  v_dur           int := 60;
BEGIN
  SELECT csp.nome, csp.clinic_id, prof.whatsapp
  INTO   v_nome_prof, v_clinic_id, v_prof_whatsapp
  FROM   public.cs_profissionais csp
  LEFT JOIN public.professionals prof
    ON prof.cs_profissional_id = csp.id
    AND prof.clinic_id = csp.clinic_id
  WHERE  csp.id = p_novo_profissional_id;

  IF v_nome_prof IS NULL THEN
    RAISE EXCEPTION 'p_novo_profissional_id inválido: %', p_novo_profissional_id;
  END IF;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'profissional sem clinic_id (associar à clínica antes de reagendar)';
  END IF;

  SELECT a.profissional_id, a.data_agendamento, a.horario, a.cliente_id,
    coalesce(a.duracao_minutos, 60)
  INTO v_cur_prof, v_cur_date, v_cur_time, v_cliente_id, v_dur
  FROM public.cs_agendamentos a
  WHERE a.id = p_agendamento_id
    AND a.status NOT IN ('cancelado', 'concluido');

  IF NOT FOUND OR v_cur_prof IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'agendamento_nao_encontrado',
      'message', 'Agendamento inexistente ou já cancelado/concluído.'
    );
  END IF;

  v_same_slot :=
    p_novo_profissional_id = v_cur_prof
    AND p_nova_data = v_cur_date
    AND p_novo_horario = v_cur_time;

  IF v_same_slot THEN
    UPDATE public.cs_agendamentos
    SET
      clinic_id     = coalesce(clinic_id, v_clinic_id),
      atualizado_em = now()
    WHERE id = p_agendamento_id;

    RETURN jsonb_build_object(
      'ok',                  true,
      'agendamento_id',      p_agendamento_id,
      'profissional_whatsapp', v_prof_whatsapp
    );
  END IF;

  UPDATE public.cs_horarios_disponiveis h
  SET disponivel = false
  WHERE h.profissional_id = p_novo_profissional_id
    AND h.data = p_nova_data
    AND h.disponivel = true
    AND (h.data + h.horario) < (p_nova_data + p_novo_horario) + (v_dur || ' minutes')::interval
    AND (h.data + h.horario) + interval '1 hour' > (p_nova_data + p_novo_horario);

  GET DIAGNOSTICS v_booked = ROW_COUNT;
  IF v_booked = 0 THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'horario_indisponivel',
      'message', 'O novo horário não está disponível. Consulte as vagas antes de reagendar.'
    );
  END IF;

  UPDATE public.cs_horarios_disponiveis h
  SET disponivel = true
  WHERE h.profissional_id = v_cur_prof
    AND h.data = v_cur_date
    AND (h.data + h.horario) < (v_cur_date + v_cur_time) + (v_dur || ' minutes')::interval
    AND (h.data + h.horario) + interval '1 hour' > (v_cur_date + v_cur_time);

  UPDATE public.cs_agendamentos
  SET
    data_agendamento  = p_nova_data,
    horario           = p_novo_horario,
    profissional_id   = p_novo_profissional_id,
    nome_profissional = v_nome_prof,
    status            = 'reagendado',
    clinic_id         = v_clinic_id,
    atualizado_em     = now()
  WHERE id = p_agendamento_id
    AND status NOT IN ('cancelado', 'concluido');

  GET DIAGNOSTICS v_ag_upd = ROW_COUNT;
  IF v_ag_upd <> 1 THEN
    RAISE EXCEPTION 'n8n_cs_reagendar: falha ao atualizar agendamento %', p_agendamento_id;
  END IF;

  UPDATE public.cs_agendamentos d
  SET
    status        = 'cancelado',
    atualizado_em = now()
  WHERE d.clinic_id = v_clinic_id
    AND d.cliente_id = v_cliente_id
    AND d.id <> p_agendamento_id
    AND d.status NOT IN ('cancelado', 'concluido')
    AND d.profissional_id = v_cur_prof
    AND d.data_agendamento = v_cur_date
    AND date_trunc('minute', d.horario) = date_trunc('minute', v_cur_time);

  RETURN jsonb_build_object(
    'ok',                  true,
    'agendamento_id',      p_agendamento_id,
    'profissional_whatsapp', v_prof_whatsapp
  );
END;
$$;

