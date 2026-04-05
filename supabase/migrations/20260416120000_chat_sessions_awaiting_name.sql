-- Adiciona estado "aguardando nome do cliente" na sessão do agente
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS awaiting_name boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.chat_sessions.awaiting_name IS
  'true enquanto o agente aguarda o cliente digitar o próprio nome';
