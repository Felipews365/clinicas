-- Sistema de aviso de bloqueio (trial expirado / plano vencido / clínica inactiva)
-- enviado 1x por sessão WhatsApp via n8n.
--
-- Tenant-safe: tudo filtrado por clinic_id; sem hardcode de clínicas.

-- 1) Coluna em whatsapp_sessions para registar quando o aviso foi enviado nesta sessão.
ALTER TABLE public.whatsapp_sessions
  ADD COLUMN IF NOT EXISTS bloqueio_avisado_em timestamptz NULL;

-- 2) RPC atómica: chama na entrada do bloqueio. Se já avisou esta sessão, devolve false;
--    caso contrário marca now() e devolve true. n8n usa este boolean para decidir
--    se manda Evolution sendText ou se cala-se.
CREATE OR REPLACE FUNCTION public.n8n_cs_bloqueio_aviso_marcar(
  p_clinic_id uuid,
  p_phone text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_existing timestamptz;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_clinic_id IS NULL THEN
    RETURN false;
  END IF;

  v_phone := public._phone_digits(coalesce(p_phone, ''));
  IF v_phone = '' THEN
    RETURN false;
  END IF;

  -- Lê estado actual antes do upsert (lock optimista).
  SELECT bloqueio_avisado_em
    INTO v_existing
    FROM public.whatsapp_sessions
   WHERE clinic_id = p_clinic_id
     AND phone = v_phone
   FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    -- Já avisou esta sessão.
    RETURN false;
  END IF;

  -- Primeira vez — upsert com timestamp e devolve true.
  INSERT INTO public.whatsapp_sessions (clinic_id, phone, bloqueio_avisado_em)
  VALUES (p_clinic_id, v_phone, v_now)
  ON CONFLICT (clinic_id, phone) DO UPDATE
    SET bloqueio_avisado_em = EXCLUDED.bloqueio_avisado_em
    WHERE public.whatsapp_sessions.bloqueio_avisado_em IS NULL;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.n8n_cs_bloqueio_aviso_marcar(uuid, text) TO anon, authenticated, service_role;

-- 3) Trigger em clinics: quando admin renova/reactiva a clínica, limpa o aviso de bloqueio
--    de todas as sessões dessa clínica. Próxima mensagem dos clientes volta a fluir normal.
CREATE OR REPLACE FUNCTION public._clear_bloqueio_aviso_on_clinic_renew()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- "Renovou" = data_expiracao avançou, ativo passou a true, ou inadimplente passou a false.
  IF (
    (NEW.data_expiracao IS DISTINCT FROM OLD.data_expiracao
      AND NEW.data_expiracao IS NOT NULL
      AND (OLD.data_expiracao IS NULL OR NEW.data_expiracao > OLD.data_expiracao))
    OR (NEW.ativo = true AND OLD.ativo = false)
    OR (NEW.inadimplente = false AND OLD.inadimplente = true)
  ) THEN
    UPDATE public.whatsapp_sessions
       SET bloqueio_avisado_em = NULL
     WHERE clinic_id = NEW.id
       AND bloqueio_avisado_em IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_bloqueio_aviso_on_clinic_renew ON public.clinics;
CREATE TRIGGER trg_clear_bloqueio_aviso_on_clinic_renew
  AFTER UPDATE OF data_expiracao, ativo, inadimplente ON public.clinics
  FOR EACH ROW
  EXECUTE FUNCTION public._clear_bloqueio_aviso_on_clinic_renew();

COMMENT ON FUNCTION public.n8n_cs_bloqueio_aviso_marcar(uuid, text) IS
  'Throttle 1x/sessão WhatsApp do aviso de clínica bloqueada (trial expirado / plano vencido / ativa=false). Devolve true se o n8n deve enviar agora, false se já avisou esta sessão.';
