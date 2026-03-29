-- Modelo: clínica → profissionais + pacientes → agendamentos (por profissional)
--
-- ORDEM: 1) Execute ESTE ficheiro completo (Run). 2) Só depois execute seed.sql para dados de teste.
-- Erro "relation clinics does not exist" no INSERT = ainda não correu este schema.
--
-- Supabase: SQL Editor → New query → colar tudo → Run

-- Extensões úteis
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Clínicas (cada consultório)
-- ---------------------------------------------------------------------------
create table public.clinics (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique, -- opcional: identificador em URLs / webhook
  phone text,
  timezone text not null default 'America/Sao_Paulo',
  agent_instructions text, -- configuração do Agente IA em JSON
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Pacientes (por clínica; telefone costuma ser a chave prática no WhatsApp)
-- ---------------------------------------------------------------------------
create table public.patients (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  phone text not null, -- E.164 quando possível: +5511999990000
  name text,
  email text,
  created_at timestamptz not null default now(),
  unique (clinic_id, phone)
);

create index idx_patients_clinic_phone on public.patients (clinic_id, phone);

-- ---------------------------------------------------------------------------
-- Profissionais (médico, dentista, esteticista, etc.) — por clínica
-- ---------------------------------------------------------------------------
create table public.professionals (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null,
  specialty text, -- opcional: Ortodontia, Harmonização, etc.
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_professionals_clinic on public.professionals (clinic_id);
create index idx_professionals_clinic_active on public.professionals (clinic_id) where is_active = true;

alter table public.professionals
  add column if not exists auth_user_id uuid unique references auth.users (id);

create index if not exists idx_professionals_auth_user
  on public.professionals (auth_user_id)
  where auth_user_id is not null;

-- ---------------------------------------------------------------------------
-- Agendamentos
-- ---------------------------------------------------------------------------
create type public.appointment_status as enum (
  'scheduled',
  'cancelled',
  'completed'
);

create table public.appointments (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete restrict,
  patient_id uuid not null references public.patients (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  service_name text,
  status public.appointment_status not null default 'scheduled',
  source text default 'whatsapp', -- whatsapp, site, telefone, etc.
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_appointment_time check (ends_at > starts_at)
);

create index idx_appointments_clinic_starts on public.appointments (clinic_id, starts_at);
create index idx_appointments_clinic_status on public.appointments (clinic_id, status);
create index idx_appointments_professional_starts on public.appointments (professional_id, starts_at);

-- Garante que o profissional pertence à mesma clínica do agendamento
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

create trigger trg_appointments_professional_clinic
  before insert or update of clinic_id, professional_id on public.appointments
  for each row execute function public.enforce_appointment_professional_clinic();

-- Evita sobreposição no mesmo profissional (outros profissionais podem atender no mesmo horário)
create extension if not exists btree_gist;

-- Sobreposição só no mesmo profissional: dois profissionais diferentes podem
-- ter consultas ao mesmo tempo na mesma clínica.
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status = 'scheduled');

-- Atualiza updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_appointments_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Opcional: vincular clínica ao usuário dono (login na página)
-- Adicione depois que usar Supabase Auth; preencha owner_id manualmente ou via app
-- ---------------------------------------------------------------------------
alter table public.clinics
  add column if not exists owner_id uuid references auth.users (id);

-- ---------------------------------------------------------------------------
-- RLS (Row Level Security) — dono vê só a própria clínica
-- Ajuste se usar service_role no n8n (service_role ignora RLS por padrão)
-- ---------------------------------------------------------------------------
alter table public.clinics enable row level security;
alter table public.professionals enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;

-- Dono autenticado: clínica onde é owner
create policy "owners_read_own_clinic"
  on public.clinics for select
  using (auth.uid() = owner_id);

create policy "owners_update_own_clinic"
  on public.clinics for update
  using (auth.uid() = owner_id);

-- Dono cria a primeira clínica (cadastro na app / onboarding)
create policy "owners_insert_own_clinic"
  on public.clinics for insert
  with check (auth.uid() = owner_id);

-- Profissionais da clínica do dono (leitura + CRUD no painel)
create policy "owners_manage_professionals"
  on public.professionals for all
  using (
    exists (
      select 1 from public.clinics c
      where c.id = professionals.clinic_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.clinics c
      where c.id = professionals.clinic_id and c.owner_id = auth.uid()
    )
  );

-- Pacientes da clínica do dono
create policy "owners_read_patients"
  on public.patients for select
  using (
    exists (
      select 1 from public.clinics c
      where c.id = patients.clinic_id and c.owner_id = auth.uid()
    )
  );

-- Agendamentos da clínica do dono
create policy "owners_read_appointments"
  on public.appointments for select
  using (
    exists (
      select 1 from public.clinics c
      where c.id = appointments.clinic_id and c.owner_id = auth.uid()
    )
  );

-- Dono: criar paciente e agendamento a partir do painel Next.js
create policy "owners_insert_patients"
  on public.patients for insert
  with check (
    exists (
      select 1 from public.clinics c
      where c.id = clinic_id and c.owner_id = auth.uid()
    )
  );

create policy "owners_update_patients"
  on public.patients for update
  using (
    exists (
      select 1 from public.clinics c
      where c.id = patients.clinic_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.clinics c
      where c.id = patients.clinic_id and c.owner_id = auth.uid()
    )
  );

create policy "owners_insert_appointments"
  on public.appointments for insert
  with check (
    exists (
      select 1 from public.clinics c
      where c.id = clinic_id and c.owner_id = auth.uid()
    )
  );

-- Dono: confirmar (atualizar) ou cancelar agendamento no painel
create policy "owners_update_appointments"
  on public.appointments for update
  using (
    exists (
      select 1 from public.clinics c
      where c.id = appointments.clinic_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.clinics c
      where c.id = appointments.clinic_id and c.owner_id = auth.uid()
    )
  );

-- Profissional com login: vê só a sua agenda (leitura)
create policy "professionals_read_self"
  on public.professionals for select
  using (auth_user_id = auth.uid());

create policy "professionals_read_own_clinic"
  on public.clinics for select
  using (
    exists (
      select 1 from public.professionals p
      where p.clinic_id = clinics.id and p.auth_user_id = auth.uid()
    )
  );

create policy "professionals_read_own_appointments"
  on public.appointments for select
  using (
    exists (
      select 1 from public.professionals p
      where p.id = appointments.professional_id and p.auth_user_id = auth.uid()
    )
  );

create policy "professionals_read_patients_own_appointments"
  on public.patients for select
  using (
    exists (
      select 1 from public.appointments a
      join public.professionals p on p.id = a.professional_id
      where a.patient_id = patients.id and p.auth_user_id = auth.uid()
    )
  );

-- n8n com anon key: normalmente você NÃO expõe insert direto ao cliente;
-- use Edge Function ou n8n com service_role só no servidor.
-- Políticas de insert/update/delete para anon podem ficar desabilitadas ou via RPC segura.

comment on table public.clinics is 'Consultório / clínica';
comment on table public.professionals is 'Profissionais que atendem na clínica; agendamento sempre vinculado a um';
comment on table public.patients is 'Paciente por clínica; telefone único por clínica';
comment on table public.appointments is 'Consulta/atendimento com profissional; overlap só no mesmo professional_id';
