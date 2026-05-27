-- Limpeza periódica de chat memory antiga.
-- Chamada por workflow n8n diariamente. Retenção padrão: 90 dias.
-- Apaga sessões cuja ÚLTIMA mensagem é mais antiga que p_days dias.
-- Sessões activas (com qualquer msg recente) são preservadas inteiramente.
-- NÃO afecta cs_clientes / cs_agendamentos / cs_clinic_directory — apenas a memória conversacional do LLM.

CREATE OR REPLACE FUNCTION public.n8n_cleanup_chat_histories(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
  v_cutoff timestamptz;
BEGIN
  v_cutoff := now() - (p_days || ' days')::interval;

  DELETE FROM n8n_chat_histories
  WHERE session_id IN (
    SELECT session_id
    FROM n8n_chat_histories
    GROUP BY session_id
    HAVING max(created_at) < v_cutoff
  );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', v_deleted,
    'days_retention', p_days,
    'cutoff', v_cutoff,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_cleanup_chat_histories(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.n8n_cleanup_chat_histories(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.n8n_cleanup_chat_histories(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_cleanup_chat_histories(integer) TO service_role;

COMMENT ON FUNCTION public.n8n_cleanup_chat_histories(integer) IS
  'Apaga sessões de n8n_chat_histories cuja última msg seja anterior a p_days dias. Preserva sessões activas. Não afecta cs_clientes / cs_agendamentos.';
