-- ============================================================================
-- MIGRATION: Persistência WhatsApp Evolution por clínica (idempotente)
-- ============================================================================

-- Compatibilidade com fluxo legado no painel
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS instancia_evolution TEXT UNIQUE;

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS status_whatsapp TEXT DEFAULT 'desconectado';

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Modelo novo para integração WhatsApp (1 registro por clínica)
CREATE TABLE IF NOT EXISTS public.clinic_whatsapp_integrations (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics (id) ON DELETE CASCADE,
  instance_name text NOT NULL UNIQUE,
  instance_id text,
  phone_number text,
  status text NOT NULL DEFAULT 'disconnected',
  webhook_url text NOT NULL,
  webhook_configured boolean NOT NULL DEFAULT false,
  last_qr_code text,
  last_connection_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_whatsapp_integrations_status_check CHECK (
    status IN (
      'checking_config',
      'creating_instance',
      'configuring_webhook',
      'waiting_qrcode',
      'connected',
      'disconnected',
      'error'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_clinic_whatsapp_integrations_status
  ON public.clinic_whatsapp_integrations (status);

CREATE OR REPLACE FUNCTION public.set_updated_at_whatsapp_integrations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clinic_whatsapp_integrations_updated_at
  ON public.clinic_whatsapp_integrations;

CREATE TRIGGER trg_clinic_whatsapp_integrations_updated_at
  BEFORE UPDATE ON public.clinic_whatsapp_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_whatsapp_integrations();

-- Backfill inicial para clínicas já existentes
INSERT INTO public.clinic_whatsapp_integrations (
  clinic_id,
  instance_name,
  status,
  webhook_url,
  webhook_configured,
  created_at,
  updated_at
)
SELECT
  c.id,
  COALESCE(c.instancia_evolution, 'clinica-' || c.id::text),
  CASE c.status_whatsapp
    WHEN 'conectado' THEN 'connected'
    WHEN 'aguardando_qr' THEN 'waiting_qrcode'
    ELSE 'disconnected'
  END,
  COALESCE(NULLIF(current_setting('app.evolution_webhook_url', true), ''), 'pending://set-env'),
  false,
  now(),
  now()
FROM public.clinics c
ON CONFLICT (clinic_id) DO NOTHING;
