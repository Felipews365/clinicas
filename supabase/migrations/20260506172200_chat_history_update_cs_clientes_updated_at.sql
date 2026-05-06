-- Trigger: atualiza cs_clientes.updated_at a cada nova mensagem em n8n_chat_histories
-- Garante que a lista "Conversas" do painel ordena pelo último chat real

CREATE OR REPLACE FUNCTION _update_cs_clientes_last_chat()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_clinic_id uuid;
  v_jid       text;
  v_telefone  text;
BEGIN
  BEGIN
    v_clinic_id := split_part(NEW.session_id, ':', 1)::uuid;
  EXCEPTION WHEN others THEN
    RETURN NEW; -- session_id malformado, ignorar
  END;

  v_jid := split_part(NEW.session_id, ':', 2); -- "558196454656@s.whatsapp.net"

  -- ignorar grupos
  IF v_jid LIKE '%@g.us' THEN
    RETURN NEW;
  END IF;

  -- apenas dígitos do número
  v_telefone := regexp_replace(split_part(v_jid, '@', 1), '[^0-9]', '', 'g');

  IF v_telefone = '' THEN
    RETURN NEW;
  END IF;

  UPDATE cs_clientes
  SET updated_at = NEW.created_at
  WHERE clinic_id = v_clinic_id
    AND regexp_replace(telefone, '[^0-9]', '', 'g') = v_telefone
    AND (updated_at IS NULL OR NEW.created_at > updated_at);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_history_update_cs_clientes ON n8n_chat_histories;

CREATE TRIGGER trg_chat_history_update_cs_clientes
AFTER INSERT ON n8n_chat_histories
FOR EACH ROW EXECUTE FUNCTION _update_cs_clientes_last_chat();
