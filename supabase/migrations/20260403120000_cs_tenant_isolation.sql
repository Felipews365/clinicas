-- =============================================================================
-- Isolamento multi-tenant: CS (n8n) + RLS
-- - clinic_id em cs_agendamentos / cs_clientes / cs_servicos + backfill
-- - RPCs painel: filtram por profissional.clinic_id / agendamento.clinic_id
-- - Slots: só profissionais com clinic_id = p_clinic_id (sem "null = todas")
-- - RLS em cs_* para utilizadores authenticated (service_role ignora RLS)
-- Requer: public.clinics, rls_has_clinic_access (migração clinic_members)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fase 1: colunas tenant em tabelas CS
-- ---------------------------------------------------------------------------
alter table public.cs_agendamentos
  add column if not exists clinic_id uuid references public.clinics (id) on delete set null;

create index if not exists idx_cs_agendamentos_clinic_id
  on public.cs_agendamentos (clinic_id)
  where clinic_id is not null;

alter table public.cs_clientes
  add column if not exists clinic_id uuid references public.clinics (id) on delete set null;

create index if not exists idx_cs_clientes_clinic_id
  on public.cs_clientes (clinic_id)
  where clinic_id is not null;

alter table public.cs_servicos
  add column if not exists clinic_id uuid references public.clinics (id) on delete set null;

create index if not exists idx_cs_servicos_clinic_id
  on public.cs_servicos (clinic_id)
  where clinic_id is not null;

-- Backfill agendamentos ← profissional
update public.cs_agendamentos a
set
  clinic_id = p.clinic_id
from
  public.cs_profissionais p
where
  a.profissional_id = p.id
  and p.clinic_id is not null
  and a.clinic_id is distinct from p.clinic_id;

-- Backfill clientes ← agendamentos
update public.cs_clientes c
set
  clinic_id = sub.clinic_id
from
  (
    select
      a.cliente_id,
      min (p.clinic_id) as clinic_id
    from
      public.cs_agendamentos a
      inner join public.cs_profissionais p on p.id = a.profissional_id
    where
      p.clinic_id is not null
    group by
      a.cliente_id
  ) sub
where
  c.id = sub.cliente_id
  and c.clinic_id is distinct from sub.clinic_id;

-- Backfill serviços ← agendamentos (um serviço pode ficar só na 1.ª clínica que o usou)
update public.cs_servicos s
set
  clinic_id = q.clinic_id
from
  (
    select distinct on (a.servico_id)
      a.servico_id,
      coalesce (a.clinic_id, p.clinic_id) as clinic_id
    from
      public.cs_agendamentos a
      inner join public.cs_profissionais p on p.id = a.profissional_id
    where
      coalesce (a.clinic_id, p.clinic_id) is not null
    order by
      a.servico_id,
      a.created_at desc nulls last
  ) q
where
  s.id = q.servico_id
  and s.clinic_id is null;

-- Telefone único por clínica (remover unique global se existir)
alter table public.cs_clientes
  drop constraint if exists cs_clientes_telefone_key;

drop index if exists cs_clientes_telefone_key;

create unique index if not exists cs_clientes_clinic_telefone_uniq
  on public.cs_clientes (clinic_id, telefone)
  where
    clinic_id is not null;

comment on column public.cs_agendamentos.clinic_id is 'Tenant (clínica); espelha cs_profissionais.clinic_id.';
comment on column public.cs_clientes.clinic_id is 'Tenant (clínica); clientes por clínica.';
comment on column public.cs_servicos.clinic_id is 'Tenant (clínica); catálogo por clínica.';

-- ---------------------------------------------------------------------------
-- Fase 0: RPCs lista / confirma / cancela CS
-- ---------------------------------------------------------------------------
create or replace function public.painel_list_cs_agendamentos (p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text;
begin
  if not public.rls_has_clinic_access (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select c.timezone into tz from public.clinics c where c.id = p_clinic_id;
  tz := coalesce(nullif(trim(tz), ''), 'America/Sao_Paulo');

  return coalesce(
    (
      select jsonb_agg(obj order by sort_ts)
      from (
        select
          jsonb_build_object(
            'id', 'cs:' || a.id::text,
            'starts_at', to_jsonb (
              ((a.data_agendamento + a.horario)::timestamp at time zone tz)
            ),
            'ends_at', to_jsonb (
              ((a.data_agendamento + a.horario)::timestamp at time zone tz)
              + make_interval(mins => coalesce(s.duracao_minutos, 60))
            ),
            'service_name',
              nullif(
                trim(
                  coalesce(a.nome_procedimento, s.nome)
                ),
                ''
              ),
            'status',
              case a.status
                when 'cancelado' then 'cancelled'
                when 'concluido' then 'completed'
                else 'scheduled'
              end,
            'source', case
              when coalesce(a.painel_confirmado, false) then 'painel'
              else 'whatsapp'
            end,
            'notes', nullif(trim(a.observacoes), ''),
            'patients', jsonb_build_object(
              'name', nullif(trim(coalesce(a.nome_cliente, c.nome)), ''),
              'phone', c.telefone
            ),
            'professionals', jsonb_build_object(
              'id', pr_panel.id,
              'name', coalesce(nullif(trim(a.nome_profissional), ''), p.nome),
              'specialty', coalesce(pr_panel.specialty, p.especialidade),
              'panel_color', pr_panel.panel_color,
              'avatar_path', pr_panel.avatar_path,
              'avatar_emoji', pr_panel.avatar_emoji
            )
          ) as obj,
          ((a.data_agendamento + a.horario)::timestamp at time zone tz) as sort_ts
        from public.cs_agendamentos a
        inner join public.cs_clientes c on c.id = a.cliente_id
        inner join public.cs_profissionais p on p.id = a.profissional_id
        left join public.cs_servicos s on s.id = a.servico_id
        left join public.professionals pr_panel
          on pr_panel.clinic_id = p_clinic_id
          and (
            pr_panel.cs_profissional_id = p.id
            or pr_panel.id = p.id
          )
        where
          p.clinic_id = p_clinic_id
          and coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
      ) sub
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.painel_confirm_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if not public.rls_has_clinic_access (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.cs_agendamentos a
  set
    painel_confirmado = true
  from
    public.cs_profissionais p
  where
    a.id = p_cs_agendamento_id
    and p.id = a.profissional_id
    and p.clinic_id = p_clinic_id
    and coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
    and a.status not in ('cancelado', 'concluido');

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_final');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.painel_cancel_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_slot uuid;
begin
  if not public.rls_has_clinic_access (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    a.id,
    a.profissional_id,
    a.data_agendamento,
    a.horario,
    a.status
  into
    v
  from
    public.cs_agendamentos a
    inner join public.cs_profissionais p on p.id = a.profissional_id
  where
    a.id = p_cs_agendamento_id
    and p.clinic_id = p_clinic_id
    and coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
  for update of cs_agendamentos;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v.status = 'cancelado' then
    return jsonb_build_object('ok', false, 'error', 'already_cancelled');
  end if;

  select
    h.id into v_slot
  from
    public.cs_horarios_disponiveis h
  where
    h.profissional_id = v.profissional_id
    and h.data = v.data_agendamento
    and h.horario = v.horario
  for update;

  if found then
    update public.cs_horarios_disponiveis
    set
      disponivel = true
    where
      id = v_slot;
  end if;

  update public.cs_agendamentos
  set
    status = 'cancelado',
    motivo_cancelamento = coalesce(motivo_cancelamento, 'Cancelado pelo painel'),
    atualizado_em = now()
  where
    id = v.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.painel_list_cs_agendamentos (uuid) from public;
grant execute on function public.painel_list_cs_agendamentos (uuid) to authenticated;
grant execute on function public.painel_list_cs_agendamentos (uuid) to service_role;

revoke all on function public.painel_confirm_cs_agendamento (uuid, uuid) from public;
grant execute on function public.painel_confirm_cs_agendamento (uuid, uuid) to authenticated;
grant execute on function public.painel_confirm_cs_agendamento (uuid, uuid) to service_role;

revoke all on function public.painel_cancel_cs_agendamento (uuid, uuid) from public;
grant execute on function public.painel_cancel_cs_agendamento (uuid, uuid) to authenticated;
grant execute on function public.painel_cancel_cs_agendamento (uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Slots: tenant estrito (sem profissionais orphan no painel)
-- ---------------------------------------------------------------------------
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
  if not public.rls_has_clinic_access (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    coalesce(
      c.agenda_visible_hours,
      array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
    )
  into
    v_hours
  from
    public.clinics c
  where
    c.id = p_clinic_id;

  if v_hours is null or cardinality (v_hours) = 0 then
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
            'nome_procedimento', (
              select
                coalesce(nullif(trim (a.nome_procedimento), ''), sv.nome)::text
              from
                public.cs_agendamentos a
                inner join public.cs_servicos sv on sv.id = a.servico_id
              where
                a.profissional_id = h.profissional_id
                and a.data_agendamento = h.data
                and a.horario = h.horario
                and a.status not in ('cancelado', 'concluido')
                and coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
              limit
                1
            ),
            'data', h.data,
            'horario', to_char (h.horario, 'HH24:MI'),
            'disponivel', case
              when coalesce (h.bloqueio_manual, false) then false
              when exists (
                select
                  1
                from
                  public.cs_agendamentos a
                where
                  a.profissional_id = h.profissional_id
                  and a.data_agendamento = h.data
                  and a.horario = h.horario
                  and a.status not in ('cancelado', 'concluido')
                  and coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
              ) then false
              else true
            end,
            'indisponivel_por', case
              when coalesce (h.bloqueio_manual, false) then 'medico'
              when exists (
                select
                  1
                from
                  public.cs_agendamentos a
                where
                  a.profissional_id = h.profissional_id
                  and a.data_agendamento = h.data
                  and a.horario = h.horario
                  and a.status not in ('cancelado', 'concluido')
                  and coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
              ) then 'cliente'
              else null
            end,
            'bloqueio_manual', coalesce (h.bloqueio_manual, false)
          )
          order by
            p.nome asc,
            h.horario asc
        )
      from
        public.cs_horarios_disponiveis h
        inner join public.cs_profissionais p on p.id = h.profissional_id
      where
        h.data = p_data
        and p.ativo = true
        and p.clinic_id = p_clinic_id
        and extract (hour from h.horario)::integer = any (v_hours)
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
  if not public.rls_has_clinic_access (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    coalesce(
      c.agenda_visible_hours,
      array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
    )
  into
    v_hours
  from
    public.clinics c
  where
    c.id = p_clinic_id;

  select
    extract (hour from h.horario)::integer
  into
    v_hour
  from
    public.cs_horarios_disponiveis h
  where
    h.id = p_horario_id;

  if v_hour is null or not (v_hour = any (v_hours)) then
    return jsonb_build_object(
      'ok', false,
      'error', 'hour_not_in_clinic_agenda',
      'message', 'Este horário não está habilitado na configuração global da clínica (6h–22h).'
    );
  end if;

  select
    true
  into
    v_ok
  from
    public.cs_horarios_disponiveis h
    inner join public.cs_profissionais p on p.id = h.profissional_id
  where
    h.id = p_horario_id
    and p.ativo = true
    and p.clinic_id = p_clinic_id
  limit
    1;

  if v_ok is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'slot_not_found_or_forbidden');
  end if;

  update public.cs_horarios_disponiveis
  set
    disponivel = p_disponivel,
    bloqueio_manual = case
      when p_disponivel then false
      else true
    end
  where
    id = p_horario_id;

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
  if not public.rls_has_clinic_access (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    coalesce(
      c.agenda_visible_hours,
      array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
    )
  into
    v_hours
  from
    public.clinics c
  where
    c.id = p_clinic_id;

  if v_hours is null or cardinality (v_hours) = 0 then
    v_hours := array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[];
  end if;

  insert into public.cs_horarios_disponiveis (
    profissional_id,
    data,
    horario,
    disponivel,
    bloqueio_manual
  )
  select
    p.id,
    p_data,
    make_time (s.h::int, 0, 0),
    true,
    false
  from
    public.cs_profissionais p
    cross join lateral unnest (v_hours) as s (h)
  where
    p.ativo = true
    and p.clinic_id = p_clinic_id
    and s.h between 6 and 22
  on conflict (profissional_id, data, horario) do nothing;

  update public.cs_horarios_disponiveis h
  set
    disponivel = true,
    bloqueio_manual = false
  from
    public.cs_profissionais p
  where
    h.profissional_id = p.id
    and h.data = p_data
    and p.ativo = true
    and p.clinic_id = p_clinic_id
    and coalesce (h.bloqueio_manual, false) = false
    and h.disponivel = false
    and not exists (
      select
        1
      from
        public.cs_agendamentos a
      where
        a.profissional_id = h.profissional_id
        and a.data_agendamento = h.data
        and a.horario = h.horario
        and a.status not in ('cancelado', 'concluido')
        and coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
    );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.painel_cs_slots_dia (uuid, date) from public;
grant execute on function public.painel_cs_slots_dia (uuid, date) to authenticated;
grant execute on function public.painel_cs_slots_dia (uuid, date) to service_role;

revoke all on function public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) from public;
grant execute on function public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) to authenticated;
grant execute on function public.painel_cs_set_slot_disponivel (uuid, uuid, boolean) to service_role;

revoke all on function public.painel_cs_ensure_slots_grid (uuid, date, int, int) from public;
grant execute on function public.painel_cs_ensure_slots_grid (uuid, date, int, int) to authenticated;
grant execute on function public.painel_cs_ensure_slots_grid (uuid, date, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Fase 2: RLS nas tabelas CS (authenticated; service_role bypass)
-- ---------------------------------------------------------------------------
alter table public.cs_agendamentos enable row level security;
alter table public.cs_clientes enable row level security;
alter table public.cs_profissionais enable row level security;
alter table public.cs_servicos enable row level security;
alter table public.cs_horarios_disponiveis enable row level security;

drop policy if exists cs_agendamentos_access on public.cs_agendamentos;
create policy cs_agendamentos_access on public.cs_agendamentos for all to authenticated using (
  clinic_id is not null
  and public.rls_has_clinic_access (clinic_id)
)
with check (
  clinic_id is not null
  and public.rls_has_clinic_access (clinic_id)
);

drop policy if exists cs_clientes_access on public.cs_clientes;
create policy cs_clientes_access on public.cs_clientes for all to authenticated using (
  clinic_id is not null
  and public.rls_has_clinic_access (clinic_id)
)
with check (
  clinic_id is not null
  and public.rls_has_clinic_access (clinic_id)
);

drop policy if exists cs_profissionais_access on public.cs_profissionais;
create policy cs_profissionais_access on public.cs_profissionais for all to authenticated using (
  clinic_id is not null
  and public.rls_has_clinic_access (clinic_id)
)
with check (
  clinic_id is not null
  and public.rls_has_clinic_access (clinic_id)
);

drop policy if exists cs_servicos_access on public.cs_servicos;
create policy cs_servicos_access on public.cs_servicos for all to authenticated using (
  clinic_id is not null
  and public.rls_has_clinic_access (clinic_id)
)
with check (
  clinic_id is not null
  and public.rls_has_clinic_access (clinic_id)
);

drop policy if exists cs_horarios_read on public.cs_horarios_disponiveis;
create policy cs_horarios_read on public.cs_horarios_disponiveis for select to authenticated using (
  exists (
    select
      1
    from
      public.cs_profissionais p
    where
      p.id = cs_horarios_disponiveis.profissional_id
      and p.clinic_id is not null
      and public.rls_has_clinic_access (p.clinic_id)
  )
);

drop policy if exists cs_horarios_write on public.cs_horarios_disponiveis;
create policy cs_horarios_write on public.cs_horarios_disponiveis for insert to authenticated with check (
  exists (
    select
      1
    from
      public.cs_profissionais p
    where
      p.id = cs_horarios_disponiveis.profissional_id
      and p.clinic_id is not null
      and public.rls_has_clinic_access (p.clinic_id)
  )
);

drop policy if exists cs_horarios_update on public.cs_horarios_disponiveis;
create policy cs_horarios_update on public.cs_horarios_disponiveis for update to authenticated using (
  exists (
    select
      1
    from
      public.cs_profissionais p
    where
      p.id = cs_horarios_disponiveis.profissional_id
      and p.clinic_id is not null
      and public.rls_has_clinic_access (p.clinic_id)
  )
)
with check (
  exists (
    select
      1
    from
      public.cs_profissionais p
    where
      p.id = cs_horarios_disponiveis.profissional_id
      and p.clinic_id is not null
      and public.rls_has_clinic_access (p.clinic_id)
  )
);

drop policy if exists cs_horarios_delete on public.cs_horarios_disponiveis;
create policy cs_horarios_delete on public.cs_horarios_disponiveis for delete to authenticated using (
  exists (
    select
      1
    from
      public.cs_profissionais p
    where
      p.id = cs_horarios_disponiveis.profissional_id
      and p.clinic_id is not null
      and public.rls_has_clinic_access (p.clinic_id)
  )
);

-- ---------------------------------------------------------------------------
-- n8n: preencher clinic_id em escritas (coerente com o profissional)
-- ---------------------------------------------------------------------------
create or replace function public.n8n_cs_agendar (
  p_nome_cliente text,
  p_telefone text,
  p_profissional_id uuid,
  p_servico_id uuid,
  p_data date,
  p_horario time,
  p_observacoes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_ag_id uuid;
  v_updated int;
  v_nome_prof text;
  v_nome_serv text;
  v_nome_cli text;
  v_clinic_id uuid;
begin
  v_nome_cli := trim(p_nome_cliente);

  select
    p.nome,
    p.clinic_id
  into
    v_nome_prof,
    v_clinic_id
  from
    public.cs_profissionais p
  where
    p.id = p_profissional_id;

  select
    s.nome
  into
    v_nome_serv
  from
    public.cs_servicos s
  where
    s.id = p_servico_id;

  if v_nome_prof is null then
    raise exception 'profissional_id inválido: %', p_profissional_id;
  end if;
  if v_clinic_id is null then
    raise exception 'profissional sem clinic_id (associar à clínica antes de agendar)';
  end if;
  if v_nome_serv is null then
    raise exception 'servico_id inválido: %', p_servico_id;
  end if;

  update public.cs_horarios_disponiveis
  set
    disponivel = false
  where
    profissional_id = p_profissional_id
    and data = p_data
    and horario = p_horario
    and disponivel = true;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'horario_indisponivel',
      'message', 'Este horário não está disponível (ocupado ou inexistente na agenda). Use novamente a consulta de vagas.'
    );
  end if;

  insert into public.cs_clientes (nome, telefone, clinic_id)
  values (v_nome_cli, p_telefone, v_clinic_id)
  on conflict (clinic_id, telefone) where clinic_id is not null
  do update
    set
      nome = excluded.nome,
      updated_at = now()
  returning id into v_cliente_id;

  insert into public.cs_agendamentos (
    cliente_id,
    profissional_id,
    servico_id,
    data_agendamento,
    horario,
    status,
    observacoes,
    nome_cliente,
    nome_profissional,
    nome_procedimento,
    clinic_id
  )
  values (
    v_cliente_id,
    p_profissional_id,
    p_servico_id,
    p_data,
    p_horario,
    'confirmado',
    coalesce(nullif(trim(p_observacoes), ''), ''),
    v_nome_cli,
    v_nome_prof,
    v_nome_serv,
    v_clinic_id
  )
  returning id into v_ag_id;

  return jsonb_build_object(
    'ok', true,
    'agendamento_id', v_ag_id,
    'cliente_id', v_cliente_id
  );
end;
$$;

create or replace function public.n8n_cs_reagendar (
  p_agendamento_id uuid,
  p_nova_data date,
  p_novo_horario time,
  p_novo_profissional_id uuid,
  p_profissional_antigo_id uuid,
  p_data_antiga date,
  p_horario_antigo time
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome_prof text;
  v_same_slot boolean;
  v_booked int;
  v_clinic_id uuid;
begin
  select
    p.nome,
    p.clinic_id
  into
    v_nome_prof,
    v_clinic_id
  from
    public.cs_profissionais p
  where
    p.id = p_novo_profissional_id;

  if v_nome_prof is null then
    raise exception 'p_novo_profissional_id inválido: %', p_novo_profissional_id;
  end if;
  if v_clinic_id is null then
    raise exception 'profissional sem clinic_id (associar à clínica antes de reagendar)';
  end if;

  v_same_slot :=
    p_novo_profissional_id = p_profissional_antigo_id
    and p_nova_data = p_data_antiga
    and p_novo_horario = p_horario_antigo;

  if v_same_slot then
    update public.cs_agendamentos
    set
      clinic_id = coalesce (clinic_id, v_clinic_id),
      atualizado_em = now()
    where
      id = p_agendamento_id;

    return jsonb_build_object('ok', true, 'agendamento_id', p_agendamento_id);
  end if;

  update public.cs_horarios_disponiveis
  set
    disponivel = false
  where
    profissional_id = p_novo_profissional_id
    and data = p_nova_data
    and horario = p_novo_horario
    and disponivel = true;

  get diagnostics v_booked = row_count;
  if v_booked = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'horario_indisponivel',
      'message', 'O novo horário não está disponível. Consulte as vagas antes de reagendar.'
    );
  end if;

  update public.cs_horarios_disponiveis
  set
    disponivel = true
  where
    profissional_id = p_profissional_antigo_id
    and data = p_data_antiga
    and horario = p_horario_antigo;

  update public.cs_agendamentos
  set
    data_agendamento = p_nova_data,
    horario = p_novo_horario,
    profissional_id = p_novo_profissional_id,
    nome_profissional = v_nome_prof,
    status = 'reagendado',
    clinic_id = v_clinic_id,
    atualizado_em = now()
  where
    id = p_agendamento_id;

  return jsonb_build_object('ok', true, 'agendamento_id', p_agendamento_id);
end;
$$;
