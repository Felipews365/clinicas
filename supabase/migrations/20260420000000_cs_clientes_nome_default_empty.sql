-- Permite criar cliente novo sem nome (será preenchido pelo agente ao perguntar)
-- O agente detecta nome vazio = cliente novo = pede o nome
-- O agente detecta nome preenchido = cliente de retorno = saúda pelo nome
ALTER TABLE public.cs_clientes ALTER COLUMN nome SET DEFAULT '';

COMMENT ON COLUMN public.cs_clientes.nome IS
  'Texto do nome no cadastro. Só deve ser usado pelo agente quando nome_confirmado = true (cliente digitou na conversa ou agendamento com nome explícito). Não usar o pushName do WhatsApp.';
