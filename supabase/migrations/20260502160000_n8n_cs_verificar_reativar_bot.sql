CREATE OR REPLACE FUNCTION n8n_cs_verificar_reativar_bot(
  p_clinic_id uuid,
  p_telefone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ultima_msg timestamptz;
  v_reativado boolean := false;
  v_session_id_1 text;
  v_session_id_2 text;
BEGIN
  v_session_id_1 := p_clinic_id::text || ':' || p_telefone;
  v_session_id_2 := p_clinic_id::text || ':' || split_part(p_telefone, '@', 1) || '@s.whatsapp.net';

  SELECT MAX(created_at) INTO v_ultima_msg
  FROM n8n_chat_histories
  WHERE session_id IN (v_session_id_1, v_session_id_2);

  IF v_ultima_msg IS NULL OR v_ultima_msg < now() - interval '10 minutes' THEN
    UPDATE cs_clientes
    SET bot_ativo = true
    WHERE clinic_id = p_clinic_id
      AND (telefone = p_telefone OR telefone = split_part(p_telefone, '@', 1) || '@s.whatsapp.net' OR telefone = split_part(p_telefone, '@', 1));

    UPDATE whatsapp_sessions
    SET needs_human = false, staff_handling = false, updated_at = now()
    WHERE clinic_id = p_clinic_id
      AND phone = split_part(p_telefone, '@', 1);

    v_reativado := true;
  END IF;

  RETURN jsonb_build_object(
    'reativado', v_reativado,
    'ultima_msg_em', v_ultima_msg,
    'minutos_inativos', EXTRACT(EPOCH FROM (now() - COALESCE(v_ultima_msg, now() - interval '999 minutes'))) / 60
  );
END;
$$;
