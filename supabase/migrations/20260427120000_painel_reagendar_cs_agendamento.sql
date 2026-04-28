-- Painel: reagendar marcação em cs_agendamentos (delega em n8n_cs_reagendar — vagas + slots).
-- Ordem dos parâmetros: p_novo_cs_profissional_id ANTES de p_novo_horario (alfabética PostgREST:
-- p_novo_c… < p_novo_h…), senão o Supabase resolve (uuid, uuid, date, uuid, time) e não encontra a função.

CREATE OR REPLACE FUNCTION public.painel_reagendar_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid,
  p_nova_data date,
  p_novo_cs_profissional_id uuid,
  p_novo_horario time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_novo_prof uuid;
  v_res jsonb;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT
    a.id,
    a.profissional_id,
    a.data_agendamento,
    a.horario,
    a.status
  INTO v
  FROM public.cs_agendamentos a
  INNER JOIN public.cs_profissionais p ON p.id = a.profissional_id
  WHERE
    a.id = p_cs_agendamento_id
    AND p.clinic_id = p_clinic_id
    AND coalesce(a.clinic_id, p.clinic_id) = p_clinic_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v.status IN ('cancelado', 'concluido') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  v_novo_prof := coalesce(p_novo_cs_profissional_id, v.profissional_id);

  IF v_novo_prof IS DISTINCT FROM v.profissional_id THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.cs_profissionais csp
      WHERE csp.id = v_novo_prof
        AND csp.clinic_id = p_clinic_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'profissional_invalido');
    END IF;
  END IF;

  v_res := public.n8n_cs_reagendar(
    p_cs_agendamento_id,
    p_nova_data,
    p_novo_horario,
    v_novo_prof,
    v.profissional_id,
    v.data_agendamento,
    v.horario
  );

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.painel_reagendar_cs_agendamento (uuid, uuid, date, uuid, time) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_reagendar_cs_agendamento (uuid, uuid, date, uuid, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_reagendar_cs_agendamento (uuid, uuid, date, uuid, time) TO service_role;
