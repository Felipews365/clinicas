-- Corrige n8n_cs_verificar_reativar_bot para usar whatsapp_sessions.updated_at
-- em vez de n8n_chat_histories.created_at.
--
-- Bug anterior: quando bot está inativo, a IA não responde → nenhuma nova linha
-- em n8n_chat_histories. O timer de 10 min era contado a partir da última resposta
-- do agente (antes do handoff), não da última mensagem do staff.
--
-- Correção: usar whatsapp_sessions.updated_at — atualizado pelo
-- n8n_cs_staff_assumir_sessao a cada mensagem do staff (ON CONFLICT DO UPDATE).
-- Reativar APENAS se staff_handling=true E updated_at > 10 min atrás.

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
  v_needs_human    boolean;
  v_staff_handling boolean;
  v_ultima_interacao timestamptz;
  v_reativado      boolean := false;
  v_phone          text;
BEGIN
  v_phone := split_part(p_telefone, '@', 1);

  SELECT needs_human, staff_handling, updated_at
    INTO v_needs_human, v_staff_handling, v_ultima_interacao
  FROM whatsapp_sessions
  WHERE clinic_id = p_clinic_id
    AND phone = v_phone;

  -- Só reativa se staff assumiu a conversa E ficou +10 min sem responder
  IF v_staff_handling = true
     AND v_ultima_interacao IS NOT NULL
     AND v_ultima_interacao < now() - interval '10 minutes' THEN

    UPDATE cs_clientes
       SET bot_ativo = true
     WHERE clinic_id = p_clinic_id
       AND (
         telefone = p_telefone
         OR telefone = v_phone || '@s.whatsapp.net'
         OR telefone = v_phone
       );

    UPDATE whatsapp_sessions
       SET needs_human   = false,
           staff_handling = false,
           updated_at    = now()
     WHERE clinic_id = p_clinic_id
       AND phone = v_phone;

    v_reativado := true;
  END IF;

  RETURN jsonb_build_object(
    'reativado',        v_reativado,
    'staff_handling',   COALESCE(v_staff_handling, false),
    'needs_human',      COALESCE(v_needs_human, false),
    'ultima_msg_em',    v_ultima_interacao,
    'minutos_inativos', CASE
                          WHEN v_ultima_interacao IS NULL THEN null
                          ELSE EXTRACT(EPOCH FROM (now() - v_ultima_interacao)) / 60
                        END
  );
END;
$$;
