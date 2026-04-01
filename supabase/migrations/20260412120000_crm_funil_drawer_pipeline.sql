-- CRM: funil (status_funil), origem, tarefas follow-up, interações, RPCs drawer/métricas, sync sumido.

-- ---------------------------------------------------------------------------
-- 1. Enum e colunas em cs_clientes
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_status_funil') then
    create type public.crm_status_funil as enum (
      'lead',
      'agendado',
      'atendido',
      'inativo',
      'sumido'
    );
  end if;
end$$;

alter table public.cs_clientes
  add column if not exists status_funil public.crm_status_funil not null default 'lead';

alter table public.cs_clientes
  add column if not exists origem text;

comment on column public.cs_clientes.status_funil is 'Estado do funil comercial (kanban CRM).';
comment on column public.cs_clientes.origem is 'Origem explícita do paciente; se null, métricas inferem pelo primeiro agendamento.';

-- Backfill (antes de tornar not null já está com default)
update public.cs_clientes c
set status_funil = 'sumido'::public.crm_status_funil
where c.status_relacionamento = 'sumido'::public.status_relacionamento;

update public.cs_clientes c
set status_funil = 'inativo'::public.crm_status_funil
where c.status_relacionamento = 'inativo'::public.status_relacionamento
  and c.status_funil is distinct from 'sumido'::public.crm_status_funil;

update public.cs_clientes c
set status_funil = 'atendido'::public.crm_status_funil
where c.status_relacionamento = 'ativo'::public.status_relacionamento
  and coalesce(c.total_consultas, 0) >= 1
  and c.status_funil not in (
    'sumido'::public.crm_status_funil,
    'inativo'::public.crm_status_funil
  );

-- ---------------------------------------------------------------------------
-- 2. Tabelas CRM auxiliares
-- ---------------------------------------------------------------------------
create table if not exists public.crm_followup_tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  cliente_id uuid not null references public.cs_clientes (id) on delete cascade,
  titulo text not null,
  due_date date not null,
  concluido_em timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_followup_clinic_due
  on public.crm_followup_tasks (clinic_id, due_date);

create index if not exists idx_crm_followup_clinic_cliente
  on public.crm_followup_tasks (clinic_id, cliente_id);

comment on table public.crm_followup_tasks is 'Tarefas de follow-up CRM por paciente.';

create table if not exists public.crm_interacoes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  cliente_id uuid not null references public.cs_clientes (id) on delete cascade,
  tipo text not null default 'nota',
  resumo text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_interacoes_clinic_cliente
  on public.crm_interacoes (clinic_id, cliente_id, created_at desc);

comment on table public.crm_interacoes is 'Histórico manual de interações CRM.';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.crm_followup_tasks enable row level security;
alter table public.crm_interacoes enable row level security;

drop policy if exists crm_followup_tasks_access on public.crm_followup_tasks;
create policy crm_followup_tasks_access on public.crm_followup_tasks
  for all to authenticated
  using (
    clinic_id is not null
    and public.rls_has_clinic_access (clinic_id)
  )
  with check (
    clinic_id is not null
    and public.rls_has_clinic_access (clinic_id)
  );

drop policy if exists crm_interacoes_access on public.crm_interacoes;
create policy crm_interacoes_access on public.crm_interacoes
  for all to authenticated
  using (
    clinic_id is not null
    and public.rls_has_clinic_access (clinic_id)
  )
  with check (
    clinic_id is not null
    and public.rls_has_clinic_access (clinic_id)
  );

-- ---------------------------------------------------------------------------
-- 4. Sync sumido entre status_relacionamento e status_funil (00 = first)
-- ---------------------------------------------------------------------------
create or replace function public.cs_clientes_sync_funil_sumido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status_relacionamento = 'sumido'::public.status_relacionamento then
    new.status_funil := 'sumido'::public.crm_status_funil;
  elsif new.status_funil = 'sumido'::public.crm_status_funil then
    new.status_relacionamento := 'sumido'::public.status_relacionamento;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cs_clientes_00_sync_funil_sumido on public.cs_clientes;

create trigger trg_cs_clientes_00_sync_funil_sumido
  before insert or update on public.cs_clientes
  for each row
  execute function public.cs_clientes_sync_funil_sumido();

-- ---------------------------------------------------------------------------
-- 5. Enforcement CRM: incluir status_funil e origem
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
      or new.status_funil is distinct from old.status_funil
      or new.origem is distinct from old.origem
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
  c.status_funil,
  c.origem,
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

grant select on public.crm_visao_pacientes to service_role;

-- ---------------------------------------------------------------------------
-- 7. painel_crm_list_pacientes
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
          'status_funil', v.status_funil::text,
          'origem', v.origem,
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
-- 8. painel_crm_paciente_agendamentos
-- ---------------------------------------------------------------------------
create or replace function public.painel_crm_paciente_agendamentos(
  p_clinic_id uuid,
  p_cliente_id uuid
)
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
      message = 'CRM requer plano adequado.';
  end if;

  if not exists (
    select 1
    from public.cs_clientes c
    where c.id = p_cliente_id
      and c.clinic_id = p_clinic_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(x.obj order by x.sort_ts desc)
    from (
      select
        jsonb_build_object(
          'id', a.id,
          'data_agendamento', a.data_agendamento,
          'horario', to_char(a.horario, 'HH24:MI'),
          'status', a.status,
          'profissional', coalesce(nullif(trim(a.nome_profissional), ''), p.nome),
          'servico', coalesce(nullif(trim(a.nome_procedimento), ''), s.nome),
          'source', case
            when coalesce(a.painel_confirmado, false) then 'painel'
            else 'whatsapp'
          end,
          'observacoes', nullif(trim(a.observacoes), '')
        ) as obj,
        (a.data_agendamento + a.horario) as sort_ts
      from public.cs_agendamentos a
      inner join public.cs_profissionais p
        on p.id = a.profissional_id
        and p.clinic_id = p_clinic_id
      left join public.cs_servicos s on s.id = a.servico_id
      where a.clinic_id = p_clinic_id
        and a.cliente_id = p_cliente_id
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.painel_crm_paciente_agendamentos(uuid, uuid) from public;
grant execute on function public.painel_crm_paciente_agendamentos(uuid, uuid) to authenticated;
grant execute on function public.painel_crm_paciente_agendamentos(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. painel_crm_paciente_interacoes
-- ---------------------------------------------------------------------------
create or replace function public.painel_crm_paciente_interacoes(
  p_clinic_id uuid,
  p_cliente_id uuid
)
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
      message = 'CRM requer plano adequado.';
  end if;

  if not exists (
    select 1
    from public.cs_clientes c
    where c.id = p_cliente_id
      and c.clinic_id = p_clinic_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(x.obj order by x.sort_ts desc)
    from (
      select
        jsonb_build_object(
          'id', i.id,
          'tipo', i.tipo,
          'resumo', i.resumo,
          'metadata', i.metadata,
          'created_at', i.created_at
        ) as obj,
        i.created_at as sort_ts
      from public.crm_interacoes i
      where i.clinic_id = p_clinic_id
        and i.cliente_id = p_cliente_id
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.painel_crm_paciente_interacoes(uuid, uuid) from public;
grant execute on function public.painel_crm_paciente_interacoes(uuid, uuid) to authenticated;
grant execute on function public.painel_crm_paciente_interacoes(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. painel_crm_metricas
-- ---------------------------------------------------------------------------
create or replace function public.painel_crm_metricas(
  p_clinic_id uuid,
  p_mes_ref date default (current_date)
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mes_ini date;
  v_mes_fim date;
  v_com_1 int;
  v_com_2 int;
  v_inat_60 int;
  v_sum_90 int;
  v_origens jsonb;
  v_top jsonb;
  v_taxa numeric;
begin
  if not public.rls_has_clinic_access(p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.crm_clinic_has_access(p_clinic_id) then
    raise exception 'plan_required'
      using errcode = 'P0001',
      message = 'CRM requer plano adequado.';
  end if;

  v_mes_ini := date_trunc('month', p_mes_ref)::date;
  v_mes_fim := (date_trunc('month', p_mes_ref) + interval '1 month - 1 day')::date;

  select count(*)::int
  into v_com_1
  from public.cs_clientes c
  where c.clinic_id = p_clinic_id
    and coalesce(c.total_consultas, 0) >= 1;

  select count(*)::int
  into v_com_2
  from public.cs_clientes c
  where c.clinic_id = p_clinic_id
    and coalesce(c.total_consultas, 0) >= 2;

  v_taxa := case
    when v_com_1 > 0 then round(v_com_2::numeric / v_com_1::numeric, 4)
    else null
  end;

  select count(*)::int
  into v_inat_60
  from public.cs_clientes c
  where c.clinic_id = p_clinic_id
    and c.status_funil is distinct from 'sumido'::public.crm_status_funil
    and (
      c.ultima_consulta is null
      or c.ultima_consulta < (current_date - 60)
    );

  select count(*)::int
  into v_sum_90
  from public.cs_clientes c
  where c.clinic_id = p_clinic_id
    and (
      c.status_funil = 'sumido'::public.crm_status_funil
      or (
        c.ultima_consulta is not null
        and c.ultima_consulta < (current_date - 90)
      )
    );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'label', o.lb,
      'count', o.cnt
    )
    order by o.cnt desc
  ), '[]'::jsonb)
  into v_origens
  from (
    select
      coalesce(
        nullif(trim(c.origem), ''),
        fa.infer_src,
        'Desconhecido'
      ) as lb,
      count(*)::int as cnt
    from public.cs_clientes c
    left join lateral (
      select
        case
          when coalesce(a.painel_confirmado, false) then 'Painel'
          else 'WhatsApp'
        end as infer_src
      from public.cs_agendamentos a
      where a.cliente_id = c.id
        and a.clinic_id = p_clinic_id
      order by a.data_agendamento asc, a.horario asc
      limit 1
    ) fa on true
    where c.clinic_id = p_clinic_id
    group by 1
  ) o;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'profissional', t.nm,
      'total', t.cnt
    )
    order by t.cnt desc
  ), '[]'::jsonb)
  into v_top
  from (
    select
      coalesce(nullif(trim(a.nome_profissional), ''), p.nome) as nm,
      count(*)::int as cnt
    from public.cs_agendamentos a
    inner join public.cs_profissionais p
      on p.id = a.profissional_id
      and p.clinic_id = p_clinic_id
    where a.clinic_id = p_clinic_id
      and a.data_agendamento >= v_mes_ini
      and a.data_agendamento <= v_mes_fim
      and coalesce(a.status, '') not in ('cancelado')
    group by 1
    order by cnt desc
    limit 5
  ) t;

  return jsonb_build_object(
    'taxa_retorno', v_taxa,
    'total_com_consulta', v_com_1,
    'total_com_retorno', v_com_2,
    'total_inativos_60d', v_inat_60,
    'total_sumidos_90d', v_sum_90,
    'origens', v_origens,
    'top_profissionais_mes', v_top,
    'mes_referencia_ini', v_mes_ini,
    'mes_referencia_fim', v_mes_fim
  );
end;
$$;

revoke all on function public.painel_crm_metricas(uuid, date) from public;
grant execute on function public.painel_crm_metricas(uuid, date) to authenticated;
grant execute on function public.painel_crm_metricas(uuid, date) to service_role;

-- n8n: compatibilidade chamada com 1 arg (default mês actual)
create or replace function public.painel_crm_metricas(p_clinic_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.painel_crm_metricas(p_clinic_id, current_date);
$$;

revoke all on function public.painel_crm_metricas(uuid) from public;
grant execute on function public.painel_crm_metricas(uuid) to authenticated;
grant execute on function public.painel_crm_metricas(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 11. n8n: marcar sumido também no funil
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
  set
    status_relacionamento = 'sumido'::public.status_relacionamento,
    status_funil = 'sumido'::public.crm_status_funil
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
