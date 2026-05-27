-- Fix: n8n_cs_profissionais_para_agente retornava cs_servicos.id em procedimento_ids
-- (migration 20260526250000), mas n8n_clinic_procedimentos retorna clinic_procedures.id
-- e n8n_cs_consultar_vagas usa clinic_procedures.id internamente.
-- O ID mismatch fazia o MAPA do Enrich Agendador ficar vazio → bot mostrava só 1
-- profissional (Dr. Herick) mesmo havendo 3 vinculados ao procedimento.
-- Fix: usar pp.clinic_procedure_id diretamente (consistente com o resto do sistema).

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
                -- clinic_procedures.id — bate com o campo "id" de n8n_clinic_procedimentos
                SELECT jsonb_agg(pp.clinic_procedure_id ORDER BY pp.clinic_procedure_id)
                FROM public.professional_procedures pp
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
  'procedimento_ids = clinic_procedures.id (consistente com n8n_clinic_procedimentos e n8n_cs_consultar_vagas). Profissional sem vínculos → NULL (não aparece para procedimento específico).';
