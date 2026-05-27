-- Preserva pausa manual (pause_until = 9999-12-31) quando a staff responde via WhatsApp.
--
-- Bug introduzido em 20260527190000: o DO UPDATE SET sobrescrevia pause_until com
-- now() + 10 min sem verificar se já era manual. Resultado: pausa manual do painel
-- era quebrada na próxima mensagem da staff e virava pausa de 10 min.
--
-- Fix: só carimbar 10 min se o valor existente não for manual (< 2100-01-01).

CREATE OR REPLACE FUNCTION public.n8n_cs_staff_assumir_sessao(p_instance_name text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clinic_id uuid;
BEGIN
  SELECT id INTO v_clinic_id
  FROM clinics
  WHERE instancia_evolution = p_instance_name
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

  INSERT INTO whatsapp_sessions (clinic_id, phone, needs_human, staff_handling, pause_until, updated_at)
  VALUES (
    v_clinic_id,
    split_part(p_phone, '@', 1),
    false,
    true,
    now() + interval '10 minutes',
    now()
  )
  ON CONFLICT (clinic_id, phone)
  DO UPDATE SET
    needs_human    = false,
    staff_handling = true,
    pause_until    = CASE
                       WHEN whatsapp_sessions.pause_until IS NOT NULL
                            AND whatsapp_sessions.pause_until >= '2100-01-01'::timestamptz
                         THEN whatsapp_sessions.pause_until
                       ELSE now() + interval '10 minutes'
                     END,
    updated_at     = now();

  RETURN jsonb_build_object('ok', true, 'clinic_id', v_clinic_id);
END;
$function$;
