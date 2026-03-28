-- =============================================================================
-- Corrige: "new row violates row-level security policy for table 'clinics'"
-- ao concluir o cadastro (onboarding) na app.
--
-- No Supabase: SQL Editor → New query → colar → Run.
-- Pode executar várias vezes (idempotente).
-- =============================================================================

drop policy if exists "owners_insert_own_clinic" on public.clinics;

create policy "owners_insert_own_clinic"
  on public.clinics for insert
  with check (auth.uid() = owner_id);
