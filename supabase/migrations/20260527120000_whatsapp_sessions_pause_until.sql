-- Pausa do agente por cliente com duração escolhida no painel.
-- pause_until: quando reativar automaticamente; NULL = fallback 10 min desde updated_at (legado).

ALTER TABLE public.whatsapp_sessions
  ADD COLUMN IF NOT EXISTS pause_until timestamptz;

COMMENT ON COLUMN public.whatsapp_sessions.pause_until IS
  'Fim da pausa manual do agente (painel). NULL = reativação legada 10 min após updated_at.';

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
  v_needs_human      boolean;
  v_staff_handling   boolean;
  v_ultima_interacao timestamptz;
  v_pause_until      timestamptz;
  v_reativado        boolean := false;
  v_phone            text;
  v_should_reactivate boolean := false;
BEGIN
  v_phone := split_part(p_telefone, '@', 1);

  SELECT needs_human, staff_handling, updated_at, pause_until
    INTO v_needs_human, v_staff_handling, v_ultima_interacao, v_pause_until
  FROM whatsapp_sessions
  WHERE clinic_id = p_clinic_id
    AND phone = v_phone;

  IF v_staff_handling = true THEN
    IF v_pause_until IS NOT NULL
       AND v_pause_until < '2100-01-01'::timestamptz
       AND now() >= v_pause_until THEN
      v_should_reactivate := true;
    ELSIF v_pause_until IS NULL
       AND v_ultima_interacao IS NOT NULL
       AND v_ultima_interacao < now() - interval '10 minutes' THEN
      v_should_reactivate := true;
    END IF;
  END IF;

  IF v_should_reactivate THEN
    UPDATE cs_clientes
       SET bot_ativo = true
     WHERE clinic_id = p_clinic_id
       AND (
         telefone = p_telefone
         OR telefone = v_phone || '@s.whatsapp.net'
         OR telefone = v_phone
       );

    UPDATE whatsapp_sessions
       SET needs_human    = false,
           staff_handling = false,
           pause_until    = null,
           updated_at     = now()
     WHERE clinic_id = p_clinic_id
       AND phone = v_phone;

    v_reativado := true;
  END IF;

  RETURN jsonb_build_object(
    'reativado',        v_reativado,
    'staff_handling',   COALESCE(v_staff_handling, false),
    'needs_human',      COALESCE(v_needs_human, false),
    'ultima_msg_em',    v_ultima_interacao,
    'pause_until',      v_pause_until,
    'minutos_inativos', CASE
                          WHEN v_ultima_interacao IS NULL THEN null
                          ELSE EXTRACT(EPOCH FROM (now() - v_ultima_interacao)) / 60
                        END
  );
END;
$$;
