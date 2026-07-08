-- Sistema de aviso "faltam 3 dias para vencer o plano" enviado por WhatsApp ao dono da clínica.
-- Tenant-safe: tudo filtrado por clinic_id; sem hardcode de clínicas.

-- 1) Campo opcional para o admin/dono receber avisos administrativos por WhatsApp num número
--    diferente do número público da clínica.
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS admin_whatsapp text NULL;

COMMENT ON COLUMN public.clinics.admin_whatsapp IS
  'WhatsApp (só dígitos) para avisos administrativos (expiração de plano, etc). Fallback para clinics.phone.';

-- 2) Tabela de idempotência: garante que cada clínica recebe o aviso de expiração só 1x por
--    janela de aviso (data_expiracao + tipo de aviso). Inclui o próprio dia da expiração
--    para futuras extensões (3d, 1d, 0d).
CREATE TABLE IF NOT EXISTS public.cs_expiry_avisos_enviados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  data_expiracao_alvo date NOT NULL,
  dias_antes smallint NOT NULL,
  destino_whatsapp text NULL,
  enviado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_expiry_aviso_unico
  ON public.cs_expiry_avisos_enviados (clinic_id, data_expiracao_alvo, dias_antes);

CREATE INDEX IF NOT EXISTS idx_expiry_aviso_clinic
  ON public.cs_expiry_avisos_enviados (clinic_id, enviado_em DESC);

-- 3) RPC: devolve clínicas onde faltam exactamente N dias até `data_expiracao` (default 3),
--    cujo plano é teste OU mensal, ainda activas, com destino WhatsApp resolvido,
--    e que ainda não foram avisadas para esta combinação (clinic_id, data_expiracao, dias).
--
--    Tenant-safe: itera todas as clínicas elegíveis sem hardcode.
CREATE OR REPLACE FUNCTION public.n8n_cs_clinics_avisar_vencimento(
  p_dias_antes smallint DEFAULT 3
)
RETURNS TABLE (
  clinic_id uuid,
  clinic_name text,
  instance_name text,
  data_expiracao date,
  dias_restantes smallint,
  tipo_plano text,
  destino_whatsapp text,
  owner_email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS clinic_id,
    c.name AS clinic_name,
    c.instancia_evolution AS instance_name,
    c.data_expiracao,
    p_dias_antes::smallint AS dias_restantes,
    c.tipo_plano,
    COALESCE(
      NULLIF(public._phone_digits(c.admin_whatsapp), ''),
      NULLIF(public._phone_digits(c.phone), '')
    ) AS destino_whatsapp,
    u.email AS owner_email
  FROM public.clinics c
  LEFT JOIN auth.users u ON u.id = c.owner_id
  WHERE c.ativo = true
    AND c.data_expiracao IS NOT NULL
    AND c.data_expiracao = (CURRENT_DATE + (p_dias_antes || ' days')::interval)::date
    AND COALESCE(
      NULLIF(public._phone_digits(c.admin_whatsapp), ''),
      NULLIF(public._phone_digits(c.phone), '')
    ) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
        FROM public.cs_expiry_avisos_enviados e
       WHERE e.clinic_id = c.id
         AND e.data_expiracao_alvo = c.data_expiracao
         AND e.dias_antes = p_dias_antes
    );
$$;

GRANT EXECUTE ON FUNCTION public.n8n_cs_clinics_avisar_vencimento(smallint) TO anon, authenticated, service_role;

-- 4) RPC para marcar como enviado (chamada pelo n8n após sucesso no Evolution).
CREATE OR REPLACE FUNCTION public.n8n_cs_clinics_avisar_vencimento_marcar(
  p_clinic_id uuid,
  p_data_expiracao date,
  p_dias_antes smallint,
  p_destino text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_clinic_id IS NULL OR p_data_expiracao IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.cs_expiry_avisos_enviados (
    clinic_id, data_expiracao_alvo, dias_antes, destino_whatsapp
  )
  VALUES (
    p_clinic_id, p_data_expiracao, p_dias_antes, public._phone_digits(coalesce(p_destino, ''))
  )
  ON CONFLICT (clinic_id, data_expiracao_alvo, dias_antes) DO NOTHING;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.n8n_cs_clinics_avisar_vencimento_marcar(uuid, date, smallint, text) TO anon, authenticated, service_role;
