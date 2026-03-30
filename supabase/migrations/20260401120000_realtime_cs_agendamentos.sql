-- Realtime para agendamentos n8n/cs: notificações e lista atualizam sem esperar o polling.
-- Idempotente: ignora se a tabela já estiver na publicação.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cs_agendamentos'
  ) then
    alter publication supabase_realtime add table public.cs_agendamentos;
  end if;
end $$;

-- Melhora eventos UPDATE (valores anteriores); opcional mas útil.
alter table public.cs_agendamentos replica identity full;
