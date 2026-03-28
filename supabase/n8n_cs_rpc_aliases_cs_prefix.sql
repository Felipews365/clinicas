-- Aliases curtos para PostgREST: /rpc/cs_agendar e /rpc/cs_reagendar
-- Use se o workflow n8n ainda apontar para cs_* em vez de n8n_cs_*.

create or replace function public.cs_agendar (
  p_nome_cliente text,
  p_telefone text,
  p_profissional_id uuid,
  p_servico_id uuid,
  p_data date,
  p_horario time,
  p_observacoes text default ''
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.n8n_cs_agendar(
    p_nome_cliente,
    p_telefone,
    p_profissional_id,
    p_servico_id,
    p_data,
    p_horario,
    p_observacoes
  );
$$;

create or replace function public.cs_reagendar (
  p_agendamento_id uuid,
  p_nova_data date,
  p_novo_horario time,
  p_novo_profissional_id uuid,
  p_profissional_antigo_id uuid,
  p_data_antiga date,
  p_horario_antigo time
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.n8n_cs_reagendar(
    p_agendamento_id,
    p_nova_data,
    p_novo_horario,
    p_novo_profissional_id,
    p_profissional_antigo_id,
    p_data_antiga,
    p_horario_antigo
  );
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname IN ('public')
      and p.proname IN ('cs_agendar', 'cs_reagendar')
  loop
    execute format('revoke all on function %s from public', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
    execute format('grant execute on function %s to authenticated', r.fn);
    execute format('grant execute on function %s to anon', r.fn);
  end loop;
end $$;
