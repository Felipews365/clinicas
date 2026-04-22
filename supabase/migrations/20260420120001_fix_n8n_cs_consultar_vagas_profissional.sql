-- Corrige n8n_cs_consultar_vagas:
--   1. Remove os 3 overloads conflitantes (causavam PGRST203)
--   2. Cria versão única: p_data obrigatório + p_profissional_id opcional
--   3. Disponibilidade via JOIN com cs_agendamentos (mesma lógica do painel)
--   4. Sem LIMIT artificial (retorna todos os horários do dia)
--   5. Filtra por profissional quando p_profissional_id é fornecido

DROP FUNCTION IF EXISTS public.n8n_cs_consultar_vagas();
DROP FUNCTION IF EXISTS public.n8n_cs_consultar_vagas(p_clinic_id uuid);
DROP FUNCTION IF EXISTS public.n8n_cs_consultar_vagas(p_clinic_id uuid, p_data date);

CREATE OR REPLACE FUNCTION public.n8n_cs_consultar_vagas(
  p_clinic_id       uuid,
  p_data            date,
  p_profissional_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_clinic_id IS NULL OR p_data IS NULL THEN '[]'::jsonb
    ELSE COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'horario_id',    h.id,
            'data',          to_char(h.data, 'DD/MM/YYYY'),
            'dia_semana',    trim(to_char(h.data, 'Day')),
            'horario',       to_char(h.horario, 'HH24:MI'),
            'profissional_id', p.id,
            'profissional',  p.nome,
            'especialidade', p.especialidade
          )
          ORDER BY h.horario
        )
        FROM public.cs_horarios_disponiveis h
        INNER JOIN public.cs_profissionais p ON p.id = h.profissional_id
        INNER JOIN public.clinics cl ON cl.id = p_clinic_id
        WHERE p.clinic_id = p_clinic_id
          AND h.data = p_data
          AND p.ativo = true
          -- Bloqueio manual explícito (médico bloqueou no painel)
          AND COALESCE(h.bloqueio_manual, false) = false
          -- Disponibilidade calculada via JOIN (igual ao painel — ignora h.disponivel flag)
          AND NOT EXISTS (
            SELECT 1
            FROM public.cs_agendamentos a
            WHERE a.profissional_id = h.profissional_id
              AND a.data_agendamento = h.data
              AND a.horario = h.horario
              AND a.status NOT IN ('cancelado', 'concluido')
          )
          -- Filtra por profissional quando informado
          AND (p_profissional_id IS NULL OR p.id = p_profissional_id)
          -- Respeita agenda_visible_hours da clínica
          AND EXTRACT(hour FROM h.horario)::integer = ANY(
            COALESCE(
              cl.agenda_visible_hours,
              ARRAY[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[]
            )
          )
      ),
      '[]'::jsonb
    )
  END;
$$;

COMMENT ON FUNCTION public.n8n_cs_consultar_vagas(uuid, date, uuid) IS
  'Retorna horários disponíveis para uma clínica num dia específico. '
  'p_profissional_id opcional: quando fornecido, filtra apenas pelo profissional. '
  'Disponibilidade calculada via JOIN com cs_agendamentos (sem depender do flag h.disponivel).';
