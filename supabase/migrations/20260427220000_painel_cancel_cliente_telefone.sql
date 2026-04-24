-- painel_cancel_cs_agendamento: telefone do cliente para o texto WhatsApp ao profissional.

CREATE OR REPLACE FUNCTION public.painel_cancel_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_slot uuid;
  v_whatsapp text;
  v_prof_nome text;
  v_prof_genero text;
  v_cliente_tel text;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT
    a.id,
    a.cliente_id,
    a.profissional_id,
    a.data_agendamento,
    a.horario,
    a.status,
    coalesce(nullif(trim(a.nome_cliente), ''), '') AS nome_cliente,
    coalesce(nullif(trim(a.nome_procedimento), ''), '') AS nome_procedimento
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

  IF v.status = 'cancelado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_cancelled');
  END IF;

  SELECT h.id INTO v_slot
  FROM public.cs_horarios_disponiveis h
  WHERE
    h.profissional_id = v.profissional_id
    AND h.data = v.data_agendamento
    AND h.horario = v.horario
  FOR UPDATE OF h;

  IF FOUND THEN
    UPDATE public.cs_horarios_disponiveis
    SET disponivel = true
    WHERE id = v_slot;
  END IF;

  UPDATE public.cs_agendamentos
  SET
    status = 'cancelado',
    motivo_cancelamento = coalesce(motivo_cancelamento, 'Cancelado pelo painel'),
    atualizado_em = now()
  WHERE id = v.id;

  SELECT prof.name, prof.whatsapp, prof.gender
  INTO v_prof_nome, v_whatsapp, v_prof_genero
  FROM public.professionals prof
  WHERE
    prof.cs_profissional_id = v.profissional_id
    AND prof.clinic_id = p_clinic_id;

  IF coalesce(trim(v_prof_nome), '') = '' THEN
    SELECT p.nome, p.gender INTO v_prof_nome, v_prof_genero
    FROM public.cs_profissionais p
    WHERE p.id = v.profissional_id;
  END IF;

  SELECT nullif(trim(c.telefone), '') INTO v_cliente_tel
  FROM public.cs_clientes c
  WHERE c.id = v.cliente_id
    AND c.clinic_id = p_clinic_id;

  RETURN jsonb_build_object(
    'ok', true,
    'profissional_whatsapp', v_whatsapp,
    'profissional_nome', nullif(trim(v_prof_nome), ''),
    'profissional_genero', CASE
      WHEN v_prof_genero IN ('M', 'F') THEN v_prof_genero
      ELSE NULL
    END,
    'nome_cliente', nullif(trim(v.nome_cliente), ''),
    'cliente_telefone', v_cliente_tel,
    'nome_procedimento', nullif(trim(v.nome_procedimento), ''),
    'data_agendamento', v.data_agendamento,
    'horario', to_char(v.horario, 'HH24:MI')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) TO service_role;
