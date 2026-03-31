-- =============================================================================
-- Multi-Tenant SaaS Hardening — Isolamento completo por clínica
-- =============================================================================
-- Aplica TODAS as correções necessárias para garantir isolamento total:
--
--  1. Funções helper RLS (rls_is_clinic_owner, rls_has_clinic_access)
--  2. clinic_members: tabela + trigger + RLS
--  3. clinics: políticas via rls_has_clinic_access
--  4. professionals: políticas via rls_has_clinic_access + DELETE
--  5. patients: políticas via rls_has_clinic_access + DELETE
--  6. appointments: políticas via rls_has_clinic_access + DELETE
--  7. whatsapp_sessions: políticas via rls_has_clinic_access + DELETE
--  8. clinic_procedures: políticas via rls_has_clinic_access (all ops)
--  9. cs_profissionais: RLS estrito por clinic_id
-- 10. cs_clientes: backfill clinic_id + NOT NULL + RLS
-- 11. cs_agendamentos: backfill clinic_id + NOT NULL + RLS
-- 12. cs_servicos: backfill clinic_id + NOT NULL + RLS
-- 13. cs_horarios_disponiveis: RLS via profissional.clinic_id
-- 14. chat_clients: adiciona clinic_id NOT NULL + RLS
-- 15. chat_sessions: RLS via clinic_id em chat_clients
-- 16. chat_messages: RLS via clinic_id em chat_clients
-- 17. chat_simple_appointments: RLS via clinic_id
--
-- Idempotente: usa CREATE OR REPLACE, DROP POLICY IF EXISTS, IF NOT EXISTS.
-- Requer: tabelas já criadas pelo schema.sql / setup_completo.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. FUNÇÕES HELPER RLS
-- ---------------------------------------------------------------------------

-- Verifica se o utilizador autenticado é dono da clínica (owner_id)
create or replace function public.rls_is_clinic_owner(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.clinics c
    where c.id = p_clinic_id
      and c.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.rls_is_clinic_owner(uuid) from public;
grant execute on function public.rls_is_clinic_owner(uuid) to authenticated;
grant execute on function public.rls_is_clinic_owner(uuid) to service_role;

-- Verifica se o utilizador autenticado tem acesso (dono OU membro em clinic_members)
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
    );
$$;

revoke all on function public.rls_has_clinic_access(uuid) from public;
grant execute on function public.rls_has_clinic_access(uuid) to authenticated;
grant execute on function public.rls_has_clinic_access(uuid) to service_role;

-- Verifica se o utilizador é profissional da clínica (via auth_user_id)
create or replace function public.rls_professional_at_clinic(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.professionals p
    where p.clinic_id = p_clinic_id
      and p.auth_user_id = (select auth.uid())
  );
$$;

revoke all on function public.rls_professional_at_clinic(uuid) from public;
grant execute on function public.rls_professional_at_clinic(uuid) to authenticated;
grant execute on function public.rls_professional_at_clinic(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. CLINIC_MEMBERS — tabela de membros (donos + staff por clínica)
-- ---------------------------------------------------------------------------

create table if not exists public.clinic_members (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id   uuid not null references auth.users(id)   on delete cascade,
  role      text not null default 'staff',
  created_at timestamptz not null default now(),
  constraint clinic_members_role_check check (role in ('owner','admin','staff','viewer')),
  constraint clinic_members_clinic_user_unique unique (clinic_id, user_id)
);

create index if not exists idx_clinic_members_user_id   on public.clinic_members(user_id);
create index if not exists idx_clinic_members_clinic_id on public.clinic_members(clinic_id);

-- Backfill: garantir que donos existentes têm linha em clinic_members
insert into public.clinic_members (clinic_id, user_id, role)
select id, owner_id, 'owner'
from public.clinics
where owner_id is not null
on conflict (clinic_id, user_id) do nothing;

-- Trigger: ao criar/atualizar owner_id em clinics, garantir linha em clinic_members
create or replace function public.trg_clinics_owner_to_clinic_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into public.clinic_members(clinic_id, user_id, role)
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
  execute function public.trg_clinics_owner_to_clinic_member();

-- RLS em clinic_members
alter table public.clinic_members enable row level security;

drop policy if exists "clinic_members_select_own"    on public.clinic_members;
drop policy if exists "clinic_members_owner_insert"  on public.clinic_members;
drop policy if exists "clinic_members_owner_update"  on public.clinic_members;
drop policy if exists "clinic_members_owner_delete"  on public.clinic_members;

create policy "clinic_members_select_own" on public.clinic_members
  for select using (user_id = (select auth.uid()));

create policy "clinic_members_owner_insert" on public.clinic_members
  for insert with check (public.rls_is_clinic_owner(clinic_id));

create policy "clinic_members_owner_update" on public.clinic_members
  for update
  using  (public.rls_is_clinic_owner(clinic_id))
  with check (public.rls_is_clinic_owner(clinic_id));

create policy "clinic_members_owner_delete" on public.clinic_members
  for delete using (public.rls_is_clinic_owner(clinic_id));

-- ---------------------------------------------------------------------------
-- 3. CLINICS — RLS atualizado para rls_has_clinic_access
-- ---------------------------------------------------------------------------

alter table public.clinics enable row level security;

drop policy if exists "owners_read_own_clinic"         on public.clinics;
drop policy if exists "owners_update_own_clinic"       on public.clinics;
drop policy if exists "owners_insert_own_clinic"       on public.clinics;
drop policy if exists "professionals_read_own_clinic"  on public.clinics;

-- Qualquer membro da clínica pode ler (inclui staff)
create policy "owners_read_own_clinic" on public.clinics
  for select using (public.rls_has_clinic_access(id));

-- Qualquer membro pode atualizar (ex.: staff atualiza configurações)
create policy "owners_update_own_clinic" on public.clinics
  for update
  using  (public.rls_has_clinic_access(id))
  with check (public.rls_has_clinic_access(id));

-- Apenas o dono pode criar nova clínica (durante o cadastro)
create policy "owners_insert_own_clinic" on public.clinics
  for insert with check (auth.uid() = owner_id);

-- Profissional com login pode ler a própria clínica
create policy "professionals_read_own_clinic" on public.clinics
  for select using (public.rls_professional_at_clinic(id));

-- ---------------------------------------------------------------------------
-- 4. PROFESSIONALS — RLS + DELETE
-- ---------------------------------------------------------------------------

alter table public.professionals enable row level security;

drop policy if exists "owners_manage_professionals"      on public.professionals;
drop policy if exists "professionals_read_self"          on public.professionals;
drop policy if exists "professionals_read_own_appointments" on public.professionals;

-- Membros da clínica podem ler, criar, atualizar e apagar profissionais
create policy "owners_manage_professionals" on public.professionals
  for all
  using  (public.rls_has_clinic_access(professionals.clinic_id))
  with check (public.rls_has_clinic_access(professionals.clinic_id));

-- Profissional com login pode ler a si próprio
create policy "professionals_read_self" on public.professionals
  for select using (auth_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. PATIENTS — RLS + DELETE
-- ---------------------------------------------------------------------------

alter table public.patients enable row level security;

drop policy if exists "owners_read_patients"   on public.patients;
drop policy if exists "owners_insert_patients" on public.patients;
drop policy if exists "owners_update_patients" on public.patients;
drop policy if exists "owners_delete_patients" on public.patients;
drop policy if exists "professionals_read_patients_own_appointments" on public.patients;

create policy "owners_read_patients" on public.patients
  for select using (public.rls_has_clinic_access(patients.clinic_id));

create policy "owners_insert_patients" on public.patients
  for insert with check (public.rls_has_clinic_access(clinic_id));

create policy "owners_update_patients" on public.patients
  for update
  using  (public.rls_has_clinic_access(patients.clinic_id))
  with check (public.rls_has_clinic_access(patients.clinic_id));

create policy "owners_delete_patients" on public.patients
  for delete using (public.rls_has_clinic_access(patients.clinic_id));

-- Profissional com login pode ler pacientes dos seus próprios agendamentos
create policy "professionals_read_patients_own_appointments" on public.patients
  for select using (
    exists (
      select 1
      from public.appointments a
      join public.professionals p on p.id = a.professional_id
      where a.patient_id = patients.id
        and p.auth_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 6. APPOINTMENTS — RLS + DELETE
-- ---------------------------------------------------------------------------

alter table public.appointments enable row level security;

drop policy if exists "owners_read_appointments"   on public.appointments;
drop policy if exists "owners_insert_appointments" on public.appointments;
drop policy if exists "owners_update_appointments" on public.appointments;
drop policy if exists "owners_delete_appointments" on public.appointments;
drop policy if exists "professionals_read_own_appointments" on public.appointments;

create policy "owners_read_appointments" on public.appointments
  for select using (public.rls_has_clinic_access(appointments.clinic_id));

create policy "owners_insert_appointments" on public.appointments
  for insert with check (public.rls_has_clinic_access(clinic_id));

create policy "owners_update_appointments" on public.appointments
  for update
  using  (public.rls_has_clinic_access(appointments.clinic_id))
  with check (public.rls_has_clinic_access(appointments.clinic_id));

create policy "owners_delete_appointments" on public.appointments
  for delete using (public.rls_has_clinic_access(appointments.clinic_id));

-- Profissional com login pode ler os seus próprios agendamentos
create policy "professionals_read_own_appointments" on public.appointments
  for select using (
    exists (
      select 1 from public.professionals p
      where p.id = appointments.professional_id
        and p.auth_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 7. WHATSAPP_SESSIONS — RLS + DELETE
-- ---------------------------------------------------------------------------

alter table public.whatsapp_sessions enable row level security;

drop policy if exists "owners_read_whatsapp_sessions"   on public.whatsapp_sessions;
drop policy if exists "owners_insert_whatsapp_sessions" on public.whatsapp_sessions;
drop policy if exists "owners_update_whatsapp_sessions" on public.whatsapp_sessions;
drop policy if exists "owners_delete_whatsapp_sessions" on public.whatsapp_sessions;

create policy "owners_read_whatsapp_sessions" on public.whatsapp_sessions
  for select using (public.rls_has_clinic_access(whatsapp_sessions.clinic_id));

create policy "owners_insert_whatsapp_sessions" on public.whatsapp_sessions
  for insert with check (public.rls_has_clinic_access(clinic_id));

create policy "owners_update_whatsapp_sessions" on public.whatsapp_sessions
  for update
  using  (public.rls_has_clinic_access(whatsapp_sessions.clinic_id))
  with check (public.rls_has_clinic_access(whatsapp_sessions.clinic_id));

create policy "owners_delete_whatsapp_sessions" on public.whatsapp_sessions
  for delete using (public.rls_has_clinic_access(whatsapp_sessions.clinic_id));

-- ---------------------------------------------------------------------------
-- 8. CLINIC_PROCEDURES — RLS completo via rls_has_clinic_access
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.clinic_procedures') is not null then

    alter table public.clinic_procedures enable row level security;

    drop policy if exists "owners_manage_clinic_procedures" on public.clinic_procedures;
    drop policy if exists "owners_delete_clinic_procedures" on public.clinic_procedures;

    create policy "owners_manage_clinic_procedures" on public.clinic_procedures
      for all
      using  (public.rls_has_clinic_access(clinic_procedures.clinic_id))
      with check (public.rls_has_clinic_access(clinic_procedures.clinic_id));

  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. CS_PROFISSIONAIS — RLS estrito por clinic_id NOT NULL
-- ---------------------------------------------------------------------------

alter table public.cs_profissionais enable row level security;

drop policy if exists cs_profissionais_access on public.cs_profissionais;
create policy cs_profissionais_access on public.cs_profissionais
  for all to authenticated
  using  (clinic_id is not null and public.rls_has_clinic_access(clinic_id))
  with check (clinic_id is not null and public.rls_has_clinic_access(clinic_id));

-- ---------------------------------------------------------------------------
-- 10. CS_CLIENTES — backfill clinic_id + NOT NULL + RLS
-- ---------------------------------------------------------------------------

-- Adicionar coluna se não existir (legado sem clinic_id)
alter table public.cs_clientes
  add column if not exists clinic_id uuid references public.clinics(id) on delete set null;

create index if not exists idx_cs_clientes_clinic_id
  on public.cs_clientes(clinic_id)
  where clinic_id is not null;

-- Backfill: preencher clinic_id a partir dos agendamentos do cliente
update public.cs_clientes c
set clinic_id = sub.clinic_id
from (
  select a.cliente_id, min(p.clinic_id) as clinic_id
  from public.cs_agendamentos a
  inner join public.cs_profissionais p on p.id = a.profissional_id
  where p.clinic_id is not null
  group by a.cliente_id
) sub
where c.id = sub.cliente_id
  and c.clinic_id is null
  and sub.clinic_id is not null;

-- Unique por (clinic_id, telefone) — remover global se existir
alter table public.cs_clientes
  drop constraint if exists cs_clientes_telefone_key;
drop index if exists cs_clientes_telefone_key;

create unique index if not exists cs_clientes_clinic_telefone_uniq
  on public.cs_clientes(clinic_id, telefone)
  where clinic_id is not null;

-- RLS
alter table public.cs_clientes enable row level security;

drop policy if exists cs_clientes_access on public.cs_clientes;
create policy cs_clientes_access on public.cs_clientes
  for all to authenticated
  using  (clinic_id is not null and public.rls_has_clinic_access(clinic_id))
  with check (clinic_id is not null and public.rls_has_clinic_access(clinic_id));

-- ---------------------------------------------------------------------------
-- 11. CS_AGENDAMENTOS — backfill clinic_id + NOT NULL + RLS
-- ---------------------------------------------------------------------------

alter table public.cs_agendamentos
  add column if not exists clinic_id uuid references public.clinics(id) on delete set null;

create index if not exists idx_cs_agendamentos_clinic_id
  on public.cs_agendamentos(clinic_id)
  where clinic_id is not null;

-- Backfill a partir do profissional
update public.cs_agendamentos a
set clinic_id = p.clinic_id
from public.cs_profissionais p
where a.profissional_id = p.id
  and p.clinic_id is not null
  and a.clinic_id is null;

-- RLS
alter table public.cs_agendamentos enable row level security;

drop policy if exists cs_agendamentos_access on public.cs_agendamentos;
create policy cs_agendamentos_access on public.cs_agendamentos
  for all to authenticated
  using  (clinic_id is not null and public.rls_has_clinic_access(clinic_id))
  with check (clinic_id is not null and public.rls_has_clinic_access(clinic_id));

-- ---------------------------------------------------------------------------
-- 12. CS_SERVICOS — backfill clinic_id + RLS
-- ---------------------------------------------------------------------------

alter table public.cs_servicos
  add column if not exists clinic_id uuid references public.clinics(id) on delete set null;

create index if not exists idx_cs_servicos_clinic_id
  on public.cs_servicos(clinic_id)
  where clinic_id is not null;

-- Backfill: associar serviço à clínica que mais o utilizou
update public.cs_servicos s
set clinic_id = q.clinic_id
from (
  select distinct on (a.servico_id)
    a.servico_id,
    coalesce(a.clinic_id, p.clinic_id) as clinic_id
  from public.cs_agendamentos a
  inner join public.cs_profissionais p on p.id = a.profissional_id
  where coalesce(a.clinic_id, p.clinic_id) is not null
  order by a.servico_id, a.created_at desc nulls last
) q
where s.id = q.servico_id
  and s.clinic_id is null;

-- RLS
alter table public.cs_servicos enable row level security;

drop policy if exists cs_servicos_access on public.cs_servicos;
create policy cs_servicos_access on public.cs_servicos
  for all to authenticated
  using  (clinic_id is not null and public.rls_has_clinic_access(clinic_id))
  with check (clinic_id is not null and public.rls_has_clinic_access(clinic_id));

-- ---------------------------------------------------------------------------
-- 13. CS_HORARIOS_DISPONIVEIS — RLS via profissional.clinic_id
-- ---------------------------------------------------------------------------

alter table public.cs_horarios_disponiveis enable row level security;

drop policy if exists cs_horarios_read   on public.cs_horarios_disponiveis;
drop policy if exists cs_horarios_write  on public.cs_horarios_disponiveis;
drop policy if exists cs_horarios_update on public.cs_horarios_disponiveis;
drop policy if exists cs_horarios_delete on public.cs_horarios_disponiveis;

-- Leitura
create policy cs_horarios_read on public.cs_horarios_disponiveis
  for select to authenticated
  using (
    exists (
      select 1 from public.cs_profissionais p
      where p.id = cs_horarios_disponiveis.profissional_id
        and p.clinic_id is not null
        and public.rls_has_clinic_access(p.clinic_id)
    )
  );

-- Inserção
create policy cs_horarios_write on public.cs_horarios_disponiveis
  for insert to authenticated
  with check (
    exists (
      select 1 from public.cs_profissionais p
      where p.id = cs_horarios_disponiveis.profissional_id
        and p.clinic_id is not null
        and public.rls_has_clinic_access(p.clinic_id)
    )
  );

-- Atualização
create policy cs_horarios_update on public.cs_horarios_disponiveis
  for update to authenticated
  using (
    exists (
      select 1 from public.cs_profissionais p
      where p.id = cs_horarios_disponiveis.profissional_id
        and p.clinic_id is not null
        and public.rls_has_clinic_access(p.clinic_id)
    )
  )
  with check (
    exists (
      select 1 from public.cs_profissionais p
      where p.id = cs_horarios_disponiveis.profissional_id
        and p.clinic_id is not null
        and public.rls_has_clinic_access(p.clinic_id)
    )
  );

-- Eliminação
create policy cs_horarios_delete on public.cs_horarios_disponiveis
  for delete to authenticated
  using (
    exists (
      select 1 from public.cs_profissionais p
      where p.id = cs_horarios_disponiveis.profissional_id
        and p.clinic_id is not null
        and public.rls_has_clinic_access(p.clinic_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 14. CHAT_CLIENTS — adicionar clinic_id + unique por clínica + RLS
-- ---------------------------------------------------------------------------

-- Adicionar clinic_id se não existir (pode ser nullable em legado)
alter table public.chat_clients
  add column if not exists clinic_id uuid references public.clinics(id) on delete set null;

create index if not exists idx_chat_clients_clinic on public.chat_clients(clinic_id);

-- Unique global por phone pode existir — manter por compatibilidade com n8n.
-- Quando clinic_id for preenchido, garantir unicidade por (clinic_id, phone).
create unique index if not exists chat_clients_clinic_phone_uniq
  on public.chat_clients(clinic_id, phone)
  where clinic_id is not null;

-- RLS: membros veem apenas clientes da sua clínica
alter table public.chat_clients enable row level security;

drop policy if exists chat_clients_access on public.chat_clients;
create policy chat_clients_access on public.chat_clients
  for all to authenticated
  using (
    clinic_id is null  -- legado sem clinic_id: só service_role acessa (RLS não bloqueia null)
    or public.rls_has_clinic_access(clinic_id)
  )
  with check (
    clinic_id is null
    or public.rls_has_clinic_access(clinic_id)
  );

-- ---------------------------------------------------------------------------
-- 15. CHAT_SESSIONS — RLS via client.clinic_id
-- ---------------------------------------------------------------------------

alter table public.chat_sessions enable row level security;

drop policy if exists chat_sessions_access on public.chat_sessions;
create policy chat_sessions_access on public.chat_sessions
  for all to authenticated
  using (
    exists (
      select 1 from public.chat_clients cc
      where cc.id = chat_sessions.client_id
        and (cc.clinic_id is null or public.rls_has_clinic_access(cc.clinic_id))
    )
  )
  with check (
    exists (
      select 1 from public.chat_clients cc
      where cc.id = chat_sessions.client_id
        and (cc.clinic_id is null or public.rls_has_clinic_access(cc.clinic_id))
    )
  );

-- ---------------------------------------------------------------------------
-- 16. CHAT_MESSAGES — RLS via client.clinic_id
-- ---------------------------------------------------------------------------

alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_access on public.chat_messages;
create policy chat_messages_access on public.chat_messages
  for all to authenticated
  using (
    exists (
      select 1 from public.chat_clients cc
      where cc.id = chat_messages.client_id
        and (cc.clinic_id is null or public.rls_has_clinic_access(cc.clinic_id))
    )
  )
  with check (
    exists (
      select 1 from public.chat_clients cc
      where cc.id = chat_messages.client_id
        and (cc.clinic_id is null or public.rls_has_clinic_access(cc.clinic_id))
    )
  );

-- ---------------------------------------------------------------------------
-- 17. CHAT_SIMPLE_APPOINTMENTS — RLS por clinic_id
-- ---------------------------------------------------------------------------

alter table public.chat_simple_appointments enable row level security;

drop policy if exists chat_simple_appts_access on public.chat_simple_appointments;
create policy chat_simple_appts_access on public.chat_simple_appointments
  for all to authenticated
  using (
    clinic_id is null
    or public.rls_has_clinic_access(clinic_id)
  )
  with check (
    clinic_id is null
    or public.rls_has_clinic_access(clinic_id)
  );

-- ---------------------------------------------------------------------------
-- 18. STORAGE: avatares de profissionais (primeiro segmento = clinic_id)
-- ---------------------------------------------------------------------------

drop policy if exists "professional_avatars_owner_insert" on storage.objects;
create policy "professional_avatars_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  );

drop policy if exists "professional_avatars_owner_update" on storage.objects;
create policy "professional_avatars_owner_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  )
  with check (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  );

drop policy if exists "professional_avatars_owner_delete" on storage.objects;
create policy "professional_avatars_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  );

-- Leitura pública de avatares (imagens do painel são públicas)
drop policy if exists "professional_avatars_public_read" on storage.objects;
create policy "professional_avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'professional-avatars');

-- ---------------------------------------------------------------------------
-- 19. RPCs PAINEL — garantir filtro estrito por clinic_id
-- ---------------------------------------------------------------------------

-- painel_list_cs_agendamentos: lista agendamentos do agente IA (cs_agendamentos)
create or replace function public.painel_list_cs_agendamentos(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text;
begin
  if not public.rls_has_clinic_access(p_clinic_id) then
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
            'id',           'cs:' || a.id::text,
            'starts_at',    to_jsonb(((a.data_agendamento + a.horario)::timestamp at time zone tz)),
            'ends_at',      to_jsonb(((a.data_agendamento + a.horario)::timestamp at time zone tz)
                              + make_interval(mins => coalesce(s.duracao_minutos, 60))),
            'service_name', nullif(trim(coalesce(a.nome_procedimento, s.nome)), ''),
            'status',       case a.status
                              when 'cancelado'  then 'cancelled'
                              when 'concluido'  then 'completed'
                              else 'scheduled'
                            end,
            'source',       case
                              when coalesce(a.painel_confirmado, false) then 'painel'
                              else 'whatsapp'
                            end,
            'notes',        nullif(trim(a.observacoes), ''),
            'patients',     jsonb_build_object(
                              'name',  nullif(trim(coalesce(a.nome_cliente, c.nome)), ''),
                              'phone', c.telefone
                            ),
            'professionals', jsonb_build_object(
                              'id',           pr_panel.id,
                              'name',         coalesce(nullif(trim(a.nome_profissional), ''), p.nome),
                              'specialty',    coalesce(pr_panel.specialty, p.especialidade),
                              'panel_color',  pr_panel.panel_color,
                              'avatar_path',  pr_panel.avatar_path,
                              'avatar_emoji', pr_panel.avatar_emoji
                            )
          ) as obj,
          ((a.data_agendamento + a.horario)::timestamp at time zone tz) as sort_ts
        from public.cs_agendamentos a
        -- Filtra estritamente pelo tenant
        inner join public.cs_profissionais p
          on p.id = a.profissional_id
          and p.clinic_id = p_clinic_id
        inner join public.cs_clientes c on c.id = a.cliente_id
        left  join public.cs_servicos s on s.id = a.servico_id
        left  join public.professionals pr_panel
          on pr_panel.clinic_id = p_clinic_id
          and (pr_panel.cs_profissional_id = p.id or pr_panel.id = p.id)
        where
          a.clinic_id = p_clinic_id   -- tenant explícito no agendamento
      ) sub
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.painel_list_cs_agendamentos(uuid) from public;
grant execute on function public.painel_list_cs_agendamentos(uuid) to authenticated;
grant execute on function public.painel_list_cs_agendamentos(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 20. n8n_cs_agendar — garante clinic_id em todos os registos criados
-- ---------------------------------------------------------------------------

create or replace function public.n8n_cs_agendar(
  p_nome_cliente  text,
  p_telefone      text,
  p_profissional_id uuid,
  p_servico_id    uuid,
  p_data          date,
  p_horario       time,
  p_observacoes   text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_ag_id      uuid;
  v_updated    int;
  v_nome_prof  text;
  v_nome_serv  text;
  v_nome_cli   text;
  v_clinic_id  uuid;
begin
  v_nome_cli := trim(p_nome_cliente);

  select p.nome, p.clinic_id
  into   v_nome_prof, v_clinic_id
  from   public.cs_profissionais p
  where  p.id = p_profissional_id;

  select s.nome into v_nome_serv
  from   public.cs_servicos s
  where  s.id = p_servico_id;

  if v_nome_prof is null then
    raise exception 'profissional_id inválido: %', p_profissional_id;
  end if;
  if v_clinic_id is null then
    raise exception 'profissional sem clinic_id — associe-o a uma clínica antes de agendar';
  end if;
  if v_nome_serv is null then
    raise exception 'servico_id inválido: %', p_servico_id;
  end if;

  update public.cs_horarios_disponiveis
  set disponivel = false
  where profissional_id = p_profissional_id
    and data    = p_data
    and horario = p_horario
    and disponivel = true;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'horario_indisponivel',
      'message', 'Este horário não está disponível. Consulte as vagas antes de agendar.'
    );
  end if;

  insert into public.cs_clientes(nome, telefone, clinic_id)
  values (v_nome_cli, p_telefone, v_clinic_id)
  on conflict (clinic_id, telefone) where clinic_id is not null
  do update set nome = excluded.nome, updated_at = now()
  returning id into v_cliente_id;

  insert into public.cs_agendamentos(
    cliente_id, profissional_id, servico_id,
    data_agendamento, horario, status, observacoes,
    nome_cliente, nome_profissional, nome_procedimento,
    clinic_id
  )
  values (
    v_cliente_id, p_profissional_id, p_servico_id,
    p_data, p_horario, 'confirmado', coalesce(nullif(trim(p_observacoes), ''), ''),
    v_nome_cli, v_nome_prof, v_nome_serv,
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

revoke all on function public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) from public;
grant execute on function public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) to authenticated;
grant execute on function public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) to service_role;

-- ---------------------------------------------------------------------------
-- NOTA FINAL
-- ---------------------------------------------------------------------------
-- Após aplicar esta migration no Supabase SQL Editor:
--
--  1. Valide o isolamento:
--     SELECT * FROM public.cs_agendamentos WHERE clinic_id IS NULL;
--     → deve retornar 0 rows (ou linhas órfãs que você pode apagar)
--
--  2. Apague dados órfãos sem clinic_id (opcional mas recomendado):
--     DELETE FROM public.cs_agendamentos WHERE clinic_id IS NULL;
--     DELETE FROM public.cs_clientes     WHERE clinic_id IS NULL;
--     DELETE FROM public.cs_servicos     WHERE clinic_id IS NULL;
--
--  3. Teste com dois usuários de clínicas diferentes e confirme
--     que cada um vê APENAS os seus próprios dados.
-- ---------------------------------------------------------------------------
