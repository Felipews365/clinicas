-- Coluna duração + RPC read-model profissionais aptos ao procedimento (UUID ou nome)

ALTER TABLE public.cs_agendamentos
  ADD COLUMN IF NOT EXISTS duracao_minutos integer NOT NULL DEFAULT 60;

ALTER TABLE public.cs_agendamentos
  DROP CONSTRAINT IF EXISTS cs_agendamentos_duracao_minutos_positive;

ALTER TABLE public.cs_agendamentos
  ADD CONSTRAINT cs_agendamentos_duracao_minutos_positive
  CHECK (duracao_minutos > 0 AND duracao_minutos <= 24 * 60);

COMMENT ON COLUMN public.cs_agendamentos.duracao_minutos IS
  'Duração do atendimento em minutos (painel/agente). Usada em overlap de vagas e liberação de slots.';

CREATE OR REPLACE FUNCTION public.n8n_cs_profissionais_aptos_procedimento (
  p_clinic_id uuid,
  p_clinic_procedure_id uuid DEFAULT NULL::uuid,
  p_procedimento_nome text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_proc uuid;
  v_nom text;
  v_label text;
  v_dur int;
  v_profs jsonb;
BEGIN
  IF p_clinic_id IS NULL THEN
    RETURN jsonb_build_object(
      'procedimento_id', null,
      'procedimento_nome', null,
      'duracao_minutos', null,
      'profissionais', '[]'::jsonb
    );
  END IF;

  v_proc := p_clinic_procedure_id;
  IF v_proc IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.clinic_procedures c
    WHERE c.id = v_proc
      AND c.clinic_id = p_clinic_id
  ) THEN
    v_proc := NULL;
  END IF;

  v_nom := nullif(trim(p_procedimento_nome), '');

  IF v_proc IS NULL AND v_nom IS NOT NULL THEN
    SELECT cp.id INTO v_proc
    FROM public.clinic_procedures cp
    WHERE cp.clinic_id = p_clinic_id
      AND cp.is_active = true
      AND (
        lower(trim(cp.name)) = lower(v_nom)
        OR lower(cp.name) LIKE '%' || lower(v_nom) || '%'
      )
    ORDER BY
      CASE WHEN lower(trim(cp.name)) = lower(v_nom) THEN 0 ELSE 1 END,
      length(trim(cp.name))
    LIMIT 1;
  END IF;

  IF v_proc IS NULL THEN
    RETURN jsonb_build_object(
      'procedimento_id', null,
      'procedimento_nome', null,
      'duracao_minutos', null,
      'profissionais', '[]'::jsonb
    );
  END IF;

  SELECT cp.name, cp.duration_minutes
  INTO v_label, v_dur
  FROM public.clinic_procedures cp
  WHERE cp.id = v_proc
    AND cp.clinic_id = p_clinic_id;

  IF v_label IS NULL THEN
    RETURN jsonb_build_object(
      'procedimento_id', null,
      'procedimento_nome', null,
      'duracao_minutos', null,
      'profissionais', '[]'::jsonb
    );
  END IF;

  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'nome', p.nome,
          'especialidade', p.especialidade,
          'procedimento_ids', (
            SELECT CASE
              WHEN EXISTS (
                SELECT 1
                FROM public.professional_procedures pp0
                WHERE pp0.professional_id = pr.id
              ) THEN (
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
        AND COALESCE(pr.is_active, true) = true
      WHERE p.clinic_id = p_clinic_id
        AND p.ativo = true
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.professional_procedures pp0
            WHERE pp0.professional_id = pr.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.professional_procedures pp1
            WHERE pp1.professional_id = pr.id
              AND pp1.clinic_procedure_id = v_proc
          )
        )
    ),
    '[]'::jsonb
  )
  INTO v_profs;

  RETURN jsonb_build_object(
    'procedimento_id', v_proc,
    'procedimento_nome', v_label,
    'duracao_minutos', v_dur,
    'profissionais', coalesce(v_profs, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.n8n_cs_profissionais_aptos_procedimento (uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissionais_aptos_procedimento (uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissionais_aptos_procedimento (uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissionais_aptos_procedimento (uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.n8n_cs_profissionais_aptos_procedimento (uuid, uuid, text) IS
  'Read-model: profissionais da clínica aptos ao procedimento (UUID ou nome). Inclui duracao_minutos do cadastro.';
