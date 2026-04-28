-- Painel: limpar memória LangChain (n8n_chat_histories) e opcionalmente o nome em cs_clientes
-- para testes / simular cliente novo no agente WhatsApp.

CREATE OR REPLACE FUNCTION public.painel_limpar_sessao_agente (
  p_clinic_id uuid,
  p_session_id text,
  p_limpar_nome boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int := 0;
  v_updated int := 0;
  v_remote_jid text;
  v_telefone text;
  v_colon int;
  v_prefix text;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_session_id IS NULL OR length(trim(p_session_id)) < 40 THEN
    RAISE EXCEPTION 'invalid session_id' USING errcode = 'P0001', message = 'session_id inválido';
  END IF;

  v_colon := position(':' IN p_session_id);
  IF v_colon < 2 THEN
    RAISE EXCEPTION 'invalid session_id' USING errcode = 'P0001', message = 'session_id inválido';
  END IF;

  v_prefix := substring(p_session_id FROM 1 FOR v_colon - 1);
  IF v_prefix::uuid IS DISTINCT FROM p_clinic_id THEN
    RAISE EXCEPTION 'session_clinic_mismatch' USING errcode = 'P0001', message = 'Sessão não pertence a esta clínica';
  END IF;

  v_remote_jid := substring(p_session_id FROM v_colon + 1);
  IF v_remote_jid IS NULL OR v_remote_jid = '' THEN
    RAISE EXCEPTION 'invalid session_id' USING errcode = 'P0001', message = 'remoteJid em falta';
  END IF;

  DELETE FROM public.n8n_chat_histories
  WHERE session_id = p_session_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  v_telefone := regexp_replace(trim(v_remote_jid), '\D', '', 'g');

  IF p_limpar_nome AND length(v_telefone) > 0 THEN
    UPDATE public.cs_clientes c
    SET
      nome = '',
      updated_at = now()
    WHERE c.clinic_id = p_clinic_id
      AND (
        c.telefone = v_telefone
        OR (
          length(v_telefone) > 11
          AND regexp_replace(c.telefone, '\D', '', 'g') = substring(v_telefone FROM 3)
        )
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'historico_removido', v_deleted,
    'cadastro_nome_limpo', v_updated
  );
END;
$$;

COMMENT ON FUNCTION public.painel_limpar_sessao_agente (uuid, text, boolean) IS
  'Painel: apaga mensagens do agente (n8n_chat_histories) para session_id = clinic_id:remoteJid; opcionalmente zera cs_clientes.nome (mesma regra de telefone que n8n_cs_salvar_nome).';

REVOKE ALL ON FUNCTION public.painel_limpar_sessao_agente (uuid, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_limpar_sessao_agente (uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_limpar_sessao_agente (uuid, text, boolean) TO service_role;
