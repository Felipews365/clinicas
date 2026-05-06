-- Resolve a clínica do utilizador autenticado (dono → clinic_members → professionals.auth_user_id).
-- SECURITY DEFINER + filtros por auth.uid(): evita falhas quando políticas RLS não alinham com
-- encadeamento de SELECTs no cliente (ex.: painel após login).

create or replace function public.get_primary_clinic_for_user()
returns table (
  id uuid,
  name text,
  agente_ativo boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    return;
  end if;

  return query
  select c.id, c.name, c.agente_ativo
  from public.clinics c
  where c.owner_id = uid
  limit 1;
  if found then
    return;
  end if;

  return query
  select c.id, c.name, c.agente_ativo
  from public.clinic_members m
  inner join public.clinics c on c.id = m.clinic_id
  where m.user_id = uid
  limit 1;
  if found then
    return;
  end if;

  return query
  select c.id, c.name, c.agente_ativo
  from public.professionals p
  inner join public.clinics c on c.id = p.clinic_id
  where p.auth_user_id = uid
  limit 1;
  return;
end;
$$;

comment on function public.get_primary_clinic_for_user() is
  'Uma linha com a clínica principal do auth.uid() (dono, membro ou profissional com login).';

revoke all on function public.get_primary_clinic_for_user() from public;
grant execute on function public.get_primary_clinic_for_user() to authenticated;

-- Inclui profissionais com login em rls_has_clinic_access (alinhado com professionals_read_own_clinic).
create or replace function public.rls_has_clinic_access(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.rls_is_clinic_owner(p_clinic_id)
    or exists (
      select 1
      from public.clinic_members m
      where m.clinic_id = p_clinic_id
        and m.user_id = (select auth.uid())
    )
    or public.rls_professional_at_clinic(p_clinic_id);
$$;
