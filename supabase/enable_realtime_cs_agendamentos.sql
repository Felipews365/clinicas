-- Habilita Supabase Realtime em public.cs_agendamentos (fluxo n8n / WhatsApp).
-- Alternativa: migrar com supabase/migrations/20260401120000_realtime_cs_agendamentos.sql

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

alter table public.cs_agendamentos replica identity full;
