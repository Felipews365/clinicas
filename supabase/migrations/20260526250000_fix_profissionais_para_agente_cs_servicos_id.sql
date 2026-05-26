-- Fix: n8n_cs_profissionais_para_agente devolvia clinic_procedures.id em procedimento_ids,
-- mas o Enrich Agendador filtra por cs_servicos.id. Faz JOIN para traduzir os IDs.

CREATE OR REPLACE FUNCTION public.n8n_cs_profissionais_para_agente(p_clinic_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',             p.id,
          'nome',           p.nome,
          'especialidade',  p.especialidade,
          'procedimento_ids', (
            SELECT CASE
              WHEN EXISTS (
                SELECT 1 FROM public.professional_procedures pp0
                WHERE pp0.professional_id = pr.id
              ) THEN (
                -- Traduz clinic_procedure_id → cs_servicos.id pelo nome
                SELECT jsonb_agg(COALESCE(cs.id, pp.clinic_procedure_id) ORDER BY COALESCE(cs.id, pp.clinic_procedure_id))
                FROM public.professional_procedures pp
                JOIN public.clinic_procedures cp ON cp.id = pp.clinic_procedure_id
                LEFT JOIN public.cs_servicos cs
                  ON cs.clinic_id = p_clinic_id
                  AND lower(trim(cs.nome)) = lower(trim(cp.name))
                WHERE pp.professional_id = pr.id
              )
              ELSE NULL::jsonb
            END
          )
        )
        ORDER BY p.nome
      )
      FROM public.cs_profissionais p
      INNER JOIN public.professionals pr
        ON pr.cs_profissional_id = p.id
        AND pr.clinic_id = p_clinic_id
      WHERE p.clinic_id = p_clinic_id
        AND p.ativo = true
        AND COALESCE(pr.is_active, true) = true
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.n8n_cs_profissionais_para_agente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissionais_para_agente(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissionais_para_agente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissionais_para_agente(uuid) TO service_role;

COMMENT ON FUNCTION public.n8n_cs_profissionais_para_agente(uuid) IS
  'procedimento_ids = cs_servicos.id (o que o Enrich Agendador usa para filtrar). Fallback para clinic_procedures.id se cs_servicos não tiver entrada correspondente.';
