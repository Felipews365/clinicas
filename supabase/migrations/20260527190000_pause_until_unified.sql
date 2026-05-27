-- Unifica a lógica de pausa do bot por cliente via pause_until.
--
-- Problema: a RPC n8n_cs_verificar_reativar_bot tinha um caminho legado que reativa
-- o bot automaticamente quando pause_until IS NULL e a sessão está parada há mais de
-- 10 min. Clientes pausados via WhatsApp staff takeover (n8n_cs_staff_assumir_sessao)
-- ficavam com pause_until=NULL e auto-reativavam silenciosamente — fazendo o agente
-- responder mesmo quando o painel mostrava "PAUSADO" ou o utilizador esperava bloqueio.
--
-- Solução: toda sessão com staff_handling=true tem pause_until explícito. O caminho
-- legado é removido. Staff WhatsApp passa a carimbar pause_until = now + 10 min em
-- cada mensagem (renova a janela).

-- 1) Backfill das linhas órfãs (staff_handling=true mas pause_until=NULL)
UPDATE public.whatsapp_sessions
   SET pause_until = COALESCE(updated_at, now()) + interval '10 minutes'
 WHERE staff_handling = true
   AND pause_until IS NULL;

-- 2) Staff WhatsApp takeover passa a setar pause_until explícito
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
    pause_until    = now() + interval '10 minutes',
    updated_at     = now();

  RETURN jsonb_build_object('ok', true, 'clinic_id', v_clinic_id);
END;
$function$;

-- 3) RPC de verificação só reativa via pause_until vencido (sem caminho legado)
CREATE OR REPLACE FUNCTION public.n8n_cs_verificar_reativar_bot(
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

  IF v_staff_handling = true
     AND v_pause_until IS NOT NULL
     AND v_pause_until < '2100-01-01'::timestamptz
     AND now() >= v_pause_until THEN
    v_should_reactivate := true;
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
