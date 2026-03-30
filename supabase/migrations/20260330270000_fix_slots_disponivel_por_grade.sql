-- =============================================================================
-- CORREÇÃO DEFINITIVA: slots da grade da clínica = DISPONÍVEL por padrão
-- =============================================================================
-- PROBLEMA: painel_cs_slots_dia anterior lia h.disponivel direto do DB e
-- inferia indisponivel_por='medico' (BLOQUEADO) para qualquer disponivel=false,
-- mesmo sem bloqueio manual real. Isso obrigava a clínica a ativar slot a slot.
--
-- REGRA CORRETA:
--   • Slot na grade (agenda_visible_hours) → DISPONÍVEL por defeito
--   • COM CLIENTE → só com agendamento activo em cs_agendamentos
--   • BLOQUEADO → só quando bloqueio_manual = true (ação manual no painel)
--   • disponivel=false na BD sem bloqueio_manual=true é «bloqueio fantasma» → reparar
--
-- Idempotente: pode ser executada várias vezes sem efeitos secundários.
-- =============================================================================

-- 1. Garantir coluna bloqueio_manual (caso migração anterior não tenha corrido)
alter table public.cs_horarios_disponiveis
  add column if not exists bloqueio_manual boolean not null default false;

comment on column public.cs_horarios_disponiveis.bloqueio_manual is
  'True = médico bloqueou explicitamente no painel. Reservas do agente deixam bloqueio_manual=false.';

-- 2. Reparar bloqueios fantasma existentes
--    (disponivel=false mas sem bloqueio_manual=true e sem agendamento ativo)
update public.cs_horarios_disponiveis h
set
  disponivel    = true,
  bloqueio_manual = false
where coalesce(h.bloqueio_manual, false) = false
  and h.disponivel = false
  and not exists (
    select 1
    from public.cs_agendamentos a
    where a.profissional_id = h.profissional_id
      and a.data_agendamento = h.data
      and a.horario          = h.horario
      and a.status not in ('cancelado', 'concluido')
  );

-- 3. painel_cs_slots_dia — calcula status dinamicamente (nunca usa h.disponivel como proxy)
--    INNER JOIN mantido: ensure_slots_grid cria as linhas; front-end chama-o primeiro.
create or replace function public.painel_cs_slots_dia (p_clinic_id uuid, p_data date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hours int[];
begin
  if not public.rls_is_clinic_owner (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(
    c.agenda_visible_hours,
    array[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[]
  )
  into v_hours
  from public.clinics c
  where c.id = p_clinic_id;

  if v_hours is null or cardinality(v_hours) = 0 then
    v_hours := array[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[];
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'horario_id',       h.id,
          'profissional_id',  p.id,
          'profissional_nome', p.nome,
          'especialidade',    p.especialidade,
          'nome_procedimento',
            (
              select coalesce(nullif(trim(a.nome_procedimento), ''), sv.nome)::text
              from public.cs_agendamentos a
              inner join public.cs_servicos sv on sv.id = a.servico_id
              where a.profissional_id = h.profissional_id
                and a.data_agendamento = h.data
                and a.horario          = h.horario
                and a.status not in ('cancelado', 'concluido')
              limit 1
            ),
          'data',    h.data,
          'horario', to_char(h.horario, 'HH24:MI'),
          -- disponivel: calculado dinamicamente — nunca usa h.disponivel como proxy
          'disponivel',
            case
              when coalesce(h.bloqueio_manual, false) then false
              when exists (
                select 1
                from public.cs_agendamentos a
                where a.profissional_id = h.profissional_id
                  and a.data_agendamento = h.data
                  and a.horario          = h.horario
                  and a.status not in ('cancelado', 'concluido')
              ) then false
              else true
            end,
          -- indisponivel_por: só 'medico' com bloqueio_manual real, só 'cliente' com agendamento real
          'indisponivel_por',
            case
              when coalesce(h.bloqueio_manual, false) then 'medico'
              when exists (
                select 1
                from public.cs_agendamentos a
                where a.profissional_id = h.profissional_id
                  and a.data_agendamento = h.data
                  and a.horario          = h.horario
                  and a.status not in ('cancelado', 'concluido')
              ) then 'cliente'
              else null
            end,
          'bloqueio_manual', coalesce(h.bloqueio_manual, false)
        )
        order by p.nome asc, h.horario asc
      )
      from public.cs_horarios_disponiveis h
      inner join public.cs_profissionais p on p.id = h.profissional_id
      where h.data = p_data
        and p.ativo = true
        and (p.clinic_id is null or p.clinic_id = p_clinic_id)
        and extract(hour from h.horario)::integer = any (v_hours)
    ),
    '[]'::jsonb
  );
end;
$$;

-- 4. painel_cs_set_slot_disponivel — bloqueia com bloqueio_manual=true, liberta com false
create or replace function public.painel_cs_set_slot_disponivel (
  p_clinic_id  uuid,
  p_horario_id uuid,
  p_disponivel boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok    boolean;
  v_hour  int;
  v_hours int[];
begin
  if not public.rls_is_clinic_owner (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(
    c.agenda_visible_hours,
    array[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[]
  )
  into v_hours
  from public.clinics c
  where c.id = p_clinic_id;

  select extract(hour from h.horario)::integer
  into v_hour
  from public.cs_horarios_disponiveis h
  where h.id = p_horario_id;

  if v_hour is null or not (v_hour = any (v_hours)) then
    return jsonb_build_object(
      'ok',      false,
      'error',   'hour_not_in_clinic_agenda',
      'message', 'Este horário não está habilitado na configuração global da clínica (6h–22h).'
    );
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
  set
    disponivel      = p_disponivel,
    bloqueio_manual = case when p_disponivel then false else true end
  where id = p_horario_id;

  return jsonb_build_object('ok', true, 'disponivel', p_disponivel);
end;
$$;

-- 5. painel_cs_ensure_slots_grid — cria linhas em falta E repara bloqueios fantasma do dia
create or replace function public.painel_cs_ensure_slots_grid (
  p_clinic_id  uuid,
  p_data       date,
  p_hora_inicio int default 6,
  p_hora_fim   int default 22
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

  select coalesce(
    c.agenda_visible_hours,
    array[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[]
  )
  into v_hours
  from public.clinics c
  where c.id = p_clinic_id;

  if v_hours is null or cardinality(v_hours) = 0 then
    v_hours := array[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::integer[];
  end if;

  -- 5a. Inserir linhas em falta (novos horários adicionados à grade)
  insert into public.cs_horarios_disponiveis
    (profissional_id, data, horario, disponivel, bloqueio_manual)
  select
    p.id,
    p_data,
    make_time(s.h::int, 0, 0),
    true,
    false
  from public.cs_profissionais p
  cross join lateral unnest(v_hours) as s(h)
  where p.ativo = true
    and (p.clinic_id is null or p.clinic_id = p_clinic_id)
    and s.h between 6 and 22
  on conflict (profissional_id, data, horario) do nothing;

  -- 5b. Reparar bloqueios fantasma do dia:
  --     disponivel=false sem bloqueio_manual=true e sem agendamento ativo
  --     → restaurar para disponivel=true (grade da clínica é a fonte oficial)
  update public.cs_horarios_disponiveis h
  set
    disponivel      = true,
    bloqueio_manual = false
  from public.cs_profissionais p
  where h.profissional_id = p.id
    and h.data = p_data
    and p.ativo = true
    and (p.clinic_id is null or p.clinic_id = p_clinic_id)
    and coalesce(h.bloqueio_manual, false) = false
    and h.disponivel = false
    and not exists (
      select 1
      from public.cs_agendamentos a
      where a.profissional_id = h.profissional_id
        and a.data_agendamento = h.data
        and a.horario          = h.horario
        and a.status not in ('cancelado', 'concluido')
    );

  return jsonb_build_object('ok', true);
end;
$$;

-- 6. Grants (idempotentes)
revoke all on function public.painel_cs_slots_dia (uuid, date) from public;
grant execute on function public.painel_cs_slots_dia (uuid, date) to authenticated;
grant execute on function public.painel_cs_slots_dia (uuid, date) to service_role;

revoke all on function public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) from public;
grant execute on function public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) to authenticated;
grant execute on function public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) to service_role;

revoke all on function public.painel_cs_ensure_slots_grid (uuid, date, int, int) from public;
grant execute on function public.painel_cs_ensure_slots_grid (uuid, date, int, int) to authenticated;
grant execute on function public.painel_cs_ensure_slots_grid (uuid, date, int, int) to service_role;
