-- =============================================================================
-- Execute no SQL Editor do Supabase SE o painel não conseguir criar agendamentos
-- (erro de permissão RLS). Projetos novos: estas políticas já vêm em schema.sql.
-- Se correr isto duas vezes, o Postgres devolve erro de policy já existente.
-- =============================================================================

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
