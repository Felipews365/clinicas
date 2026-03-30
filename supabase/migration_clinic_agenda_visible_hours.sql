-- Horários globalmente visíveis na agenda (6h–22h, blocos de 1h).
-- A clínica define quais horas existem no sistema; médicos/agente só usam esse subconjunto.
-- Executar no SQL Editor do Supabase após existir public.clinics.
-- Com Supabase CLI / historial: ver supabase/migrations/20260330164048_* e 20260330164351_* (mesmo conteúdo agregado aqui).

alter table public.clinics
  add column if not exists agenda_visible_hours integer[]
  not null default array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[];

comment on column public.clinics.agenda_visible_hours is
  'Horas cheias (6–22) que a clínica permite mostrar na agenda e nas grelhas; fora disto = não listado.';

-- Garante array não vazio em linhas antigas
update public.clinics
set agenda_visible_hours = array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
where agenda_visible_hours is null
   or cardinality(agenda_visible_hours) = 0;

-- Substitui painel_cs_slots_dia: filtra por horas habilitadas pela clínica
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
            'disponivel', h.disponivel,
            'indisponivel_por',
              case
                when h.disponivel then null
                when exists (
                  select 1
                  from public.cs_agendamentos a
                  where a.profissional_id = h.profissional_id
                    and a.data_agendamento = h.data
                    and a.horario = h.horario
                    and a.status not in ('cancelado', 'concluido')
                )
                  then 'cliente'
                else 'medico'
              end
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

-- Profissional só altera vagas em horas permitidas pela clínica dona do painel
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
  set disponivel = p_disponivel
  where id = p_horario_id;

  return jsonb_build_object('ok', true, 'disponivel', p_disponivel);
end;
$$;

-- Grelha: só cria linhas para horas em clinics.agenda_visible_hours (6–22)
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
  v_dow int;
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

  v_dow := extract(dow from p_data)::int;

  insert into public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel)
  select
    p.id,
    p_data,
    make_time(s.h::int, 0, 0),
    case
      when v_dow = 6 then s.h in (8, 9, 10, 11)
      else s.h in (8, 9, 10, 11, 14, 15, 16, 17)
    end
  from public.cs_profissionais p
  cross join lateral unnest(v_hours) as s(h)
  where p.ativo = true
    and (p.clinic_id is null or p.clinic_id = p_clinic_id)
    and s.h between 6 and 22
  on conflict (profissional_id, data, horario) do nothing;

  return jsonb_build_object('ok', true);
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

-- Também atualize no projeto: supabase/n8n_cs_agendar_respeita_disponivel.sql (função n8n_cs_agendar com o mesmo filtro de clínica).
