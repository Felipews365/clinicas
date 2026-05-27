-- Pausa rolling: quando a staff responde via WhatsApp, o bot só volta após
-- 10 min de SILÊNCIO (sem mensagens do cliente nem da staff). Cada nova mensagem
-- durante a pausa rolling renova a janela de 10 min.
--
-- Pausas escolhidas no painel (Manual ou X minutos/horas) mantêm a duração
-- exata escolhida pelo utilizador — não são prolongadas por mensagens do cliente.
--
-- Implementação: nova coluna pause_mode discrimina os 3 casos.

ALTER TABLE public.whatsapp_sessions
  ADD COLUMN IF NOT EXISTS pause_mode text;

COMMENT ON COLUMN public.whatsapp_sessions.pause_mode IS
  'Tipo de pausa: manual (9999-12-31, painel), timed (duração fixa, painel), rolling (10 min renováveis, staff WhatsApp).';

-- Backfill: inferir o modo a partir do estado actual
UPDATE public.whatsapp_sessions
   SET pause_mode = CASE
                      WHEN pause_until IS NULL THEN NULL
                      WHEN pause_until >= '2100-01-01'::timestamptz THEN 'manual'
                      WHEN staff_handling = true THEN 'rolling'
                      ELSE 'timed'
                    END
 WHERE pause_mode IS NULL;

-- Staff WhatsApp takeover: marca 'rolling' (preserva 'manual' do painel se já existir)
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

  INSERT INTO whatsapp_sessions (clinic_id, phone, needs_human, staff_handling, pause_mode, pause_until, updated_at)
  VALUES (
    v_clinic_id,
    split_part(p_phone, '@', 1),
    false,
    true,
    'rolling',
    now() + interval '10 minutes',
    now()
  )
  ON CONFLICT (clinic_id, phone)
  DO UPDATE SET
    needs_human    = false,
    staff_handling = true,
    -- Preserva manual e timed (escolhas do painel); só renova rolling ou estado novo
    pause_mode     = CASE
                       WHEN whatsapp_sessions.pause_mode IN ('manual', 'timed')
                         THEN whatsapp_sessions.pause_mode
                       ELSE 'rolling'
                     END,
    pause_until    = CASE
                       WHEN whatsapp_sessions.pause_mode = 'manual'
                         THEN whatsapp_sessions.pause_until
                       WHEN whatsapp_sessions.pause_mode = 'timed'
                         THEN whatsapp_sessions.pause_until
                       ELSE now() + interval '10 minutes'
                     END,
    updated_at     = now();

  RETURN jsonb_build_object('ok', true, 'clinic_id', v_clinic_id);
END;
$function$;

-- RPC de verificação: na pausa 'rolling', cada mensagem do cliente renova os 10 min
-- até haver silêncio prolongado. 'timed' respeita a duração escolhida. 'manual' nunca.
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
  v_pause_mode       text;
  v_reativado        boolean := false;
  v_phone            text;
  v_should_reactivate boolean := false;
BEGIN
  v_phone := split_part(p_telefone, '@', 1);

  SELECT needs_human, staff_handling, updated_at, pause_until, pause_mode
    INTO v_needs_human, v_staff_handling, v_ultima_interacao, v_pause_until, v_pause_mode
  FROM whatsapp_sessions
  WHERE clinic_id = p_clinic_id
    AND phone = v_phone;

  IF v_staff_handling = true
     AND v_pause_until IS NOT NULL
     AND v_pause_mode <> 'manual'
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
           pause_mode     = null,
           pause_until    = null,
           updated_at     = now()
     WHERE clinic_id = p_clinic_id
       AND phone = v_phone;

    v_reativado := true;
  ELSE
    -- Mensagem do cliente durante pausa rolling renova os 10 min
    IF v_staff_handling = true AND v_pause_mode = 'rolling' THEN
      UPDATE whatsapp_sessions
         SET pause_until = now() + interval '10 minutes',
             updated_at  = now()
       WHERE clinic_id = p_clinic_id
         AND phone = v_phone;
      v_pause_until := now() + interval '10 minutes';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'reativado',        v_reativado,
    'staff_handling',   COALESCE(v_staff_handling, false),
    'needs_human',      COALESCE(v_needs_human, false),
    'pause_mode',       v_pause_mode,
    'ultima_msg_em',    v_ultima_interacao,
    'pause_until',      v_pause_until,
    'minutos_inativos', CASE
                          WHEN v_ultima_interacao IS NULL THEN null
                          ELSE EXTRACT(EPOCH FROM (now() - v_ultima_interacao)) / 60
                        END
  );
END;
$$;
