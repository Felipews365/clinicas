-- Backfill data_expiracao para clínicas no plano "teste" que ainda não têm data definida.
-- Antes desta migration, clínicas criadas antes da lógica de trial ficavam com data_expiracao = NULL
-- e apareciam como "Sem data definida" no painel. Agora ganham 7 dias a partir de hoje.
--
-- Tenant-safe: actua em TODAS as clínicas que satisfaçam o critério; não hardcoda nenhuma.
UPDATE clinics
SET data_expiracao = (CURRENT_DATE + INTERVAL '7 days')::date
WHERE data_expiracao IS NULL
  AND lower(coalesce(tipo_plano, '')) = 'teste';
