-- Habilita Supabase Realtime na tabela appointments
-- Necessário para notificações em tempo real no painel quando clientes agendam/cancelam/reagendam

-- Adiciona a tabela à publicação do Supabase Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE appointments;

-- Opcional: REPLICA IDENTITY FULL permite receber os valores anteriores (old)
-- nos eventos UPDATE via Realtime. Sem isso, apenas o id chega no "old".
-- O painel já usa prevRowsRef como alternativa, mas este comando melhora a precisão.
ALTER TABLE appointments REPLICA IDENTITY FULL;
