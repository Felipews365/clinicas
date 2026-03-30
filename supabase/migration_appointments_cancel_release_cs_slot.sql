-- Ao cancelar agendamento no painel (public.appointments → status cancelled),
-- torna a vaga correspondente disponível de novo em cs_horarios_disponiveis para o agente n8n.
-- Também cobre cancelamentos em cs_agendamentos feitos fora do RPC painel_cancel_cs_agendamento.
--
-- Correr no SQL Editor do Supabase após existirem professionals, appointments, cs_*.
-- Mapeamento painel ↔ agente:
--   1) professionals.cs_profissional_id (opcional, mais fiável)
--   2) mesmo UUID em professionals.id e cs_profissionais.id
--   3) um único cs_profissional com o mesmo nome (lower trim) e clinic_id igual OU clinic_id nulo (legado)

alter table public.professionals
  add column if not exists cs_profissional_id uuid
  references public.cs_profissionais (id) on delete set null;

create index if not exists idx_professionals_cs_profissional_id
  on public.professionals (cs_profissional_id)
  where cs_profissional_id is not null;

comment on column public.professionals.cs_profissional_id is
  'Opcional: liga o profissional do painel ao registo em cs_profissionais usado pelo agente WhatsApp/n8n.';

-- Resolve um UUID de cs_profissionais a partir de public.professionals.
create or replace function public.painel_resolve_cs_profissional_id (
  p_clinic_id uuid,
  p_professional_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid;
  v_n text;
  v_ids uuid[];
begin
  select pr.cs_profissional_id into v
  from public.professionals pr
  where pr.id = p_professional_id
    and pr.clinic_id = p_clinic_id;

  if v is not null then
    return v;
  end if;

  if exists (select 1 from public.cs_profissionais cp where cp.id = p_professional_id) then
    return p_professional_id;
  end if;

  select trim(pr.name) into v_n
  from public.professionals pr
  where pr.id = p_professional_id
    and pr.clinic_id = p_clinic_id;

  if v_n is null or v_n = '' then
    return null;
  end if;

  select array_agg(cp.id order by cp.id) into v_ids
  from public.cs_profissionais cp
  where lower(cp.nome) = lower(v_n)
    and (cp.clinic_id = p_clinic_id or cp.clinic_id is null);

  if v_ids is null or array_length(v_ids, 1) is distinct from 1 then
    return null;
  end if;

  return v_ids[1];
end;
$$;

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

drop trigger if exists trg_appointments_cancel_release_cs_slot on public.appointments;

create trigger trg_appointments_cancel_release_cs_slot
  after update of status on public.appointments
  for each row
  execute function public.appointments_cancel_release_cs_slot();

-- Segurança: cancelamento em cs_agendamentos por qualquer caminho liberta o horário.
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

drop trigger if exists trg_cs_agendamentos_cancel_release_cs_slot on public.cs_agendamentos;

create trigger trg_cs_agendamentos_cancel_release_cs_slot
  after update of status on public.cs_agendamentos
  for each row
  execute function public.cs_agendamentos_cancel_release_cs_slot();
