-- Publica whatsapp_sessions e cs_clientes na publicação supabase_realtime.
-- O painel Clientes (web/src/components/painel-clientes-cs.tsx) subscreve postgres_changes
-- nestas tabelas para atualizar em tempo real o toggle do bot e o countdown de reativação.
-- Sem esta publicação, o canal subscreve mas nunca recebe eventos — o utilizador só vê a
-- pausa iniciada via WhatsApp depois de clicar «Atualizar».

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_sessions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_sessions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cs_clientes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cs_clientes';
  END IF;
END
$$;
