-- Invalida mensagens AI no n8n_chat_histories que mencionem um profissional
-- quando ele é desactivado, removido, renomeado, ou tem vínculos de procedimento alterados.
--
-- Razão: o LLM do agendador às vezes ignora o `## PROFISSIONAIS APTOS — DADOS AO VIVO`
-- injectado pelo Enrich Agendador e reusa listas de profissionais da memória de chat,
-- mesmo quando o profissional já foi apagado/desactivado/renomeado no painel.
--
-- Mecanismo: ao detectar mudança relevante, apagar apenas mensagens AI da clínica
-- que contenham o nome antigo do profissional. Mensagens humanas e outras mensagens
-- AI ficam intactas — preserva o contexto do cliente.

CREATE OR REPLACE FUNCTION public._invalidate_chat_for_professional(
  p_clinic_id uuid,
  p_professional_name text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
  v_name_norm text;
BEGIN
  v_name_norm := btrim(coalesce(p_professional_name, ''));
  IF p_clinic_id IS NULL OR length(v_name_norm) < 2 THEN
    RETURN 0;
  END IF;

  DELETE FROM n8n_chat_histories
  WHERE session_id LIKE p_clinic_id::text || ':%'
    AND message->>'type' = 'ai'
    AND message::text ILIKE '%' || v_name_norm || '%';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Trigger 1: professionals (delete, soft-delete via is_active, rename)
CREATE OR REPLACE FUNCTION public._trg_professionals_invalidate_chat()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._invalidate_chat_for_professional(OLD.clinic_id, OLD.name);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- nome mudou: invalida pelo nome antigo (e pelo novo, caso já exista alguma menção)
    IF COALESCE(OLD.name, '') IS DISTINCT FROM COALESCE(NEW.name, '') THEN
      PERFORM public._invalidate_chat_for_professional(OLD.clinic_id, OLD.name);
    END IF;
    -- ficou inactivo: invalida menções para parar de ofertar
    IF COALESCE(OLD.is_active, true) = true AND COALESCE(NEW.is_active, true) = false THEN
      PERFORM public._invalidate_chat_for_professional(NEW.clinic_id, NEW.name);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    -- profissional novo: nenhuma memória dele a invalidar, mas a memória antiga pode listar
    -- "profissionais disponíveis" sem ele — não dá para detectar pelo nome.
    -- Estratégia: invalidar mensagens AI que tenham padrões de lista de profissionais para a clínica.
    DELETE FROM n8n_chat_histories
    WHERE session_id LIKE NEW.clinic_id::text || ':%'
      AND message->>'type' = 'ai'
      AND message::text ~* 'profissionais (disponíveis|aptos|que realizam)';
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_professionals_invalidate_chat ON public.professionals;
CREATE TRIGGER trg_professionals_invalidate_chat
AFTER INSERT OR UPDATE OR DELETE ON public.professionals
FOR EACH ROW EXECUTE FUNCTION public._trg_professionals_invalidate_chat();

-- Trigger 2: professional_procedures (vinculação/desvinculação a serviço)
-- Quando um profissional ganha ou perde um procedimento, o conjunto de "profissionais
-- aptos" para esse serviço muda — invalidar listas em memória da clínica.
CREATE OR REPLACE FUNCTION public._trg_professional_procedures_invalidate_chat()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_clinic_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT clinic_id INTO v_clinic_id FROM public.professionals WHERE id = OLD.professional_id;
  ELSE
    SELECT clinic_id INTO v_clinic_id FROM public.professionals WHERE id = NEW.professional_id;
  END IF;

  IF v_clinic_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Apaga mensagens AI da clínica que pareçam listas de profissionais aptos.
  DELETE FROM n8n_chat_histories
  WHERE session_id LIKE v_clinic_id::text || ':%'
    AND message->>'type' = 'ai'
    AND message::text ~* 'profissionais (disponíveis|aptos|que realizam)';

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_professional_procedures_invalidate_chat ON public.professional_procedures;
CREATE TRIGGER trg_professional_procedures_invalidate_chat
AFTER INSERT OR UPDATE OR DELETE ON public.professional_procedures
FOR EACH ROW EXECUTE FUNCTION public._trg_professional_procedures_invalidate_chat();
