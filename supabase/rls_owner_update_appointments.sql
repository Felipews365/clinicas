-- =============================================================================
-- Painel: confirmar agendamento (ex.: source) e cancelar (status). Correr uma vez
-- se já tem insert policies mas ainda não consegue UPDATE em appointments.
-- =============================================================================

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
