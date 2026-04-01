-- ============================================================================
-- n8n: resolução multi-tenant (instance Evolution + numero_clinica) e assinatura
-- Depende de public.clinics e public.clinic_whatsapp_integrations
-- ============================================================================

-- Campos de assinatura / identificação na clínica
alter table public.clinics
  add column if not exists numero_clinica text;

create unique index if not exists idx_clinics_numero_clinica_unique
  on public.clinics (numero_clinica)
  where numero_clinica is not null and trim(numero_clinica) <> '';

alter table public.clinics
  add column if not exists tipo_plano text not null default 'teste';

alter table public.clinics
  drop constraint if exists clinics_tipo_plano_check;

alter table public.clinics
  add constraint clinics_tipo_plano_check
  check (tipo_plano in ('teste', 'mensal'));

alter table public.clinics
  add column if not exists data_expiracao date;

alter table public.clinics
  add column if not exists inadimplente boolean not null default false;

alter table public.clinics
  add column if not exists ativo boolean not null default true;

comment on column public.clinics.numero_clinica is 'Código opcional para desambiguar clínica no webhook (além de instance_name).';
comment on column public.clinics.tipo_plano is 'teste | mensal — usado pelo fluxo n8n para bloqueio.';
comment on column public.clinics.data_expiracao is 'Fim do trial (teste) ou fim do período pago (mensal).';
comment on column public.clinics.inadimplente is 'Bloqueio comercial para plano mensal.';
comment on column public.clinics.ativo is 'Se false, atendimento automático bloqueado no n8n.';

-- Garantir tabela de integração WhatsApp (idempotente; alinhado a database/migration_whatsapp_columns.sql)
create table if not exists public.clinic_whatsapp_integrations (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  instance_name text not null unique,
  instance_id text,
  phone_number text,
  status text not null default 'disconnected',
  webhook_url text not null,
  webhook_configured boolean not null default false,
  last_qr_code text,
  last_connection_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_whatsapp_integrations_status_check check (
    status in (
      'checking_config',
      'creating_instance',
      'configuring_webhook',
      'waiting_qrcode',
      'connected',
      'disconnected',
      'error'
    )
  )
);

create index if not exists idx_clinic_whatsapp_integrations_status
  on public.clinic_whatsapp_integrations (status);

-- Histórico simples para o fluxo n8n (legado conversas → alinhado a public.clinics)
create table if not exists public.conversas (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references public.clinics (id) on delete cascade,
  paciente_telefone text not null,
  historico jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinica_id, paciente_telefone)
);

create index if not exists idx_conversas_clinica_telefone
  on public.conversas (clinica_id, paciente_telefone);

-- VIEW consumida pelo n8n / inspeção
create or replace view public.n8n_clinic_directory
with (security_invoker = true)
as
select
  c.id as clinica_id,
  c.name as clinica_nome,
  w.instance_name,
  c.numero_clinica,
  c.ativo as clinica_ativa,
  c.tipo_plano,
  c.data_expiracao,
  c.inadimplente,
  w.status as whatsapp_status,
  c.agent_instructions
from public.clinics c
inner join public.clinic_whatsapp_integrations w on w.clinic_id = c.id;

comment on view public.n8n_clinic_directory is 'Join clínica + WhatsApp para resolução de tenant no n8n.';

-- RPC: uma linha com found, erro e cenario calculado
create or replace function public.n8n_resolve_clinic(
  p_instance_name text,
  p_numero_clinica text
)
returns table (
  found boolean,
  erro text,
  clinica_id uuid,
  instance_name text,
  numero_clinica text,
  clinica_ativa boolean,
  tipo_plano text,
  data_expiracao date,
  inadimplente boolean,
  whatsapp_status text,
  clinica_nome text,
  agent_instructions text,
  cenario text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst text := nullif(trim(p_instance_name), '');
  v_num_raw text := nullif(trim(p_numero_clinica), '');
  v_num text := nullif(lower(v_num_raw), '');
  n int;
begin
  -- 1) Por instance_name
  if v_inst is not null then
    select count(*)::int into n
    from public.n8n_clinic_directory d
    where d.instance_name = v_inst;

    if n = 1 then
      return query
      select
        true,
        null::text,
        d.clinica_id,
        d.instance_name,
        d.numero_clinica,
        d.clinica_ativa,
        d.tipo_plano,
        d.data_expiracao,
        d.inadimplente,
        d.whatsapp_status,
        d.clinica_nome,
        d.agent_instructions,
        (
          case
            when not coalesce(d.clinica_ativa, true) then 'clinica_nao_encontrada'
            when d.tipo_plano = 'teste'
              and d.data_expiracao is not null
              and current_date > d.data_expiracao
              then 'teste_expirado'
            when d.tipo_plano = 'mensal'
              and (
                coalesce(d.inadimplente, false)
                or (
                  d.data_expiracao is not null
                  and current_date > d.data_expiracao
                )
              )
              then 'mensal_expirado'
            else 'ativo'
          end
        )::text
      from public.n8n_clinic_directory d
      where d.instance_name = v_inst
      limit 1;
      return;
    elsif n > 1 then
      if v_num is null then
        return query
        select
          false,
          'ambiguous'::text,
          null::uuid,
          null::text,
          null::text,
          null::boolean,
          null::text,
          null::date,
          null::boolean,
          null::text,
          null::text,
          null::text,
          'clinica_nao_encontrada'::text;
        return;
      end if;

      select count(*)::int into n
      from public.n8n_clinic_directory d
      where d.instance_name = v_inst
        and v_num is not null
        and lower(trim(coalesce(d.numero_clinica, ''))) = v_num;

      if n = 1 then
        return query
        select
          true,
          null::text,
          d.clinica_id,
          d.instance_name,
          d.numero_clinica,
          d.clinica_ativa,
          d.tipo_plano,
          d.data_expiracao,
          d.inadimplente,
          d.whatsapp_status,
          d.clinica_nome,
          d.agent_instructions,
          (
            case
              when not coalesce(d.clinica_ativa, true) then 'clinica_nao_encontrada'
              when d.tipo_plano = 'teste'
                and d.data_expiracao is not null
                and current_date > d.data_expiracao
                then 'teste_expirado'
              when d.tipo_plano = 'mensal'
                and (
                  coalesce(d.inadimplente, false)
                  or (
                    d.data_expiracao is not null
                    and current_date > d.data_expiracao
                  )
                )
                then 'mensal_expirado'
              else 'ativo'
            end
          )::text
        from public.n8n_clinic_directory d
        where d.instance_name = v_inst
          and lower(trim(coalesce(d.numero_clinica, ''))) = v_num
        limit 1;
        return;
      end if;

      return query
      select
        false,
        'ambiguous'::text,
        null::uuid,
        null::text,
        null::text,
        null::boolean,
        null::text,
        null::date,
        null::boolean,
        null::text,
        null::text,
        null::text,
        'clinica_nao_encontrada'::text;
      return;
    end if;
  end if;

  -- 2) Fallback numero_clinica
  if v_num is not null then
    select count(*)::int into n
    from public.n8n_clinic_directory d
    where lower(trim(coalesce(d.numero_clinica, ''))) = v_num;

    if n = 1 then
      return query
      select
        true,
        null::text,
        d.clinica_id,
        d.instance_name,
        d.numero_clinica,
        d.clinica_ativa,
        d.tipo_plano,
        d.data_expiracao,
        d.inadimplente,
        d.whatsapp_status,
        d.clinica_nome,
        d.agent_instructions,
        (
          case
            when not coalesce(d.clinica_ativa, true) then 'clinica_nao_encontrada'
            when d.tipo_plano = 'teste'
              and d.data_expiracao is not null
              and current_date > d.data_expiracao
              then 'teste_expirado'
            when d.tipo_plano = 'mensal'
              and (
                coalesce(d.inadimplente, false)
                or (
                  d.data_expiracao is not null
                  and current_date > d.data_expiracao
                )
              )
              then 'mensal_expirado'
            else 'ativo'
          end
        )::text
      from public.n8n_clinic_directory d
      where lower(trim(coalesce(d.numero_clinica, ''))) = v_num
      limit 1;
      return;
    elsif n > 1 then
      return query
      select
        false,
        'ambiguous'::text,
        null::uuid,
        null::text,
        null::text,
        null::boolean,
        null::text,
        null::date,
        null::boolean,
        null::text,
        null::text,
        null::text,
        'clinica_nao_encontrada'::text;
      return;
    end if;
  end if;

  return query
  select
    false,
    'not_found'::text,
    null::uuid,
    null::text,
    null::text,
    null::boolean,
    null::text,
    null::date,
    null::boolean,
    null::text,
    null::text,
    null::text,
    'clinica_nao_encontrada'::text;
end;
$$;

comment on function public.n8n_resolve_clinic(text, text) is
  'Resolve clínica por instance Evolution (prioritário) e numero_clinica; devolve cenario para Switch no n8n.';

revoke all on function public.n8n_resolve_clinic(text, text) from public;
grant execute on function public.n8n_resolve_clinic(text, text) to service_role;
