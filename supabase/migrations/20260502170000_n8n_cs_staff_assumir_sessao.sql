CREATE OR REPLACE FUNCTION n8n_cs_staff_assumir_sessao(
  p_instance_name text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id uuid;
BEGIN
  SELECT id INTO v_clinic_id
  FROM clinics
  WHERE instance_name = p_instance_name
  LIMIT 1;

  IF v_clinic_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clinica_nao_encontrada');
  END IF;

  UPDATE cs_clientes
  SET bot_ativo = false
  WHERE clinic_id = v_clinic_id
    AND (
      telefone = p_phone
      OR telefone = p_phone || '@s.whatsapp.net'
      OR telefone = split_part(p_phone, '@', 1)
      OR telefone = split_part(p_phone, '@', 1) || '@s.whatsapp.net'
    );

  INSERT INTO whatsapp_sessions (clinic_id, phone, needs_human, staff_handling, updated_at)
  VALUES (v_clinic_id, split_part(p_phone, '@', 1), false, true, now())
  ON CONFLICT (clinic_id, phone)
  DO UPDATE SET
    needs_human = false,
    staff_handling = true,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'clinic_id', v_clinic_id);
END;
$$;
