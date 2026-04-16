-- RPC para o agente n8n salvar o nome do cliente ao receber durante o atendimento
-- Chamada pela tool cs_salvar_nome no workflow do AI Agent

CREATE OR REPLACE FUNCTION public.n8n_cs_salvar_nome(
  p_clinic_id  uuid,
  p_telefone   text,
  p_nome       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_telefone text;
  v_rows     int;
BEGIN
  -- Normaliza telefone: mantém só dígitos
  v_telefone := regexp_replace(trim(p_telefone), '\D', '', 'g');

  UPDATE public.cs_clientes
    SET nome       = trim(p_nome),
        updated_at = now()
  WHERE clinic_id = p_clinic_id
    AND telefone   = v_telefone;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Se não achou por telefone normalizado, tenta prefixo 55 removido
  IF v_rows = 0 AND length(v_telefone) > 11 THEN
    UPDATE public.cs_clientes
      SET nome       = trim(p_nome),
          updated_at = now()
    WHERE clinic_id = p_clinic_id
      AND regexp_replace(telefone, '\D', '', 'g') = substring(v_telefone FROM 3);

    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',    v_rows > 0,
    'nome',  trim(p_nome),
    'rows',  v_rows
  );
END;
$$;

COMMENT ON FUNCTION public.n8n_cs_salvar_nome IS
  'Usada pelo agente n8n para persistir o nome do cliente em cs_clientes. '
  'Chamada uma única vez quando o cliente informa o nome durante o primeiro atendimento.';

-- agent_instructions JSON aceita campos opcionais de saudação:
--   saudacao_novo    : template para cliente novo (suporta {{name}} e {{clinica}})
--   saudacao_retorno : template para cliente conhecido (suporta {{nome_cliente}})
-- Ex: { "nome_agente": "Sofia", "saudacao_novo": "Olá! Sou {{name}}, da {{clinica}}. Como posso te ajudar? 😊" }
COMMENT ON COLUMN public.clinics.agent_instructions IS
  'JSON com configuração do agente. Chaves: nome_agente, identidade, triagem, tom, '
  'orientacoes, transferir, outros, saudacao_novo, saudacao_retorno.';
