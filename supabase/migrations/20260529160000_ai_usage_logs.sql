-- Tracking de uso/custo OpenAI por clinica
-- Cada chamada LLM/Whisper/Vision do n8n insere uma linha aqui via RPC.

CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  agent text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ai_usage_clinic_created
  ON public.ai_usage_logs (clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_ai_usage_agent
  ON public.ai_usage_logs (clinic_id, agent);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.n8n_ai_usage_log(
  p_clinic_id uuid,
  p_agent text,
  p_model text,
  p_prompt_tokens integer DEFAULT 0,
  p_completion_tokens integer DEFAULT 0,
  p_cost_usd numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_clinic_id IS NULL OR NOT EXISTS (SELECT 1 FROM clinics WHERE id = p_clinic_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO ai_usage_logs (
    clinic_id, agent, model,
    prompt_tokens, completion_tokens, cost_usd
  ) VALUES (
    p_clinic_id,
    COALESCE(NULLIF(btrim(p_agent), ''), 'desconhecido'),
    COALESCE(NULLIF(btrim(p_model), ''), 'desconhecido'),
    GREATEST(COALESCE(p_prompt_tokens, 0), 0),
    GREATEST(COALESCE(p_completion_tokens, 0), 0),
    GREATEST(COALESCE(p_cost_usd, 0), 0)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.n8n_ai_usage_log(uuid, text, text, integer, integer, numeric) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_ai_usage_per_clinic()
RETURNS TABLE (
  clinic_id uuid,
  cost_mes_atual_usd numeric,
  cost_total_usd numeric,
  tokens_mes_atual bigint,
  tokens_total bigint,
  chamadas_mes_atual bigint,
  chamadas_total bigint,
  ultima_chamada_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mes_inicio AS (
    SELECT date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))
           AT TIME ZONE 'America/Sao_Paulo' AS ts
  )
  SELECT
    l.clinic_id,
    COALESCE(SUM(l.cost_usd) FILTER (WHERE l.created_at >= (SELECT ts FROM mes_inicio)), 0)::numeric AS cost_mes_atual_usd,
    COALESCE(SUM(l.cost_usd), 0)::numeric AS cost_total_usd,
    COALESCE(SUM(l.total_tokens) FILTER (WHERE l.created_at >= (SELECT ts FROM mes_inicio)), 0)::bigint AS tokens_mes_atual,
    COALESCE(SUM(l.total_tokens), 0)::bigint AS tokens_total,
    COUNT(*) FILTER (WHERE l.created_at >= (SELECT ts FROM mes_inicio))::bigint AS chamadas_mes_atual,
    COUNT(*)::bigint AS chamadas_total,
    MAX(l.created_at) AS ultima_chamada_at
  FROM ai_usage_logs l
  GROUP BY l.clinic_id;
$$;

GRANT EXECUTE ON FUNCTION public.admin_ai_usage_per_clinic() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_ai_usage_breakdown(
  p_clinic_id uuid,
  p_periodo text DEFAULT 'mes'
)
RETURNS TABLE (
  agent text,
  model text,
  chamadas bigint,
  prompt_tokens bigint,
  completion_tokens bigint,
  tokens bigint,
  cost_usd numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mes_inicio AS (
    SELECT date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))
           AT TIME ZONE 'America/Sao_Paulo' AS ts
  )
  SELECT
    l.agent,
    MODE() WITHIN GROUP (ORDER BY l.model) AS model,
    COUNT(*)::bigint AS chamadas,
    COALESCE(SUM(l.prompt_tokens), 0)::bigint AS prompt_tokens,
    COALESCE(SUM(l.completion_tokens), 0)::bigint AS completion_tokens,
    COALESCE(SUM(l.total_tokens), 0)::bigint AS tokens,
    COALESCE(SUM(l.cost_usd), 0)::numeric AS cost_usd
  FROM ai_usage_logs l
  WHERE l.clinic_id = p_clinic_id
    AND (
      p_periodo <> 'mes'
      OR l.created_at >= (SELECT ts FROM mes_inicio)
    )
  GROUP BY l.agent
  ORDER BY cost_usd DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_ai_usage_breakdown(uuid, text) TO service_role;
