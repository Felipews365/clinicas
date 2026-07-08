CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.platform_settings (key, value)
VALUES ('openai_budget', jsonb_build_object('budget_usd', 0))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_ai_budget_status()
RETURNS TABLE (
  budget_usd numeric,
  spent_total_usd numeric,
  spent_mes_atual_usd numeric,
  remaining_usd numeric,
  pct_used numeric,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT
      COALESCE((value ->> 'budget_usd')::numeric, 0) AS budget_usd,
      updated_at
    FROM platform_settings
    WHERE key = 'openai_budget'
  ),
  mes_inicio AS (
    SELECT date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))
           AT TIME ZONE 'America/Sao_Paulo' AS ts
  ),
  spent AS (
    SELECT
      COALESCE(SUM(cost_usd), 0)::numeric AS total,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= (SELECT ts FROM mes_inicio)), 0)::numeric AS mes
    FROM ai_usage_logs
  )
  SELECT
    cfg.budget_usd,
    spent.total,
    spent.mes,
    GREATEST(cfg.budget_usd - spent.total, 0)::numeric AS remaining_usd,
    CASE
      WHEN cfg.budget_usd > 0
        THEN ROUND(LEAST(spent.total / cfg.budget_usd * 100, 999), 1)
      ELSE 0
    END AS pct_used,
    cfg.updated_at
  FROM cfg, spent;
$$;

GRANT EXECUTE ON FUNCTION public.admin_ai_budget_status() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_ai_budget(p_budget_usd numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_budget_usd IS NULL OR p_budget_usd < 0 THEN
    RAISE EXCEPTION 'budget_usd deve ser >= 0';
  END IF;

  INSERT INTO platform_settings (key, value, updated_at)
  VALUES ('openai_budget', jsonb_build_object('budget_usd', p_budget_usd), now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_ai_budget(numeric) TO service_role;
