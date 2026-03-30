-- Estado dos slots na grade da clínica (ag agenda_visible_hours):
--   • DISPONÍVEL por defeito (disponivel=true, bloqueio_manual=false)
--   • COM CLIENTE só com agendamento activo em cs_agendamentos
--   • BLOQUEADO só quando o painel marca bloqueio manual (bloqueio_manual=true)
--
-- Corrige dados legados onde disponivel=false existia sem agendamento nem bloqueio real.

alter table public.cs_horarios_disponiveis
  add column if not exists bloqueio_manual boolean not null default false;

comment on column public.cs_horarios_disponiveis.bloqueio_manual is
  'True = médico bloqueou explicitamente no painel «Horários que aparecem na agenda». Reservas do agente usam disponivel=false mas deixam bloqueio_manual=false.';

-- Limpar «bloqueio fantasma»: indisponível na BD sem agendamento e sem flag de bloqueio manual.
update public.cs_horarios_disponiveis h
set
  disponivel = true,
  bloqueio_manual = false
where coalesce(h.bloqueio_manual, false) = false
  and h.disponivel = false
  and not exists (
    select 1
    from public.cs_agendamentos a
    where a.profissional_id = h.profissional_id
      and a.data_agendamento = h.data
      and a.horario = h.horario
      and a.status not in ('cancelado', 'concluido')
  );

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

  select coalesce(c.agenda_visible_hours, array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[])
  into v_hours
  from public.clinics c
  where c.id = p_clinic_id;

  if v_hours is null or cardinality(v_hours) = 0 then
    v_hours := array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[];
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
            'nome_procedimento',
              (
                select coalesce(nullif(trim(a.nome_procedimento), ''), s.nome)::text
                from public.cs_agendamentos a
                inner join public.cs_servicos s on s.id = a.servico_id
                where a.profissional_id = h.profissional_id
                  and a.data_agendamento = h.data
                  and a.horario = h.horario
                  and a.status not in ('cancelado', 'concluido')
                limit 1
              ),
            'data', h.data,
            'horario', to_char(h.horario, 'HH24:MI'),
            'disponivel',
              case
                when coalesce(h.bloqueio_manual, false) then false
                when exists (
                  select 1
                  from public.cs_agendamentos a
                  where a.profissional_id = h.profissional_id
                    and a.data_agendamento = h.data
                    and a.horario = h.horario
                    and a.status not in ('cancelado', 'concluido')
                ) then false
                else true
              end,
            'indisponivel_por',
              case
                when coalesce(h.bloqueio_manual, false) then 'medico'
                when exists (
                  select 1
                  from public.cs_agendamentos a
                  where a.profissional_id = h.profissional_id
                    and a.data_agendamento = h.data
                    and a.horario = h.horario
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
  v_hour int;
  v_hours int[];
begin
  if not public.rls_is_clinic_owner (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(c.agenda_visible_hours, array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[])
  into v_hours
  from public.clinics c
  where c.id = p_clinic_id;

  select extract(hour from h.horario)::integer
  into v_hour
  from public.cs_horarios_disponiveis h
  where h.id = p_horario_id;

  if v_hour is null or not (v_hour = any (v_hours)) then
    return jsonb_build_object(
      'ok', false,
      'error',
      'hour_not_in_clinic_agenda',
      'message',
      'Este horário não está habilitado na configuração global da clínica (6h–22h).'
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
    disponivel = p_disponivel,
    bloqueio_manual = case when p_disponivel then false else true end
  where id = p_horario_id;

  return jsonb_build_object('ok', true, 'disponivel', p_disponivel);
end;
$$;

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

  insert into public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel, bloqueio_manual)
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

  return jsonb_build_object('ok', true);
end;
$$;

-- Libertar vaga: disponível de novo para o agente e tirar bloqueio manual desta célula.
create or replace function public.appointments_cancel_release_cs_slot ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text;
  v_cs uuid;
  v_date date;
  v_time time;
  local_ts timestamp;
begin
  if new.status::text is distinct from 'cancelled' then
    return new;
  end if;

  if old.status::text is not distinct from 'cancelled' then
    return new;
  end if;

  select coalesce(nullif(trim(c.timezone), ''), 'America/Sao_Paulo')
  into tz
  from public.clinics c
  where c.id = new.clinic_id;

  tz := coalesce(tz, 'America/Sao_Paulo');

  local_ts := new.starts_at at time zone tz;
  v_date := local_ts::date;
  v_time := (date_trunc('minute', local_ts))::time;

  v_cs := public.painel_resolve_cs_profissional_id(new.clinic_id, new.professional_id);

  if v_cs is null then
    return new;
  end if;

  if exists (
    select 1
    from public.cs_agendamentos a
    where a.profissional_id = v_cs
      and a.data_agendamento = v_date
      and a.horario = v_time
      and a.status not in ('cancelado', 'concluido')
  ) then
    return new;
  end if;

  update public.cs_horarios_disponiveis h
  set
    disponivel = true,
    bloqueio_manual = false
  where h.profissional_id = v_cs
    and h.data = v_date
    and h.horario = v_time;

  return new;
end;
$$;

create or replace function public.cs_agendamentos_cancel_release_cs_slot ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from 'cancelado' then
    return new;
  end if;

  if old.status is not distinct from 'cancelado' then
    return new;
  end if;

  update public.cs_horarios_disponiveis h
  set
    disponivel = true,
    bloqueio_manual = false
  where h.profissional_id = new.profissional_id
    and h.data = new.data_agendamento
    and h.horario = new.horario;

  return new;
end;
$$;

create or replace function public.n8n_cs_consultar_vagas ()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(j.slot order by j.sdata, j.shour),
    '[]'::jsonb
  )
  from (
    select
      jsonb_build_object(
        'horario_id', h.id,
        'data', to_char(h.data, 'DD/MM/YYYY'),
        'dia_semana', trim(to_char(h.data, 'Day')),
        'horario', to_char(h.horario, 'HH24:MI'),
        'profissional_id', p.id,
        'profissional', p.nome,
        'especialidade', p.especialidade,
        'disponivel', true
      ) as slot,
      h.data as sdata,
      h.horario as shour
    from cs_horarios_disponiveis h
    inner join cs_profissionais p on p.id = h.profissional_id
    left join clinics cl on cl.id = p.clinic_id
    where h.disponivel = true
      and coalesce(h.bloqueio_manual, false) = false
      and p.ativo = true
      and h.data >= current_date
      and h.data <= current_date + interval '30 days'
      and (
        cl.id is null
        or extract(hour from h.horario)::integer = any (
          coalesce(
            cl.agenda_visible_hours,
            array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
          )
        )
      )
    order by h.data asc, h.horario asc
    limit 20
  ) j;
$$;
