-- PostgREST usa o role "authenticated" com o JWT do utilizador.
-- RLS (cs_clientes_access, etc.) restringe linhas, mas é preciso GRANT na tabela;
-- sem isto: "permission denied for table cs_clientes" em ambientes legados ou após REVOKE.

grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.cs_clientes to authenticated;
grant select, insert, update, delete on table public.cs_agendamentos to authenticated;
