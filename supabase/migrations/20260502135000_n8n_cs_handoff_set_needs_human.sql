CREATE OR REPLACE FUNCTION n8n_cs_handoff_set_needs_human(
  p_clinic_id uuid,
  p_phone text,
  p_mensagem text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO whatsapp_sessions (clinic_id, phone, needs_human, staff_handling, last_message_preview, updated_at)
  VALUES (p_clinic_id, p_phone, true, false, p_mensagem, now())
  ON CONFLICT (clinic_id, phone)
  DO UPDATE SET
    needs_human = true,
    staff_handling = false,
    last_message_preview = EXCLUDED.last_message_preview,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;
