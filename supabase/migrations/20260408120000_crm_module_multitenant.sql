-- CRM básico: colunas cs_clientes, view, sincronização com agendamentos, acesso por plano
-- Plano CRM: teste com data_expiracao >= hoje e ativo; enterprise ativo e não inadimplente.

-- ---------------------------------------------------------------------------
-- 1. Enum status de relacionamento
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_relacionamento') then
    create type public.status_relacionamento as enum ('ativo', 'inativo', 'sumido');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2. clinics: plano enterprise + mensagem de reengajamento
-- ---------------------------------------------------------------------------
alter table public.clinics drop constraint if exists clinics_tipo_plano_check;

alter table public.clinics
  add constraint clinics_tipo_plano_check
  check (tipo_plano in ('teste', 'mensal', 'enterprise'));

alter table public.clinics
  add column if not exists crm_reengagement_message text;

comment on column public.clinics.crm_reengagement_message is
  'Texto opcional da clínica para mensagem WhatsApp de reengajamento (n8n).';

-- ---------------------------------------------------------------------------
-- 3. cs_clientes: campos CRM
-- ---------------------------------------------------------------------------
alter table public.cs_clientes
  add column if not exists ultima_consulta date;

alter table public.cs_clientes
  add column if not exists total_consultas integer not null default 0;

alter table public.cs_clientes
  add column if not exists tags text[] not null default '{}'::text[];

alter table public.cs_clientes
  add column if not exists notas text;

alter table public.cs_clientes
  add column if not exists status_relacionamento public.status_relacionamento not null default 'ativo';

alter table public.cs_clientes
  add column if not exists data_ultimo_contato timestamptz;

comment on column public.cs_clientes.ultima_consulta is
  'Última data de consulta contável (denormalizado pelo trigger em cs_agendamentos).';
comment on column public.cs_clientes.total_consultas is
  'Total de agendamentos contáveis (exclui cancelado/concluído).';

-- ---------------------------------------------------------------------------
-- 4. Acesso CRM (espelha hasFullAccess no app)
-- ---------------------------------------------------------------------------
create or replace function public.crm_clinic_has_access(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinics cl
    where cl.id = p_clinic_id
      and cl.ativo is true
      and (
        (
          cl.tipo_plano = 'teste'
          and cl.data_expiracao is not null
          and cl.data_expiracao >= current_date
        )
        or (
          cl.tipo_plano = 'enterprise'
          and coalesce(cl.inadimplente, false) is false
        )
      )
  );
$$;

comment on function public.crm_clinic_has_access(uuid) is
  'CRM liberado: teste activo (data_expiracao >= hoje) ou enterprise sem inadimplência; clínica ativa.';

revoke all on function public.crm_clinic_has_access(uuid) from public;
grant execute on function public.crm_clinic_has_access(uuid) to authenticated;
grant execute on function public.crm_clinic_has_access(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Sincronizar ultima_consulta / total_consultas a partir de cs_agendamentos
-- ---------------------------------------------------------------------------
create or replace function public.refresh_cs_cliente_stats(p_cliente_id uuid, p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_cliente_id is null or p_clinic_id is null then
    return;
  end if;

  update public.cs_clientes c
  set
    total_consultas = coalesce(sub.cnt, 0),
    ultima_consulta = sub.last_d
  from (
    select
      count(*)::integer as cnt,
      max(a.data_agendamento) as last_d
    from public.cs_agendamentos a
    where a.cliente_id = p_cliente_id
      and a.clinic_id = p_clinic_id
      and coalesce(a.status, '') not in ('cancelado', 'concluido')
  ) sub
  where c.id = p_cliente_id
    and c.clinic_id = p_clinic_id;
end;
$$;

revoke all on function public.refresh_cs_cliente_stats(uuid, uuid) from public;
grant execute on function public.refresh_cs_cliente_stats(uuid, uuid) to service_role;

create or replace function public.cs_agendamentos_after_write_sync_cliente_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'delete' then
    perform public.refresh_cs_cliente_stats(old.cliente_id, old.clinic_id);
    return old;
  elsif tg_op = 'update'
    and (
      old.cliente_id is distinct from new.cliente_id
      or old.clinic_id is distinct from new.clinic_id
    )
  then
    perform public.refresh_cs_cliente_stats(old.cliente_id, old.clinic_id);
    perform public.refresh_cs_cliente_stats(new.cliente_id, new.clinic_id);
    return new;
  else
    perform public.refresh_cs_cliente_stats(new.cliente_id, new.clinic_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_cs_agendamentos_sync_cliente_stats on public.cs_agendamentos;

create trigger trg_cs_agendamentos_sync_cliente_stats
  after insert or update or delete on public.cs_agendamentos
  for each row
  execute function public.cs_agendamentos_after_write_sync_cliente_stats();

-- Backfill
do $$
declare
  r record;
begin
  for r in
    select distinct cliente_id, clinic_id
    from public.cs_agendamentos
    where cliente_id is not null
      and clinic_id is not null
  loop
    perform public.refresh_cs_cliente_stats(r.cliente_id, r.clinic_id);
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- 6. View crm_visao_pacientes
-- ---------------------------------------------------------------------------
drop view if exists public.crm_visao_pacientes;

create view public.crm_visao_pacientes
with (security_invoker = true)
as
select
  c.id as cliente_id,
  c.clinic_id,
  c.nome,
  c.telefone,
  c.tags,
  c.notas,
  c.status_relacionamento,
  c.data_ultimo_contato,
  c.ultima_consulta as ultima_consulta_denorm,
  c.total_consultas as total_consultas_denorm,
  agg.ultima_consulta_calc,
  agg.total_consultas_calc
from public.cs_clientes c
left join lateral (
  select
    max(a.data_agendamento) as ultima_consulta_calc,
    count(*)::integer as total_consultas_calc
  from public.cs_agendamentos a
  where a.cliente_id = c.id
    and a.clinic_id = c.clinic_id
    and coalesce(a.status, '') not in ('cancelado', 'concluido')
) agg on true
where c.clinic_id is not null;

comment on view public.crm_visao_pacientes is
  'Visão CRM: cliente + agregados de consultas por clínica.';

grant select on public.crm_visao_pacientes to service_role;

-- ---------------------------------------------------------------------------
-- 7. Enforcement: alterar campos CRM só com plano adequado
-- ---------------------------------------------------------------------------
create or replace function public.cs_clientes_enforce_crm_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'update' then
    if (
      new.tags is distinct from old.tags
      or new.notas is distinct from old.notas
      or new.status_relacionamento is distinct from old.status_relacionamento
      or new.data_ultimo_contato is distinct from old.data_ultimo_contato
    )
      and new.clinic_id is not null
      and not public.crm_clinic_has_access(new.clinic_id)
    then
      raise exception 'crm_plan_required'
        using errcode = '42501',
        message = 'Plano não permite edição CRM nesta clínica.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cs_clientes_enforce_crm_plan on public.cs_clientes;

create trigger trg_cs_clientes_enforce_crm_plan
  before update on public.cs_clientes
  for each row
  execute function public.cs_clientes_enforce_crm_plan();

-- ---------------------------------------------------------------------------
-- 8. RPC: lista pacientes CRM (painel)
-- ---------------------------------------------------------------------------
create or replace function public.painel_crm_list_pacientes(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.rls_has_clinic_access(p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.crm_clinic_has_access(p_clinic_id) then
    raise exception 'plan_required'
      using errcode = 'P0001',
      message = 'CRM requer plano teste activo ou enterprise.';
  end if;

  return coalesce((
    select jsonb_agg(t.row order by t.ord)
    from (
      select
        jsonb_build_object(
          'id', v.cliente_id,
          'clinic_id', v.clinic_id,
          'nome', v.nome,
          'telefone', v.telefone,
          'tags', coalesce(to_jsonb(v.tags), '[]'::jsonb),
          'notas', v.notas,
          'status_relacionamento', v.status_relacionamento::text,
          'data_ultimo_contato', v.data_ultimo_contato,
          'ultima_consulta', coalesce(v.ultima_consulta_calc, v.ultima_consulta_denorm),
          'total_consultas', coalesce(v.total_consultas_calc, v.total_consultas_denorm, 0)
        ) as row,
        lower(coalesce(v.nome, '')) as ord
      from public.crm_visao_pacientes v
      where v.clinic_id = p_clinic_id
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.painel_crm_list_pacientes(uuid) from public;
grant execute on function public.painel_crm_list_pacientes(uuid) to authenticated;
grant execute on function public.painel_crm_list_pacientes(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. RPC n8n: marcar "sumido" (90 dias sem consulta) + lista para reengajamento
-- ---------------------------------------------------------------------------
create or replace function public.n8n_crm_mark_sumido_and_candidates()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  update public.cs_clientes p
  set status_relacionamento = 'sumido'
  from public.clinics cl
  where p.clinic_id = cl.id
    and public.crm_clinic_has_access(cl.id)
    and (
      p.ultima_consulta is null
      or p.ultima_consulta < (current_date - interval '90 days')
    )
    and p.status_relacionamento is distinct from 'sumido'::public.status_relacionamento;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'clinic_id', x.clinic_id,
      'cliente_id', x.p_id,
      'nome', x.p_nome,
      'telefone', x.p_telefone,
      'mensagem',
        coalesce(
          nullif(trim(x.cl_msg), ''),
          'Olá! Faz tempo que não nos visita. Quer agendar um horário connosco?'
        )
    )
  ), '[]'::jsonb)
  into result
  from (
    select
      p.clinic_id,
      p.id as p_id,
      p.nome as p_nome,
      p.telefone as p_telefone,
      cl.crm_reengagement_message as cl_msg
    from public.cs_clientes p
    inner join public.clinics cl on cl.id = p.clinic_id
    where public.crm_clinic_has_access(cl.id)
      and p.status_relacionamento = 'sumido'::public.status_relacionamento
      and (
        p.ultima_consulta is null
        or p.ultima_consulta < (current_date - interval '90 days')
      )
  ) x;

  return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.n8n_crm_mark_sumido_and_candidates() from public;
grant execute on function public.n8n_crm_mark_sumido_and_candidates() to service_role;
