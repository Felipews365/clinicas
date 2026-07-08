-- Prontuário eletrônico (Fase 1) — ficha clínica, evoluções/notas e anexos.
-- Isolado por clínica (clinic_id + RLS rls_has_clinic_access), ligado a patients
-- (fonte de verdade do painel). Anexos em bucket PRIVADO (dados clínicos sensíveis).

-- ---------------------------------------------------------------------------
-- 1. Ficha clínica: 1 linha por paciente (dados persistentes)
-- ---------------------------------------------------------------------------
create table if not exists public.cs_prontuario_ficha (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  alergias text,
  condicoes_cronicas text,
  medicacoes_uso text,
  tipo_sanguineo text,
  observacoes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (clinic_id, patient_id)
);
create index if not exists cs_prontuario_ficha_clinic_patient_idx
  on public.cs_prontuario_ficha (clinic_id, patient_id);

alter table public.cs_prontuario_ficha enable row level security;
drop policy if exists cs_prontuario_ficha_access on public.cs_prontuario_ficha;
create policy cs_prontuario_ficha_access on public.cs_prontuario_ficha
  for all to authenticated
  using (clinic_id is not null and rls_has_clinic_access(clinic_id))
  with check (clinic_id is not null and rls_has_clinic_access(clinic_id));

-- ---------------------------------------------------------------------------
-- 2. Registros/evoluções: linha do tempo do prontuário
-- ---------------------------------------------------------------------------
create table if not exists public.cs_prontuario_registros (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  tipo text not null default 'evolucao'
    check (tipo in ('anamnese', 'evolucao', 'atestado', 'nota')),
  titulo text,
  conteudo text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cs_prontuario_registros_clinic_patient_idx
  on public.cs_prontuario_registros (clinic_id, patient_id, created_at desc);

alter table public.cs_prontuario_registros enable row level security;
drop policy if exists cs_prontuario_registros_access on public.cs_prontuario_registros;
create policy cs_prontuario_registros_access on public.cs_prontuario_registros
  for all to authenticated
  using (clinic_id is not null and rls_has_clinic_access(clinic_id))
  with check (clinic_id is not null and rls_has_clinic_access(clinic_id));

-- ---------------------------------------------------------------------------
-- 3. Anexos: arquivos ligados ao paciente ou a um registro
-- ---------------------------------------------------------------------------
create table if not exists public.cs_prontuario_anexos (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  registro_id uuid references public.cs_prontuario_registros(id) on delete set null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists cs_prontuario_anexos_clinic_patient_idx
  on public.cs_prontuario_anexos (clinic_id, patient_id, created_at desc);

alter table public.cs_prontuario_anexos enable row level security;
drop policy if exists cs_prontuario_anexos_access on public.cs_prontuario_anexos;
create policy cs_prontuario_anexos_access on public.cs_prontuario_anexos
  for all to authenticated
  using (clinic_id is not null and rls_has_clinic_access(clinic_id))
  with check (clinic_id is not null and rls_has_clinic_access(clinic_id));

-- ---------------------------------------------------------------------------
-- 4. Storage: bucket PRIVADO para anexos. Caminho = {clinic_id}/{patient_id}/{arquivo}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'prontuario',
  'prontuario',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Leitura/escrita só para quem tem acesso à clínica do primeiro segmento do path.
drop policy if exists "prontuario_clinic_read" on storage.objects;
create policy "prontuario_clinic_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'prontuario'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  );

drop policy if exists "prontuario_clinic_insert" on storage.objects;
create policy "prontuario_clinic_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'prontuario'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  );

drop policy if exists "prontuario_clinic_update" on storage.objects;
create policy "prontuario_clinic_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'prontuario'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  )
  with check (
    bucket_id = 'prontuario'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  );

drop policy if exists "prontuario_clinic_delete" on storage.objects;
create policy "prontuario_clinic_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'prontuario'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  );

comment on table public.cs_prontuario_ficha is
  'Prontuário: ficha clínica persistente, 1 linha por paciente por clínica.';
comment on table public.cs_prontuario_registros is
  'Prontuário: evoluções/notas (linha do tempo) por paciente.';
comment on table public.cs_prontuario_anexos is
  'Prontuário: anexos no bucket privado prontuario ({clinic_id}/{patient_id}/arquivo).';
