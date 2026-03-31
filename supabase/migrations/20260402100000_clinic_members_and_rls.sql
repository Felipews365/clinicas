-- ============================================================================
-- Fase 1 multi-tenant: clinic_members + rls_has_clinic_access
-- Membros têm o mesmo acesso ao painel que o dono nas políticas migradas.
-- rls_is_clinic_owner mantém o significado estrito (apenas owner_id).
-- ============================================================================

-- 1) Tabela clinic_members
create table if not exists public.clinic_members (
  id uuid primary key default gen_random_uuid (),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'staff',
  created_at timestamptz not null default now (),
  constraint clinic_members_role_check check (
    role in ('owner', 'admin', 'staff', 'viewer')
  ),
  constraint clinic_members_clinic_user_unique unique (clinic_id, user_id)
);

create index if not exists idx_clinic_members_user_id on public.clinic_members (user_id);
create index if not exists idx_clinic_members_clinic_id on public.clinic_members (clinic_id);

comment on table public.clinic_members is
  'Filieção de utilizadores Auth à clínica; RLS alinha acesso ao painel com o dono (fase 1).';

-- 2) Helper RLS: dono OU linha em clinic_members
create or replace function public.rls_has_clinic_access (p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.rls_is_clinic_owner (p_clinic_id)
    or exists (
      select 1
      from public.clinic_members m
      where m.clinic_id = p_clinic_id
        and m.user_id = (select auth.uid ())
    );
$$;

revoke all on function public.rls_has_clinic_access (uuid) from public;
grant execute on function public.rls_has_clinic_access (uuid) to authenticated;
grant execute on function public.rls_has_clinic_access (uuid) to service_role;

-- 3) Backfill: espelhar donos existentes
insert into public.clinic_members (clinic_id, user_id, role)
select id, owner_id, 'owner'
from public.clinics
where owner_id is not null
on conflict (clinic_id, user_id) do nothing;

-- 4) Trigger: garantir membro owner ao criar/atualizar clinics.owner_id
create or replace function public.trg_clinics_owner_to_clinic_member ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into public.clinic_members (clinic_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict (clinic_id, user_id) do update
      set role = excluded.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinics_owner_member on public.clinics;
create trigger trg_clinics_owner_member
  after insert or update of owner_id on public.clinics
  for each row
  when (new.owner_id is not null)
  execute function public.trg_clinics_owner_to_clinic_member ();

-- 5) RLS em clinic_members
alter table public.clinic_members enable row level security;

drop policy if exists "clinic_members_select_own" on public.clinic_members;
create policy "clinic_members_select_own" on public.clinic_members for select using (
  user_id = (select auth.uid ())
);

drop policy if exists "clinic_members_owner_insert" on public.clinic_members;
create policy "clinic_members_owner_insert" on public.clinic_members for insert
  with check (public.rls_is_clinic_owner (clinic_id));

drop policy if exists "clinic_members_owner_update" on public.clinic_members;
create policy "clinic_members_owner_update" on public.clinic_members for update
  using (public.rls_is_clinic_owner (clinic_id))
  with check (public.rls_is_clinic_owner (clinic_id));

drop policy if exists "clinic_members_owner_delete" on public.clinic_members;
create policy "clinic_members_owner_delete" on public.clinic_members for delete using (
  public.rls_is_clinic_owner (clinic_id)
);

-- 6) Políticas: clinics (painel lê/atualiza como membro)
drop policy if exists "owners_read_own_clinic" on public.clinics;
create policy "owners_read_own_clinic" on public.clinics for select using (
  public.rls_has_clinic_access (id)
);

drop policy if exists "owners_update_own_clinic" on public.clinics;
create policy "owners_update_own_clinic" on public.clinics for update
  using (public.rls_has_clinic_access (id))
  with check (public.rls_has_clinic_access (id));

-- 7) professionals, patients, appointments, whatsapp_sessions
drop policy if exists "owners_manage_professionals" on public.professionals;
create policy "owners_manage_professionals" on public.professionals for all
  using (public.rls_has_clinic_access (professionals.clinic_id))
  with check (public.rls_has_clinic_access (professionals.clinic_id));

drop policy if exists "owners_read_patients" on public.patients;
create policy "owners_read_patients" on public.patients for select
  using (public.rls_has_clinic_access (patients.clinic_id));

drop policy if exists "owners_insert_patients" on public.patients;
create policy "owners_insert_patients" on public.patients for insert
  with check (public.rls_has_clinic_access (clinic_id));

drop policy if exists "owners_update_patients" on public.patients;
create policy "owners_update_patients" on public.patients for update
  using (public.rls_has_clinic_access (patients.clinic_id))
  with check (public.rls_has_clinic_access (patients.clinic_id));

drop policy if exists "owners_read_appointments" on public.appointments;
create policy "owners_read_appointments" on public.appointments for select
  using (public.rls_has_clinic_access (appointments.clinic_id));

drop policy if exists "owners_insert_appointments" on public.appointments;
create policy "owners_insert_appointments" on public.appointments for insert
  with check (public.rls_has_clinic_access (clinic_id));

drop policy if exists "owners_update_appointments" on public.appointments;
create policy "owners_update_appointments" on public.appointments for update
  using (public.rls_has_clinic_access (appointments.clinic_id))
  with check (public.rls_has_clinic_access (appointments.clinic_id));

drop policy if exists "owners_read_whatsapp_sessions" on public.whatsapp_sessions;
create policy "owners_read_whatsapp_sessions" on public.whatsapp_sessions for select
  using (public.rls_has_clinic_access (whatsapp_sessions.clinic_id));

drop policy if exists "owners_update_whatsapp_sessions" on public.whatsapp_sessions;
create policy "owners_update_whatsapp_sessions" on public.whatsapp_sessions for update
  using (public.rls_has_clinic_access (whatsapp_sessions.clinic_id))
  with check (public.rls_has_clinic_access (whatsapp_sessions.clinic_id));

drop policy if exists "owners_insert_whatsapp_sessions" on public.whatsapp_sessions;
create policy "owners_insert_whatsapp_sessions" on public.whatsapp_sessions for insert
  with check (public.rls_has_clinic_access (clinic_id));

-- 8) clinic_procedures (opcional: só se a tabela existir)
do $$
begin
  if to_regclass ('public.clinic_procedures') is null then
    raise notice 'clinic_procedures not found; skip policies + n8n_clinic_procedimentos';
  else
    alter table public.clinic_procedures enable row level security;

    drop policy if exists "owners_manage_clinic_procedures" on public.clinic_procedures;
    create policy "owners_manage_clinic_procedures" on public.clinic_procedures for all
      using (public.rls_has_clinic_access (clinic_procedures.clinic_id))
      with check (public.rls_has_clinic_access (clinic_procedures.clinic_id));

    drop policy if exists "owners_delete_clinic_procedures" on public.clinic_procedures;
    create policy "owners_delete_clinic_procedures" on public.clinic_procedures for delete
      using (public.rls_has_clinic_access (clinic_procedures.clinic_id));

    create or replace function public.n8n_clinic_procedimentos (p_clinic_id uuid)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = public
    as $fn$
    declare
      v_role text := coalesce(auth.jwt () ->> 'role', '');
    begin
      if v_role is distinct from 'service_role'
         and not public.rls_has_clinic_access (p_clinic_id) then
        raise exception 'forbidden' using errcode = '42501';
      end if;

      return coalesce(
        (
          select
            jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'nome', p.name,
                'descricao', p.description,
                'duracao_minutos', p.duration_minutes,
                'valor_brl', p.price_brl,
                'preco_a_vista_brl', p.preco_a_vista_brl,
                'tem_desconto', p.tem_desconto,
                'desconto_percentual', p.desconto_percentual,
                'cartao_parcelas_max', p.cartao_parcelas_max
              )
              order by p.sort_order asc, p.name asc
            )
          from public.clinic_procedures p
          where p.clinic_id = p_clinic_id
            and p.is_active = true
        ),
        '[]'::jsonb
      );
    end;
    $fn$;

    revoke all on function public.n8n_clinic_procedimentos (uuid) from public;
    grant execute on function public.n8n_clinic_procedimentos (uuid) to authenticated;
    grant execute on function public.n8n_clinic_procedimentos (uuid) to service_role;
  end if;
end $$;

-- 9) Storage: avatares (primeiro segmento = clinic_id)
drop policy if exists "professional_avatars_owner_insert" on storage.objects;
create policy "professional_avatars_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access ((split_part (name, '/', 1))::uuid)
  );

drop policy if exists "professional_avatars_owner_update" on storage.objects;
create policy "professional_avatars_owner_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access ((split_part (name, '/', 1))::uuid)
  )
  with check (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access ((split_part (name, '/', 1))::uuid)
  );

drop policy if exists "professional_avatars_owner_delete" on storage.objects;
create policy "professional_avatars_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access ((split_part (name, '/', 1))::uuid)
  );

-- 10) RPCs painel (agenda CS + slots) — alinhado a migrations mais recentes
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

  select
    c.timezone into tz
  from
    public.clinics c
  where
    c.id = p_clinic_id;
  tz := coalesce(nullif(trim (tz), ''), 'America/Sao_Paulo');

  return coalesce(
    (
      select
        jsonb_agg(obj order by sort_ts)
      from
        (
          select
            jsonb_build_object(
              'id', 'cs:' || a.id::text,
              'starts_at', to_jsonb (
                (
                  (a.data_agendamento + a.horario)::timestamp at time zone tz
                )
              ),
              'ends_at', to_jsonb (
                (
                  (a.data_agendamento + a.horario)::timestamp at time zone tz
                ) + make_interval (mins => coalesce(s.duracao_minutos, 60))
              ),
              'service_name', nullif(
                trim(
                  coalesce(a.nome_procedimento, s.nome)
                ),
                ''
              ),
              'status', case a.status
                when 'cancelado' then 'cancelled'
                when 'concluido' then 'completed'
                else 'scheduled'
              end,
              'source', case
                when coalesce(a.painel_confirmado, false) then 'painel'
                else 'whatsapp'
              end,
              'notes', nullif(trim (a.observacoes), ''),
              'patients', jsonb_build_object(
                'name', nullif(trim (coalesce(a.nome_cliente, c.nome)), ''),
                'phone', c.telefone
              ),
              'professionals', jsonb_build_object(
                'id', pr_panel.id,
                'name', coalesce(nullif(trim (a.nome_profissional), ''), p.nome),
                'specialty', coalesce(pr_panel.specialty, p.especialidade),
                'panel_color', pr_panel.panel_color,
                'avatar_path', pr_panel.avatar_path,
                'avatar_emoji', pr_panel.avatar_emoji
              )
            ) as obj,
            (
              (a.data_agendamento + a.horario)::timestamp at time zone tz
            ) as sort_ts
          from
            public.cs_agendamentos a
            inner join public.cs_clientes c on c.id = a.cliente_id
            inner join public.cs_profissionais p on p.id = a.profissional_id
            left join public.cs_servicos s on s.id = a.servico_id
            left join public.professionals pr_panel on pr_panel.clinic_id = p_clinic_id
            and (
              pr_panel.cs_profissional_id = p.id
              or pr_panel.id = p.id
            )
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

  update public.cs_agendamentos
  set
    painel_confirmado = true
  where
    id = p_cs_agendamento_id
    and status not in ('cancelado', 'concluido');

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
    id,
    profissional_id,
    data_agendamento,
    horario,
    status
  into
    v
  from
    public.cs_agendamentos
  where
    id = p_cs_agendamento_id
  for update;

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
    motivo_cancelamento = coalesce(
      motivo_cancelamento,
      'Cancelado pelo painel'
    ),
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
        and (
          p.clinic_id is null
          or p.clinic_id = p_clinic_id
        )
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
    and (
      p.clinic_id is null
      or p.clinic_id = p_clinic_id
    )
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
    and (
      p.clinic_id is null
      or p.clinic_id = p_clinic_id
    )
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
    and (
      p.clinic_id is null
      or p.clinic_id = p_clinic_id
    )
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
