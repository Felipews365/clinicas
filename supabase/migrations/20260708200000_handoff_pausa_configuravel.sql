-- Handoff staff via WhatsApp: pausa configurável por clínica.
--
-- Antes: quando o staff respondia pelo WhatsApp (fromMe=true), a RPC
-- n8n_cs_staff_assumir_sessao pausava a IA em modo 'rolling' com janela FIXA
-- de 10 minutos. Depois de 10 min de silêncio a IA voltava sozinha — a clínica
-- reclamou que "a IA continua respondendo" depois de assumir o atendimento.
--
-- Agora: a clínica define quanto tempo a IA fica pausada quando ela assume pelo
-- WhatsApp, via clinics.agent_instructions->>'handoff_pausa_minutos':
--   - > 0  → pausa 'timed' dessa duração (resetada a cada mensagem do staff;
--            mensagens do cliente NÃO estendem — a IA volta quando o tempo passa)
--   -  0   → 'manual' (a IA só volta quando reativarem no painel)
--   - ausente → default 60 min
--
-- Tenant-safe: tudo resolvido pelo clinic_id (via instancia_evolution). Sem hardcode.

-- ── Helper: minutos de pausa do handoff por clínica ──────────────────────────
CREATE OR REPLACE FUNCTION public._clinic_handoff_pausa_minutos(p_clinic_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    NULLIF(
      CASE
        WHEN jsonb_typeof(agent_instructions::jsonb) = 'object'
          THEN (agent_instructions::jsonb)->>'handoff_pausa_minutos'
        ELSE NULL
      END,
      ''
    )::integer,
    60
  )
  FROM public.clinics
  WHERE id = p_clinic_id;
$function$;

-- ── RPC: staff assume a sessão pelo WhatsApp ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.n8n_cs_staff_assumir_sessao(p_instance_name text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clinic_id uuid;
  v_minutos   integer;
  v_manual    boolean;
  v_pause_until timestamptz;
  v_mode      text;
BEGIN
  SELECT id INTO v_clinic_id
  FROM clinics
  WHERE instancia_evolution = p_instance_name
  LIMIT 1;

  IF v_clinic_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clinica_nao_encontrada');
  END IF;

  v_minutos := public._clinic_handoff_pausa_minutos(v_clinic_id);
  v_manual  := (v_minutos <= 0);
  v_mode    := CASE WHEN v_manual THEN 'manual' ELSE 'timed' END;
  v_pause_until := CASE
                     WHEN v_manual THEN '9999-12-31 23:59:59.999+00'::timestamptz
                     ELSE now() + make_interval(mins => v_minutos)
                   END;

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
    v_mode,
    v_pause_until,
    now()
  )
  ON CONFLICT (clinic_id, phone)
  DO UPDATE SET
    needs_human    = false,
    staff_handling = true,
    -- Pausa 'manual' vinda do painel tem prioridade: nunca a rebaixamos.
    pause_mode     = CASE
                       WHEN whatsapp_sessions.pause_mode = 'manual' THEN 'manual'
                       ELSE v_mode
                     END,
    -- Cada mensagem do staff reinicia a janela configurada (o staff continua ativo).
    pause_until    = CASE
                       WHEN whatsapp_sessions.pause_mode = 'manual' THEN whatsapp_sessions.pause_until
                       ELSE v_pause_until
                     END,
    updated_at     = now();

  RETURN jsonb_build_object('ok', true, 'clinic_id', v_clinic_id, 'pause_mode', v_mode, 'pausa_minutos', v_minutos);
END;
$function$;
