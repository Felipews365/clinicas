-- Resolve profissional_whatsapp após agendar/reagendar/cancelar sem ler saída das tools LangChain
-- (toolHttpRequest só expõe ai_tool; $('node').all() no Code exige branch main — fica vazio).

CREATE OR REPLACE FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(
  p_clinic_id uuid,
  p_telefone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits      text;
  v_cliente_id  uuid;
  v_ag_id       uuid;
  v_prof_id     uuid;
  v_atual       timestamptz;
  v_status      text;
  v_whatsapp    text;
BEGIN
  IF p_clinic_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clinic_id_obrigatorio');
  END IF;

  v_digits := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  IF v_digits = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'telefone_invalido');
  END IF;

  SELECT c.id
  INTO v_cliente_id
  FROM public.cs_clientes c
  WHERE c.clinic_id = p_clinic_id
    AND (
      regexp_replace(c.telefone, '\D', '', 'g') = v_digits
      OR regexp_replace(c.telefone, '\D', '', 'g') = right(v_digits, 11)
      OR regexp_replace(c.telefone, '\D', '', 'g') = ('55' || right(v_digits, 11))
      OR regexp_replace(c.telefone, '\D', '', 'g') = right(('55' || v_digits), 13)
    )
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_cliente_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cliente_nao_encontrado');
  END IF;

  SELECT a.id, a.profissional_id, a.atualizado_em, a.status
  INTO v_ag_id, v_prof_id, v_atual, v_status
  FROM public.cs_agendamentos a
  WHERE a.clinic_id = p_clinic_id
    AND a.cliente_id = v_cliente_id
    AND a.atualizado_em >= (now() - interval '25 minutes')
  ORDER BY a.atualizado_em DESC
  LIMIT 1;

  IF v_ag_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem_mudanca_recente');
  END IF;

  SELECT prof.whatsapp
  INTO v_whatsapp
  FROM public.cs_profissionais csp
  LEFT JOIN public.professionals prof
    ON prof.cs_profissional_id = csp.id
    AND prof.clinic_id = csp.clinic_id
  WHERE csp.id = v_prof_id;

  RETURN jsonb_build_object(
    'ok', true,
    'agendamento_id', v_ag_id,
    'profissional_whatsapp', v_whatsapp,
    'status_agendamento', v_status,
    'atualizado_em', v_atual
  );
END;
$$;

COMMENT ON FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(uuid, text) IS
  'Usado pelo n8n (Code após agente_agendador): devolve WhatsApp do profissional do agendamento alterado nos últimos 25 min, sem acessar saída ai_tool das tools.';

REVOKE ALL ON FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cs_profissional_whatsapp_mudanca_recente(uuid, text) TO service_role;
