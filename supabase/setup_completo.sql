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
  created_at timestamptz not null default now()
);

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

-- ========================  RLS (helpers anti-recursão clinics ↔ professionals)  ========================

create or replace function public.rls_is_clinic_owner(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.clinics c
    where c.id = p_clinic_id and c.owner_id = (select auth.uid())
  );
$$;

create or replace function public.rls_professional_at_clinic(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.professionals p
    where p.clinic_id = p_clinic_id and p.auth_user_id = (select auth.uid())
  );
$$;

revoke all on function public.rls_is_clinic_owner(uuid) from public;
grant execute on function public.rls_is_clinic_owner(uuid) to authenticated;
grant execute on function public.rls_is_clinic_owner(uuid) to service_role;

revoke all on function public.rls_professional_at_clinic(uuid) from public;
grant execute on function public.rls_professional_at_clinic(uuid) to authenticated;
grant execute on function public.rls_professional_at_clinic(uuid) to service_role;

-- ========================  RLS  ========================

alter table public.clinics enable row level security;
alter table public.professionals enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.whatsapp_sessions enable row level security;

-- Clinics
drop policy if exists "owners_read_own_clinic" on public.clinics;
create policy "owners_read_own_clinic" on public.clinics for select using (auth.uid() = owner_id);

drop policy if exists "owners_update_own_clinic" on public.clinics;
create policy "owners_update_own_clinic" on public.clinics for update using (auth.uid() = owner_id);

drop policy if exists "owners_insert_own_clinic" on public.clinics;
create policy "owners_insert_own_clinic" on public.clinics for insert with check (auth.uid() = owner_id);

-- Professionals
drop policy if exists "owners_manage_professionals" on public.professionals;
create policy "owners_manage_professionals" on public.professionals for all
  using (public.rls_is_clinic_owner(professionals.clinic_id))
  with check (public.rls_is_clinic_owner(professionals.clinic_id));

drop policy if exists "professionals_read_self" on public.professionals;
create policy "professionals_read_self" on public.professionals for select using (auth_user_id = auth.uid());

drop policy if exists "professionals_read_own_clinic" on public.clinics;
create policy "professionals_read_own_clinic" on public.clinics for select
  using (public.rls_professional_at_clinic(clinics.id));

-- Patients
drop policy if exists "owners_read_patients" on public.patients;
create policy "owners_read_patients" on public.patients for select
  using (public.rls_is_clinic_owner(patients.clinic_id));

drop policy if exists "owners_insert_patients" on public.patients;
create policy "owners_insert_patients" on public.patients for insert
  with check (public.rls_is_clinic_owner(clinic_id));

drop policy if exists "owners_update_patients" on public.patients;
create policy "owners_update_patients" on public.patients for update
  using (public.rls_is_clinic_owner(patients.clinic_id))
  with check (public.rls_is_clinic_owner(patients.clinic_id));

drop policy if exists "professionals_read_patients_own_appointments" on public.patients;
create policy "professionals_read_patients_own_appointments" on public.patients for select
  using (exists (select 1 from public.appointments a join public.professionals p on p.id = a.professional_id where a.patient_id = patients.id and p.auth_user_id = auth.uid()));

-- Appointments
drop policy if exists "owners_read_appointments" on public.appointments;
create policy "owners_read_appointments" on public.appointments for select
  using (public.rls_is_clinic_owner(appointments.clinic_id));

drop policy if exists "owners_insert_appointments" on public.appointments;
create policy "owners_insert_appointments" on public.appointments for insert
  with check (public.rls_is_clinic_owner(clinic_id));

drop policy if exists "owners_update_appointments" on public.appointments;
create policy "owners_update_appointments" on public.appointments for update
  using (public.rls_is_clinic_owner(appointments.clinic_id))
  with check (public.rls_is_clinic_owner(appointments.clinic_id));

drop policy if exists "professionals_read_own_appointments" on public.appointments;
create policy "professionals_read_own_appointments" on public.appointments for select
  using (exists (select 1 from public.professionals p where p.id = appointments.professional_id and p.auth_user_id = auth.uid()));

-- WhatsApp sessions
drop policy if exists "owners_read_whatsapp_sessions" on public.whatsapp_sessions;
create policy "owners_read_whatsapp_sessions" on public.whatsapp_sessions for select
  using (public.rls_is_clinic_owner(whatsapp_sessions.clinic_id));

drop policy if exists "owners_update_whatsapp_sessions" on public.whatsapp_sessions;
create policy "owners_update_whatsapp_sessions" on public.whatsapp_sessions for update
  using (public.rls_is_clinic_owner(whatsapp_sessions.clinic_id))
  with check (public.rls_is_clinic_owner(whatsapp_sessions.clinic_id));

drop policy if exists "owners_insert_whatsapp_sessions" on public.whatsapp_sessions;
create policy "owners_insert_whatsapp_sessions" on public.whatsapp_sessions for insert
  with check (public.rls_is_clinic_owner(clinic_id));

-- ========================  SEED (opcional)  ========================

insert into public.clinics (name, slug, phone)
select 'Consultório Demo', 'demo', '+5511999990000'
where not exists (select 1 from public.clinics where slug = 'demo');

insert into public.professionals (clinic_id, name, specialty)
select c.id, v.name, v.specialty
from public.clinics c
cross join (values
  ('Dra. Maria Letícia', 'Clínica geral'),
  ('Dr. João Lucas', 'Clínica geral')
) as v(name, specialty)
where c.slug = 'demo'
  and not exists (select 1 from public.professionals p where p.clinic_id = c.id);

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
