-- painel_cancel_cs_agendamento: além de ok, devolve dados para o painel avisar o profissional no WhatsApp
-- (o fluxo n8n só corre quando o cliente fala com o bot; cancelamentos na UI usam esta RPC).

CREATE OR REPLACE FUNCTION public.painel_cancel_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_slot uuid;
  v_whatsapp text;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT
    a.id,
    a.profissional_id,
    a.data_agendamento,
    a.horario,
    a.status,
    coalesce(nullif(trim(a.nome_cliente), ''), '') AS nome_cliente,
    coalesce(nullif(trim(a.nome_procedimento), ''), '') AS nome_procedimento
  INTO v
  FROM public.cs_agendamentos a
  INNER JOIN public.cs_profissionais p ON p.id = a.profissional_id
  WHERE
    a.id = p_cs_agendamento_id
    AND p.clinic_id = p_clinic_id
    AND coalesce(a.clinic_id, p.clinic_id) = p_clinic_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v.status = 'cancelado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_cancelled');
  END IF;

  SELECT h.id INTO v_slot
  FROM public.cs_horarios_disponiveis h
  WHERE
    h.profissional_id = v.profissional_id
    AND h.data = v.data_agendamento
    AND h.horario = v.horario
  FOR UPDATE OF h;

  IF FOUND THEN
    UPDATE public.cs_horarios_disponiveis
    SET disponivel = true
    WHERE id = v_slot;
  END IF;

  UPDATE public.cs_agendamentos
  SET
    status = 'cancelado',
    motivo_cancelamento = coalesce(motivo_cancelamento, 'Cancelado pelo painel'),
    atualizado_em = now()
  WHERE id = v.id;

  SELECT prof.whatsapp INTO v_whatsapp
  FROM public.professionals prof
  WHERE
    prof.cs_profissional_id = v.profissional_id
    AND prof.clinic_id = p_clinic_id;

  RETURN jsonb_build_object(
    'ok', true,
    'profissional_whatsapp', v_whatsapp,
    'nome_cliente', nullif(trim(v.nome_cliente), ''),
    'nome_procedimento', nullif(trim(v.nome_procedimento), ''),
    'data_agendamento', v.data_agendamento,
    'horario', to_char(v.horario, 'HH24:MI')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) TO service_role;
