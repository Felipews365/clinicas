-- =============================================================================
-- Corrige: infinite recursion detected in policy for relation "clinics"
--
-- Causa: policies em clinics referenciam professionals e vice-versa com EXISTS
-- sobre tabelas com RLS, entrando em ciclo.
--
-- Solução: funções SECURITY DEFINER que leem as tabelas com privilégios do dono
-- da função (bypass RLS) só para o EXISTS interno.
--
-- Executa uma vez no SQL Editor do Supabase (pode repetir; idempotente).
-- Doc: https://supabase.com/docs/guides/database/postgres/row-level-security#policies-with-security-definer-functions
-- =============================================================================

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

-- Professionals: já não consulta clinics dentro da policy (evita ciclo)
drop policy if exists "owners_manage_professionals" on public.professionals;
create policy "owners_manage_professionals" on public.professionals for all
  using (public.rls_is_clinic_owner(professionals.clinic_id))
  with check (public.rls_is_clinic_owner(professionals.clinic_id));

-- Clinics: profissional vê a clínica onde trabalha (função bypass no professionals)
drop policy if exists "professionals_read_own_clinic" on public.clinics;
create policy "professionals_read_own_clinic" on public.clinics for select
  using (public.rls_professional_at_clinic(clinics.id));

-- Dono: substituir EXISTS em clinics por função (consistência e menos surprises)
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
