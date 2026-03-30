-- Grelha: cada bloco em clinics.agenda_visible_hours deve nascer DISPONÍVEL (true).
-- Antes: um CASE de "horário comercial" punha disponivel = false na maior parte das horas → UI mostrava BLOQUEADO indevidamente.
create or replace function public.painel_cs_ensure_slots_grid (
  p_clinic_id uuid,
  p_data date,
  p_hora_inicio int default 6,
  p_hora_fim int default 22
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours int[];
begin
  if not public.rls_is_clinic_owner (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(c.agenda_visible_hours, array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[])
  into v_hours
  from public.clinics c
  where c.id = p_clinic_id;

  if v_hours is null or cardinality(v_hours) = 0 then
    v_hours := array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[];
  end if;

  insert into public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel)
  select
    p.id,
    p_data,
    make_time(s.h::int, 0, 0),
    true
  from public.cs_profissionais p
  cross join lateral unnest(v_hours) as s(h)
  where p.ativo = true
    and (p.clinic_id is null or p.clinic_id = p_clinic_id)
    and s.h between 6 and 22
  on conflict (profissional_id, data, horario) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;
