-- =============================================================================
-- 1) Liga utilizadores Supabase Auth a profissionais (cada médico/esteta/etc.)
-- 2) RLS: o profissional só lê a própria linha, a sua clínica, os seus
--    agendamentos e pacientes desses agendamentos.
--
-- Execute no SQL Editor depois de ter clinics / professionals / appointments.
-- Se policy já existir, apague a antiga ou ignore o erro de duplicado.
-- =============================================================================

alter table public.professionals
  add column if not exists auth_user_id uuid unique references auth.users (id);

create index if not exists idx_professionals_auth_user
  on public.professionals (auth_user_id)
  where auth_user_id is not null;

-- Profissional: ver só o seu registo
create policy "professionals_read_self"
  on public.professionals for select
  using (auth_user_id = auth.uid());

-- Profissional: ver nome da clínica (para o painel)
create policy "professionals_read_own_clinic"
  on public.clinics for select
  using (
    exists (
      select 1 from public.professionals p
      where p.clinic_id = clinics.id and p.auth_user_id = auth.uid()
    )
  );

-- Profissional: só os seus agendamentos
create policy "professionals_read_own_appointments"
  on public.appointments for select
  using (
    exists (
      select 1 from public.professionals p
      where p.id = appointments.professional_id and p.auth_user_id = auth.uid()
    )
  );

-- Profissional: pacientes que aparecem nos seus agendamentos
create policy "professionals_read_patients_own_appointments"
  on public.patients for select
  using (
    exists (
      select 1 from public.appointments a
      join public.professionals p on p.id = a.professional_id
      where a.patient_id = patients.id and p.auth_user_id = auth.uid()
    )
  );

-- =============================================================================
-- Associar conta ao profissional (exemplo — substitua os UUIDs):
-- update public.professionals
-- set auth_user_id = 'UUID-DO-USER-AUTH'
-- where id = 'UUID-DO-PROFISSIONAL';
-- =============================================================================
