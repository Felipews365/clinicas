-- Grelha por profissional/dia: cria linhas em falta em cs_horarios_disponiveis.
-- Cada bloco gerado nasce com disponivel = true; bloqueios são apenas toggles manuais ou ocupação por agendamento.

create or replace function public.painel_cs_ensure_slots_grid (
  p_clinic_id uuid,
  p_data date,
  p_hora_inicio int default 8,
  p_hora_fim int default 22
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rls_is_clinic_owner (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_hora_inicio < 0 or p_hora_fim > 23 or p_hora_inicio > p_hora_fim then
    raise exception 'invalid_hour_range' using errcode = '22003';
  end if;

  insert into public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel)
  select
    p.id,
    p_data,
    make_time(s.h::int, 0, 0),
    true
  from public.cs_profissionais p
  cross join lateral generate_series(p_hora_inicio, p_hora_fim) as s(h)
  where p.ativo = true
    and (p.clinic_id is null or p.clinic_id = p_clinic_id)
  on conflict (profissional_id, data, horario) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.painel_cs_ensure_slots_grid (uuid, date, int, int) from public;
grant execute on function public.painel_cs_ensure_slots_grid (uuid, date, int, int) to authenticated;
grant execute on function public.painel_cs_ensure_slots_grid (uuid, date, int, int) to service_role;
