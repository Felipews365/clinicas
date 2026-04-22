-- Adiciona coluna created_at à tabela n8n_chat_histories
-- Necessário para exibir horários ao vivo no inbox WhatsApp (estilo WhatsApp)
ALTER TABLE public.n8n_chat_histories
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
