-- Profissionais que o agente e o prefetch devem ver = mesmos que o painel (tabela professionals).
-- Evita UUID «órfão» em cs_profissionais que não tem cs_profissional_id no painel — o LLM
-- escolhia esse id e achava horários «inexistentes» nas vagas.

CREATE OR REPLACE FUNCTION public.n8n_cs_profissionais_para_agente (p_clinic_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'nome', p.nome,
          'especialidade', p.especialidade
        )
        ORDER BY p.nome
      )
      FROM public.cs_profissionais p
      INNER JOIN public.professionals pr
        ON pr.cs_profissional_id = p.id
        AND pr.clinic_id = p_clinic_id
      WHERE p.clinic_id = p_clinic_id
        AND p.ativo = true
        AND COALESCE (pr.is_active, true) = true
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.n8n_cs_profissionais_para_agente (uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissionais_para_agente (uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissionais_para_agente (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissionais_para_agente (uuid) TO service_role;

COMMENT ON FUNCTION public.n8n_cs_profissionais_para_agente (uuid) IS
  'Lista profissionais ativos com painel (join professionals). Usar no WhatsApp/prefetch em vez de GET cs_profissionais.';
