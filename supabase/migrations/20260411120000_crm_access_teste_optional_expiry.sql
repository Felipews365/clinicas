-- CRM no plano teste: clínica ativa; data_expiracao opcional (null = trial com acesso); se preenchida, >= hoje.
-- Alinha com plan_tem_crm (já usado no app via hasFullAccess).

create or replace function public.crm_clinic_has_access(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinics cl
    where cl.id = p_clinic_id
      and cl.ativo is true
      and (
        (
          lower(trim(cl.tipo_plano::text)) = 'teste'
          and (
            cl.data_expiracao is null
            or cl.data_expiracao >= current_date
          )
        )
        or (
          lower(trim(cl.tipo_plano::text)) = 'enterprise'
          and coalesce(cl.inadimplente, false) is false
        )
        or (
          coalesce(cl.plan_tem_crm, false) is true
          and coalesce(cl.inadimplente, false) is false
        )
      )
  );
$$;

comment on function public.crm_clinic_has_access(uuid) is
  'CRM: teste activo (data opcional ou >= hoje), enterprise sem inadimplência, ou plan_tem_crm sem inadimplência; clínica ativa.';
