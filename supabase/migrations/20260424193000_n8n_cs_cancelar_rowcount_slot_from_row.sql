-- n8n_cs_cancelar: não devolver ok:true se nenhuma linha for cancelada;
-- libertar slot com data/hora reais da linha (evita falha após reagendamento com params antigos).

CREATE OR REPLACE FUNCTION public.n8n_cs_cancelar(
  p_agendamento_id  uuid,
  p_profissional_id uuid,
  p_data            date,
  p_horario         time,
  p_motivo          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prof_whatsapp text;
  v_row_prof      uuid;
  v_row_data      date;
  v_row_horario   time;
  v_row_status    text;
  v_upd           int;
BEGIN
  SELECT a.profissional_id, a.data_agendamento, a.horario, a.status
  INTO   v_row_prof, v_row_data, v_row_horario, v_row_status
  FROM   public.cs_agendamentos a
  WHERE  a.id = p_agendamento_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'agendamento_nao_encontrado',
      'message', 'Não existe cs_agendamentos com este id.'
    );
  END IF;

  SELECT prof.whatsapp
  INTO   v_prof_whatsapp
  FROM   public.cs_profissionais csp
  LEFT JOIN public.professionals prof
    ON prof.cs_profissional_id = csp.id
    AND prof.clinic_id = csp.clinic_id
  WHERE  csp.id = v_row_prof;

  IF v_row_status IN ('cancelado', 'concluido') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'agendamento_id', p_agendamento_id,
      'profissional_whatsapp', v_prof_whatsapp,
      'already_terminal', true
    );
  END IF;

  UPDATE public.cs_agendamentos
  SET
    status              = 'cancelado',
    motivo_cancelamento = coalesce(nullif(trim(p_motivo), ''), 'Cancelado pelo cliente'),
    atualizado_em       = now()
  WHERE id = p_agendamento_id
    AND status NOT IN ('cancelado', 'concluido');

  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd <> 1 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'cancelamento_falhou',
      'message', 'Não foi possível cancelar (estado inesperado).'
    );
  END IF;

  UPDATE public.cs_horarios_disponiveis
  SET disponivel = true
  WHERE profissional_id = v_row_prof
    AND data = v_row_data
    AND date_trunc('minute', horario) = date_trunc('minute', v_row_horario);

  RETURN jsonb_build_object(
    'ok', true,
    'agendamento_id', p_agendamento_id,
    'profissional_whatsapp', v_prof_whatsapp
  );
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_cs_cancelar(uuid, uuid, date, time, text) TO anon;
