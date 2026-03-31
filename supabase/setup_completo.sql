-- =============================================================================
-- SETUP COMPLETO — Novo projeto Supabase
-- Cola TUDO no SQL Editor → Run.  Idempotente (IF NOT EXISTS / DROP POLICY IF).
-- Ordem: extensões → tabelas base → índices → triggers → RLS → tabelas extras
-- =============================================================================

-- ========================  EXTENSÕES  ========================
create extension if not exists "uuid-ossp";
create extension if not exists btree_gist;

-- ========================  TABELAS BASE  ========================

-- 1. Clínicas
create table if not exists public.clinics (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique,
  phone text,
  timezone text not null default 'America/Sao_Paulo',
  owner_id uuid references auth.users (id),
  agent_instructions text, -- configuração do Agente IA em JSON
  slots_expediente jsonb not null default '{"preset":"two_blocks"}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.clinics
  add column if not exists slots_expediente jsonb not null default '{"preset":"two_blocks"}'::jsonb;

alter table public.clinics
  add column if not exists agenda_visible_hours integer[]
  not null default array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[];

-- 2. Pacientes
create table if not exists public.patients (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  phone text not null,
  name text,
  email text,
  created_at timestamptz not null default now(),
  unique (clinic_id, phone)
);
create index if not exists idx_patients_clinic_phone on public.patients (clinic_id, phone);

-- 3. Profissionais
create table if not exists public.professionals (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null,
  specialty text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  auth_user_id uuid unique references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_professionals_clinic on public.professionals (clinic_id);
create index if not exists idx_professionals_clinic_active on public.professionals (clinic_id) where is_active = true;
create index if not exists idx_professionals_auth_user on public.professionals (auth_user_id) where auth_user_id is not null;

-- 4. Enum + Appointments (modelo rico: clínica → profissional → paciente)
do $$ begin
  create type public.appointment_status as enum ('scheduled','cancelled','completed');
exception when duplicate_object then null;
end $$;

create table if not exists public.appointments (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete restrict,
  patient_id uuid not null references public.patients (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  service_name text,
  status public.appointment_status not null default 'scheduled',
  source text default 'whatsapp',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_appointment_time check (ends_at > starts_at)
);
create index if not exists idx_appointments_clinic_starts on public.appointments (clinic_id, starts_at);
create index if not exists idx_appointments_clinic_status on public.appointments (clinic_id, status);
create index if not exists idx_appointments_professional_starts on public.appointments (professional_id, starts_at);

-- 5. Agendamentos simples (tabela do workflow n8n "Isa")
create table if not exists public."Agendamentos" (
  id uuid default gen_random_uuid() primary key,
  nome_cliente varchar(255) not null,
  telefone_cliente varchar(30) not null,
  remote_jid text,
  data_agendamento date not null,
  horario time not null,
  tipo_servico varchar(100) not null,
  status varchar(20) default 'agendado'
    check (status in ('agendado','reagendado','cancelado','concluido','nao_compareceu')),
  observacoes text default '',
  motivo_cancelamento text,
  cancelled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ========================  TRIGGERS  ========================

create or replace function public.enforce_appointment_professional_clinic()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.professionals p
    where p.id = new.professional_id and p.clinic_id = new.clinic_id
  ) then
    raise exception 'professional_id must belong to the same clinic as clinic_id';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_professional_clinic on public.appointments;
create trigger trg_appointments_professional_clinic
  before insert or update of clinic_id, professional_id on public.appointments
  for each row execute function public.enforce_appointment_professional_clinic();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_appointments_updated_at on public.appointments;
create trigger trg_appointments_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- Exclusão de sobreposição (mesmo profissional)
do $$ begin
  alter table public.appointments
    add constraint appointments_no_overlap
    exclude using gist (
      professional_id with =,
      tstzrange(starts_at, ends_at, '[)') with &&
    )
    where (status = 'scheduled');
exception when duplicate_object then null;
end $$;

-- ========================  WHATSAPP SESSIONS  ========================

create table if not exists public.whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  phone text not null,
  needs_human boolean not null default false,
  staff_handling boolean not null default false,
  last_message_preview text,
  manual boolean not null default false,
  numero_cliente text,
  updated_at timestamptz not null default now(),
  unique (clinic_id, phone)
);
create index if not exists idx_whatsapp_sessions_clinic_needs
  on public.whatsapp_sessions (clinic_id)
  where needs_human = true and staff_handling = false;

-- ========================  CHAT AGENT TABLES  ========================

create table if not exists public.chat_clients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id) on delete set null,
  name text not null default '',
  phone text not null,
  email text,
  created_at timestamptz not null default now(),
  unique (phone)
);
create index if not exists idx_chat_clients_clinic on public.chat_clients (clinic_id);

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  client_id uuid references public.chat_clients (id) on delete set null,
  human_takeover boolean not null default false,
  takeover_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_chat_sessions_client on public.chat_sessions (client_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  client_id uuid references public.chat_clients (id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'human_agent')),
  content text not null,
  message_type text not null default 'text' check (message_type in ('text', 'image', 'audio')),
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_session_created on public.chat_messages (session_id, created_at desc);

create table if not exists public.chat_simple_appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id) on delete set null,
  client_id uuid not null references public.chat_clients (id) on delete cascade,
  specialty text not null,
  appointment_date date not null,
  appointment_time time not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'rescheduled', 'completed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_chat_simple_appts_client on public.chat_simple_appointments (client_id);

-- ========================  TABELAS AUXILIARES DO n8n (Isa)  ========================
-- Tabelas "empresa" e "clientes" usadas pelo workflow "Nós Nativos"
-- (Get Empresa, Get/Create Cliente, botativo)

create table if not exists public."Empresa" (
  id uuid primary key default gen_random_uuid(),
  "TelefoneWhatsapp" text unique not null,
  nome text,
  created_at timestamptz default now()
);

create table if not exists public."Clientes" (
  id uuid primary key default gen_random_uuid(),
  "IdEmpresa" uuid references public."Empresa" (id) on delete cascade,
  "TelefoneWhatsapp" text not null,
  nome text,
  botativo text default 'true',
  created_at timestamptz default now(),
  unique ("IdEmpresa", "TelefoneWhatsapp")
);

-- ========================  RLS (helpers multi-tenant)  ========================

-- Verifica se o utilizador é dono (owner_id) da clínica
create or replace function public.rls_is_clinic_owner(p_clinic_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.clinics c
    where c.id = p_clinic_id and c.owner_id = (select auth.uid())
  );
$$;

-- Verifica se o utilizador é dono OU membro (clinic_members) da clínica
-- Usar esta função em TODAS as políticas RLS de acesso a dados
create or replace function public.rls_has_clinic_access(p_clinic_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select
    public.rls_is_clinic_owner(p_clinic_id)
    or exists (
      select 1 from public.clinic_members m
      where m.clinic_id = p_clinic_id
        and m.user_id = (select auth.uid())
    );
$$;

-- Verifica se o utilizador é profissional da clínica (via auth_user_id)
create or replace function public.rls_professional_at_clinic(p_clinic_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.professionals p
    where p.clinic_id = p_clinic_id and p.auth_user_id = (select auth.uid())
  );
$$;

revoke all on function public.rls_is_clinic_owner(uuid)      from public;
revoke all on function public.rls_has_clinic_access(uuid)    from public;
revoke all on function public.rls_professional_at_clinic(uuid) from public;
grant execute on function public.rls_is_clinic_owner(uuid)      to authenticated, service_role;
grant execute on function public.rls_has_clinic_access(uuid)    to authenticated, service_role;
grant execute on function public.rls_professional_at_clinic(uuid) to authenticated, service_role;

-- ========================  CLINIC_MEMBERS (tabela de membros)  ========================

create table if not exists public.clinic_members (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  user_id    uuid not null references auth.users(id)     on delete cascade,
  role       text not null default 'staff',
  created_at timestamptz not null default now(),
  constraint clinic_members_role_check        check (role in ('owner','admin','staff','viewer')),
  constraint clinic_members_clinic_user_unique unique (clinic_id, user_id)
);

create index if not exists idx_clinic_members_user_id   on public.clinic_members(user_id);
create index if not exists idx_clinic_members_clinic_id on public.clinic_members(clinic_id);

-- Backfill: donos existentes → clinic_members
insert into public.clinic_members(clinic_id, user_id, role)
select id, owner_id, 'owner' from public.clinics where owner_id is not null
on conflict (clinic_id, user_id) do nothing;

-- Trigger: owner_id → clinic_members automaticamente
create or replace function public.trg_clinics_owner_to_clinic_member()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into public.clinic_members(clinic_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict (clinic_id, user_id) do update set role = excluded.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinics_owner_member on public.clinics;
create trigger trg_clinics_owner_member
  after insert or update of owner_id on public.clinics
  for each row when (new.owner_id is not null)
  execute function public.trg_clinics_owner_to_clinic_member();

alter table public.clinic_members enable row level security;
drop policy if exists "clinic_members_select_own"   on public.clinic_members;
drop policy if exists "clinic_members_owner_insert" on public.clinic_members;
drop policy if exists "clinic_members_owner_update" on public.clinic_members;
drop policy if exists "clinic_members_owner_delete" on public.clinic_members;
create policy "clinic_members_select_own"   on public.clinic_members for select using (user_id = (select auth.uid()));
create policy "clinic_members_owner_insert" on public.clinic_members for insert with check (public.rls_is_clinic_owner(clinic_id));
create policy "clinic_members_owner_update" on public.clinic_members for update using (public.rls_is_clinic_owner(clinic_id)) with check (public.rls_is_clinic_owner(clinic_id));
create policy "clinic_members_owner_delete" on public.clinic_members for delete using (public.rls_is_clinic_owner(clinic_id));

-- ========================  RLS (todas as tabelas usam rls_has_clinic_access)  ========================

alter table public.clinics        enable row level security;
alter table public.professionals  enable row level security;
alter table public.patients       enable row level security;
alter table public.appointments   enable row level security;
alter table public.whatsapp_sessions enable row level security;

-- Clinics
drop policy if exists "owners_read_own_clinic"        on public.clinics;
drop policy if exists "owners_update_own_clinic"      on public.clinics;
drop policy if exists "owners_insert_own_clinic"      on public.clinics;
drop policy if exists "professionals_read_own_clinic" on public.clinics;
create policy "owners_read_own_clinic"        on public.clinics for select using (public.rls_has_clinic_access(id));
create policy "owners_update_own_clinic"      on public.clinics for update using (public.rls_has_clinic_access(id)) with check (public.rls_has_clinic_access(id));
create policy "owners_insert_own_clinic"      on public.clinics for insert with check (auth.uid() = owner_id);
create policy "professionals_read_own_clinic" on public.clinics for select using (public.rls_professional_at_clinic(id));

-- Professionals
drop policy if exists "owners_manage_professionals" on public.professionals;
drop policy if exists "professionals_read_self"     on public.professionals;
create policy "owners_manage_professionals" on public.professionals for all
  using (public.rls_has_clinic_access(professionals.clinic_id))
  with check (public.rls_has_clinic_access(professionals.clinic_id));
create policy "professionals_read_self" on public.professionals for select using (auth_user_id = (select auth.uid()));

-- Patients
drop policy if exists "owners_read_patients"   on public.patients;
drop policy if exists "owners_insert_patients" on public.patients;
drop policy if exists "owners_update_patients" on public.patients;
drop policy if exists "owners_delete_patients" on public.patients;
drop policy if exists "professionals_read_patients_own_appointments" on public.patients;
create policy "owners_read_patients"   on public.patients for select using (public.rls_has_clinic_access(patients.clinic_id));
create policy "owners_insert_patients" on public.patients for insert with check (public.rls_has_clinic_access(clinic_id));
create policy "owners_update_patients" on public.patients for update using (public.rls_has_clinic_access(patients.clinic_id)) with check (public.rls_has_clinic_access(patients.clinic_id));
create policy "owners_delete_patients" on public.patients for delete using (public.rls_has_clinic_access(patients.clinic_id));
create policy "professionals_read_patients_own_appointments" on public.patients for select
  using (exists (select 1 from public.appointments a join public.professionals p on p.id = a.professional_id where a.patient_id = patients.id and p.auth_user_id = (select auth.uid())));

-- Appointments
drop policy if exists "owners_read_appointments"   on public.appointments;
drop policy if exists "owners_insert_appointments" on public.appointments;
drop policy if exists "owners_update_appointments" on public.appointments;
drop policy if exists "owners_delete_appointments" on public.appointments;
drop policy if exists "professionals_read_own_appointments" on public.appointments;
create policy "owners_read_appointments"   on public.appointments for select using (public.rls_has_clinic_access(appointments.clinic_id));
create policy "owners_insert_appointments" on public.appointments for insert with check (public.rls_has_clinic_access(clinic_id));
create policy "owners_update_appointments" on public.appointments for update using (public.rls_has_clinic_access(appointments.clinic_id)) with check (public.rls_has_clinic_access(appointments.clinic_id));
create policy "owners_delete_appointments" on public.appointments for delete using (public.rls_has_clinic_access(appointments.clinic_id));
create policy "professionals_read_own_appointments" on public.appointments for select
  using (exists (select 1 from public.professionals p where p.id = appointments.professional_id and p.auth_user_id = (select auth.uid())));

-- WhatsApp sessions
drop policy if exists "owners_read_whatsapp_sessions"   on public.whatsapp_sessions;
drop policy if exists "owners_insert_whatsapp_sessions" on public.whatsapp_sessions;
drop policy if exists "owners_update_whatsapp_sessions" on public.whatsapp_sessions;
drop policy if exists "owners_delete_whatsapp_sessions" on public.whatsapp_sessions;
create policy "owners_read_whatsapp_sessions"   on public.whatsapp_sessions for select using (public.rls_has_clinic_access(whatsapp_sessions.clinic_id));
create policy "owners_insert_whatsapp_sessions" on public.whatsapp_sessions for insert with check (public.rls_has_clinic_access(clinic_id));
create policy "owners_update_whatsapp_sessions" on public.whatsapp_sessions for update using (public.rls_has_clinic_access(whatsapp_sessions.clinic_id)) with check (public.rls_has_clinic_access(whatsapp_sessions.clinic_id));
create policy "owners_delete_whatsapp_sessions" on public.whatsapp_sessions for delete using (public.rls_has_clinic_access(whatsapp_sessions.clinic_id));

-- ========================  SEED (opcional — apenas para desenvolvimento local)  ========================
-- ATENÇÃO: Não executar em produção. O seed cria uma clínica demo SEM owner_id,
-- o que viola a constraint de isolamento multi-tenant.
-- Para criar dados de teste, use o fluxo normal de cadastro (/cadastro).
--
-- Exemplo de seed para desenvolvimento:
-- insert into public.clinics (name, slug, phone, owner_id)
-- select 'Clínica Demo', 'demo', '+5511999990000', (select id from auth.users limit 1)
-- where not exists (select 1 from public.clinics where slug = 'demo');

-- ========================  COMMENTS  ========================

comment on table public.clinics is 'Consultório / clínica';
comment on table public.professionals is 'Profissionais; agendamento vinculado a um';
comment on table public.patients is 'Paciente por clínica; telefone único por clínica';
comment on table public.appointments is 'Consulta com profissional; overlap só no mesmo professional_id';
comment on table public.whatsapp_sessions is 'Sessões WhatsApp: needs_human + staff_handling.';
comment on table public.chat_clients is 'Clientes do canal; upsert por phone.';
comment on table public.chat_sessions is 'human_takeover + takeover_at: janela 60s.';
comment on table public.chat_messages is 'Histórico user/assistant/human_agent.';
comment on table public.chat_simple_appointments is 'Agendamentos simplificados pelo agente chat.';
comment on table public."Agendamentos" is 'Agendamentos simples do workflow Isa (n8n nós nativos).';

-- Agendamento n8n (PostgREST cs_*): após aplicar supabase/clinica_sorriso_n8n_tools.sql,
-- rode supabase/seed_cs_clinica_saude_equipe_horarios.sql para profissionais + vagas nos horários da clínica.
-- Projetos antigos: aplicar também supabase/migration_cs_agendamentos_nomes_snapshot.sql
-- (colunas nome_cliente, nome_profissional, nome_procedimento em cs_agendamentos + RPCs atualizadas).
-- Catálogo de procedimentos por clínica (painel + agente): supabase/clinic_procedures.sql
