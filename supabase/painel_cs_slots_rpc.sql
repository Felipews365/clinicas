-- Painel: gerir vagas do WhatsApp/n8n (cs_horarios_disponiveis.disponivel).
-- Opcional: associar profissionais cs_* à clínica do painel (multi-clínica).
--
-- Se só tiver uma clínica, execute após aplicar:
--   update public.cs_profissionais set clinic_id = '<uuid da sua clinics>' where clinic_id is null;

alter table public.cs_profissionais
  add column if not exists clinic_id uuid references public.clinics (id) on delete set null;

create index if not exists idx_cs_profissionais_clinic_id
  on public.cs_profissionais (clinic_id)
  where clinic_id is not null;

create or replace function public.painel_cs_slots_dia (p_clinic_id uuid, p_data date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.rls_is_clinic_owner (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return coalesce(
    (
      select
        jsonb_agg(
          jsonb_build_object(
            'horario_id', h.id,
            'profissional_id', p.id,
            'profissional_nome', p.nome,
            'especialidade', p.especialidade,
            'data', h.data,
            'horario', to_char(h.horario, 'HH24:MI'),
            'disponivel', h.disponivel
          )
          order by p.nome asc, h.horario asc
        )
      from public.cs_horarios_disponiveis h
      inner join public.cs_profissionais p on p.id = h.profissional_id
      where h.data = p_data
        and p.ativo = true
        and (p.clinic_id is null or p.clinic_id = p_clinic_id)
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.painel_cs_set_slot_disponivel (
  p_clinic_id uuid,
  p_horario_id uuid,
  p_disponivel boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if not public.rls_is_clinic_owner (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select true
  into v_ok
  from public.cs_horarios_disponiveis h
  inner join public.cs_profissionais p on p.id = h.profissional_id
  where h.id = p_horario_id
    and p.ativo = true
    and (p.clinic_id is null or p.clinic_id = p_clinic_id)
  limit 1;

  if v_ok is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'slot_not_found_or_forbidden');
  end if;

  update public.cs_horarios_disponiveis
  set disponivel = p_disponivel
  where id = p_horario_id;

  return jsonb_build_object('ok', true, 'disponivel', p_disponivel);
end;
$$;

revoke all on function public.painel_cs_slots_dia (uuid, date) from public;
grant execute on function public.painel_cs_slots_dia (uuid, date) to authenticated;
grant execute on function public.painel_cs_slots_dia (uuid, date) to service_role;

revoke all on function public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) from public;
grant execute on function public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) to authenticated;
grant execute on function public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) to service_role;
