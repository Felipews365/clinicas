-- Procedimentos que cada profissional realiza (filtra «Tipo de consulta» no agendamento do painel).

create table if not exists public.professional_procedures (
  professional_id uuid not null references public.professionals (id) on delete cascade,
  clinic_procedure_id uuid not null references public.clinic_procedures (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (professional_id, clinic_procedure_id)
);

create index if not exists idx_professional_procedures_procedure
  on public.professional_procedures (clinic_procedure_id);

create or replace function public.professional_procedures_same_clinic ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pc uuid;
  cc uuid;
begin
  select p.clinic_id into pc from public.professionals p where p.id = new.professional_id;
  select c.clinic_id into cc from public.clinic_procedures c where c.id = new.clinic_procedure_id;
  if pc is null or cc is null or pc is distinct from cc then
    raise exception 'professional_procedures: profissional e procedimento devem ser da mesma clínica';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_professional_procedures_same_clinic on public.professional_procedures;
create trigger tr_professional_procedures_same_clinic
  before insert or update on public.professional_procedures
  for each row execute function public.professional_procedures_same_clinic ();

alter table public.professional_procedures enable row level security;

drop policy if exists "owners_manage_professional_procedures" on public.professional_procedures;
create policy "owners_manage_professional_procedures" on public.professional_procedures
  for all
  using (
    exists (
      select 1
      from public.professionals p
      where p.id = professional_procedures.professional_id
        and public.rls_has_clinic_access (p.clinic_id)
    )
  )
  with check (
    exists (
      select 1
      from public.professionals p
      where p.id = professional_procedures.professional_id
        and public.rls_has_clinic_access (p.clinic_id)
    )
  );

drop policy if exists "professionals_read_professional_procedures" on public.professional_procedures;
create policy "professionals_read_professional_procedures" on public.professional_procedures
  for select
  using (
    exists (
      select 1
      from public.professionals p
      where p.id = professional_procedures.professional_id
        and public.rls_professional_at_clinic (p.clinic_id)
    )
  );

comment on table public.professional_procedures is
  'Junção N:N entre profissionais do painel e linhas de clinic_procedures; vazio = no agendamento listam-se todos os procedimentos ativos da clínica.';
