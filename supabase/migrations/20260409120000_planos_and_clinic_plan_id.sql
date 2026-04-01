-- Planos comerciais (admin + landing) e ligação a clinics.plan_id.
-- tipo_plano continua preenchido com planos.codigo (compat n8n).
-- limite_* : usar -1 para ilimitado

create table if not exists public.planos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  preco_mensal numeric(12, 2),
  preco_anual numeric(12, 2),
  descricao text,
  features text[] not null default '{}',
  limite_profissionais integer not null default -1,
  limite_agendamentos_mes integer not null default -1,
  tem_crm boolean not null default false,
  tem_agente_ia boolean not null default false,
  tem_whatsapp boolean not null default false,
  tem_relatorios boolean not null default false,
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.planos is 'Planos comerciais; codigo estável para n8n (tipo_plano em clinics).';
comment on column public.planos.codigo is 'Identificador estável: teste, basico, profissional, enterprise, etc.';
comment on column public.planos.limite_profissionais is '-1 = ilimitado';
comment on column public.planos.limite_agendamentos_mes is '-1 = ilimitado';
comment on column public.planos.preco_mensal is 'Null = sob consulta / não aplicável no cartão';

create index if not exists idx_planos_ativo_ordem on public.planos (ativo, ordem);

alter table public.clinics
  add column if not exists plan_id uuid references public.planos (id) on delete set null;

alter table public.clinics
  add column if not exists plan_tem_crm boolean;

comment on column public.clinics.plan_id is 'Plano comercial atual; tipo_plano espelha planos.codigo via trigger.';
comment on column public.clinics.plan_tem_crm is 'Espelho de planos.tem_crm ao mudar plan_id (middleware CRM).';

-- Seed idempotente por codigo
insert into public.planos (
  codigo, nome, preco_mensal, preco_anual, descricao, features,
  limite_profissionais, limite_agendamentos_mes,
  tem_crm, tem_agente_ia, tem_whatsapp, tem_relatorios, ativo, ordem
)
values
(
  'teste',
  'Teste',
  0,
  null,
  'Trial para validar o painel e integrações.',
  array[
    'Período de teste com data de expiração',
    'Funções essenciais do painel',
    'Ideal para avaliar antes de contratar'
  ],
  5,
  500,
  false,
  true,
  true,
  true,
  true,
  0
),
(
  'basico',
  'Básico',
  199,
  null,
  'Para consultórios pequenos e independentes.',
  array[
    'Até 5 profissionais',
    'Agenda para 500+ pacientes',
    'Confirmação automática básica',
    'Suporte por email',
    'Relatórios simples'
  ],
  5,
  500,
  false,
  false,
  true,
  true,
  true,
  1
),
(
  'mensal',
  'Profissional',
  499,
  null,
  'Para clínicas e consultórios em crescimento.',
  array[
    'Até 20 profissionais',
    'Agenda para 5.000+ pacientes',
    'Confirmação automática avançada',
    'Suporte por WhatsApp e email',
    'Relatórios detalhados',
    'Integração com WhatsApp Business'
  ],
  20,
  5000,
  false,
  true,
  true,
  true,
  true,
  2
),
(
  'enterprise',
  'Enterprise',
  null,
  null,
  'Para redes e grandes clínicas.',
  array[
    'Profissionais ilimitados',
    'Pacientes ilimitados',
    'Confirmação automática com IA',
    'Suporte prioritário 24/7',
    'Relatórios avançados e BI',
    'Integrações customizadas',
    'Gestor dedicado',
    'Módulo CRM'
  ],
  -1,
  -1,
  true,
  true,
  true,
  true,
  true,
  3
)
on conflict (codigo) do nothing;

-- Espelho tipo_plano + plan_tem_crm a partir de plan_id
create or replace function public.clinics_sync_from_plan ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_tem_crm boolean;
begin
  if new.plan_id is null then
    return new;
  end if;

  select
    p.codigo,
    p.tem_crm
  into
    v_codigo,
    v_tem_crm
  from
    public.planos p
  where
    p.id = new.plan_id;

  if v_codigo is null then
    raise exception 'clinics.plan_id inválido: %', new.plan_id;
  end if;

  new.tipo_plano := v_codigo;
  new.plan_tem_crm := v_tem_crm;
  return new;
end;
$$;

drop trigger if exists trg_clinics_sync_from_plan on public.clinics;

create trigger trg_clinics_sync_from_plan
before insert
or
update of plan_id on public.clinics for each row
execute function public.clinics_sync_from_plan ();

-- Remover CHECK antigo em tipo_plano
alter table public.clinics
drop constraint if exists clinics_tipo_plano_check;

-- Backfill plan_id a partir de tipo_plano legado
update public.clinics c
set
  plan_id = p.id
from
  public.planos p
where
  c.plan_id is null
  and p.codigo = case
    when c.tipo_plano = 'mensal' then 'mensal'
    when c.tipo_plano = 'enterprise' then 'enterprise'
    when c.tipo_plano = 'teste' then 'teste'
    when c.tipo_plano = 'basico' then 'basico'
    else 'teste'
  end;

-- Sincronizar espelhos onde já havia plan_id ou após update acima (trigger não corre em UPDATE massivo sem plan_id change)
update public.clinics c
set
  tipo_plano = p.codigo,
  plan_tem_crm = p.tem_crm
from
  public.planos p
where
  c.plan_id = p.id
  and (
    c.tipo_plano is distinct from p.codigo
    or c.plan_tem_crm is distinct from p.tem_crm
  );

-- Garantir NOT NULL em plan_id para clínicas existentes (fallback teste)
update public.clinics
set
  plan_id = (
    select
      id
    from
      public.planos
    where
      codigo = 'teste'
    limit
      1
  )
where
  plan_id is null;

alter table public.planos enable row level security;

drop policy if exists planos_select_public_active on public.planos;

-- Leitura pública só de planos ativos (landing / select assinatura via anon)
create policy planos_select_public_active on public.planos for select to anon, authenticated using (ativo = true);

-- Sem política de escrita para JWT: mutações via service_role nas API admin

create or replace function public.planos_set_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_planos_updated_at on public.planos;

create trigger trg_planos_updated_at
before
update on public.planos for each row
execute function public.planos_set_updated_at ();
