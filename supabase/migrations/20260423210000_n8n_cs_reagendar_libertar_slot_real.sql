-- Reagendar: libertar o slot antigo usando profissional/data/hora REAIS em cs_agendamentos.
-- Se o agente envia p_horario_antigo / p_data_antiga / p_profissional_antigo_id ligeiramente
-- errados, o UPDATE antigo não batia e o horário ficava indisponível com marcação fantasma.

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
  v_ag_upd        int;
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

  SELECT a.profissional_id, a.data_agendamento, a.horario
  INTO v_cur_prof, v_cur_date, v_cur_time
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

  UPDATE public.cs_horarios_disponiveis
  SET disponivel = false
  WHERE profissional_id = p_novo_profissional_id
    AND data    = p_nova_data
    AND horario = p_novo_horario
    AND disponivel = true;

  GET DIAGNOSTICS v_booked = ROW_COUNT;
  IF v_booked = 0 THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'horario_indisponivel',
      'message', 'O novo horário não está disponível. Consulte as vagas antes de reagendar.'
    );
  END IF;

  UPDATE public.cs_horarios_disponiveis
  SET disponivel = true
  WHERE profissional_id = v_cur_prof
    AND data    = v_cur_date
    AND horario = v_cur_time;

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

  RETURN jsonb_build_object(
    'ok',                  true,
    'agendamento_id',      p_agendamento_id,
    'profissional_whatsapp', v_prof_whatsapp
  );
END;
$$;
