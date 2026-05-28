-- Lembretes automáticos da clínica (consulta + inteligente) — runtime.
-- A UI (clinic-profile-panel.tsx → aba Lembretes) já grava em
--   clinics.agent_instructions->>'lembrete_antecedencia_minutos'
--   clinics.agent_instructions->>'lembrete_mensagem'
--   clinics.agent_instructions->>'lembrete_sugestoes_inteligentes'
-- Este migration adiciona:
--   1. Tabela cs_lembretes_enviados (idempotência + throttle)
--   2. Helper _clinic_aberta_agora (respeita agenda_visible_hours / sabado_*)
--   3. RPC n8n_cs_lembretes_consulta_pendentes  (cron 15 min)
--   4. RPC n8n_cs_lembretes_consulta_marcar_enviado
--   5. RPC n8n_cs_lembretes_inteligentes_candidatos (cron diário)
--   6. RPC n8n_cs_lembretes_inteligentes_marcar
-- Tenant-safe: tudo filtra por clinic_id; nenhum hardcode.

-- ============================================================
-- 1. Tabela de idempotência
-- ============================================================
create table if not exists public.cs_lembretes_enviados (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  tipo              text not null check (tipo in ('consulta','inteligente')),
  cs_agendamento_id uuid null references public.cs_agendamentos(id) on delete cascade,
  cs_cliente_id     uuid not null references public.cs_clientes(id) on delete cascade,
  regra_hash        text null,
  mensagem          text not null,
  enviado_at        timestamptz not null default now()
);

create unique index if not exists ux_cs_lembretes_consulta
  on public.cs_lembretes_enviados (clinic_id, cs_agendamento_id)
  where tipo = 'consulta';

create index if not exists ix_cs_lembretes_inteligente_cliente
  on public.cs_lembretes_enviados (clinic_id, cs_cliente_id, enviado_at desc)
  where tipo = 'inteligente';

alter table public.cs_lembretes_enviados enable row level security;
-- Sem policies: só service_role (n8n via REST) escreve/lê. Painel não consome.

-- ============================================================
-- 2. Helper: clínica aberta agora?
-- ============================================================
create or replace function public._clinic_aberta_agora(p_clinic_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now_br timestamp;
  v_dow    int;   -- 0=domingo, 6=sábado (postgres extract dow)
  v_hour   int;
  v_clinic record;
  v_hours  int[];
begin
  v_now_br := (now() at time zone 'America/Sao_Paulo');
  v_dow    := extract(dow from v_now_br)::int;
  v_hour   := extract(hour from v_now_br)::int;

  select agenda_visible_hours, sabado_aberto, sabado_agenda_hours
    into v_clinic
    from public.clinics
   where id = p_clinic_id;

  if not found then
    return false;
  end if;

  -- Domingo sempre fechado
  if v_dow = 0 then
    return false;
  end if;

  if v_dow = 6 then
    if coalesce(v_clinic.sabado_aberto, false) = false then
      return false;
    end if;
    v_hours := coalesce(v_clinic.sabado_agenda_hours, v_clinic.agenda_visible_hours);
  else
    v_hours := v_clinic.agenda_visible_hours;
  end if;

  if v_hours is null or array_length(v_hours, 1) is null then
    return false;
  end if;

  return v_hour = any(v_hours);
end;
$$;

grant execute on function public._clinic_aberta_agora(uuid) to authenticated, anon, service_role;

-- ============================================================
-- 3. RPC: lembretes de consulta pendentes (cron 15 min)
-- ============================================================
create or replace function public.n8n_cs_lembretes_consulta_pendentes()
returns table (
  clinic_id          uuid,
  instance_name      text,
  cs_agendamento_id  uuid,
  cs_cliente_id      uuid,
  telefone           text,
  nome_cliente       text,
  data_br            text,
  hora_br            text,
  nome_profissional  text,
  nome_procedimento  text,
  mensagem_template  text
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select
      c.id                              as clinic_id,
      c.instancia_evolution             as instance_name,
      nullif((c.agent_instructions::jsonb->>'lembrete_antecedencia_minutos'),'')::int as antecedencia,
      coalesce(
        nullif(c.agent_instructions::jsonb->>'lembrete_mensagem',''),
        'Olá, {{nome}}! Lembramos que você tem uma consulta agendada para *{{data}}* às *{{hora}}*. Não se atrase! 😊 Caso precise remarcar, é só nos avisar.'
      )                                  as mensagem_template
    from public.clinics c
    where coalesce(c.agente_ativo, true) = true
      and (c.agent_instructions::jsonb->>'lembrete_antecedencia_minutos') is not null
      and (c.agent_instructions::jsonb->>'lembrete_antecedencia_minutos') <> ''
      and c.instancia_evolution is not null
      and public._clinic_aberta_agora(c.id) = true
  )
  select
    cfg.clinic_id,
    cfg.instance_name,
    a.id                                              as cs_agendamento_id,
    cl.id                                             as cs_cliente_id,
    regexp_replace(coalesce(cl.telefone,''), '\D', '', 'g') as telefone,
    coalesce(nullif(a.nome_cliente,''), cl.nome)      as nome_cliente,
    to_char(a.data_agendamento, 'DD/MM/YYYY')         as data_br,
    to_char(a.horario, 'HH24:MI')                     as hora_br,
    a.nome_profissional,
    a.nome_procedimento,
    cfg.mensagem_template
  from cfg
  join public.cs_agendamentos a
    on a.clinic_id = cfg.clinic_id
   and a.status = 'confirmado'
  join public.cs_clientes cl
    on cl.id = a.cliente_id
   and cl.clinic_id = cfg.clinic_id
   and coalesce(cl.bot_ativo, true) = true
   and regexp_replace(coalesce(cl.telefone,''), '\D', '', 'g') <> ''
  where
    -- alvo de envio em SP: (data + hora) - antecedencia, comparado ao now() em SP
    -- (data+hora) interpretado como hora SP → timestamptz; compara com now() (timestamptz)
    (((a.data_agendamento + a.horario) at time zone 'America/Sao_Paulo')
       - make_interval(mins => cfg.antecedencia))
      <= now()
    and (((a.data_agendamento + a.horario) at time zone 'America/Sao_Paulo')
       - make_interval(mins => cfg.antecedencia))
      > now() - interval '20 minutes'
    and not exists (
      select 1 from public.cs_lembretes_enviados le
       where le.tipo = 'consulta'
         and le.clinic_id = cfg.clinic_id
         and le.cs_agendamento_id = a.id
    );
$$;

grant execute on function public.n8n_cs_lembretes_consulta_pendentes() to authenticated, anon, service_role;

-- ============================================================
-- 4. RPC: marcar consulta enviada
-- ============================================================
create or replace function public.n8n_cs_lembretes_consulta_marcar_enviado(
  p_clinic_id         uuid,
  p_cs_agendamento_id uuid,
  p_cs_cliente_id     uuid,
  p_mensagem          text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cs_lembretes_enviados (clinic_id, tipo, cs_agendamento_id, cs_cliente_id, mensagem)
  values (p_clinic_id, 'consulta', p_cs_agendamento_id, p_cs_cliente_id, p_mensagem)
  on conflict do nothing;
  return true;
end;
$$;

grant execute on function public.n8n_cs_lembretes_consulta_marcar_enviado(uuid, uuid, uuid, text) to authenticated, anon, service_role;

-- ============================================================
-- 5. RPC: candidatos a lembrete inteligente (cron diário)
-- ============================================================
create or replace function public.n8n_cs_lembretes_inteligentes_candidatos()
returns table (
  clinic_id     uuid,
  instance_name text,
  clinic_name   text,
  nome_agente   text,
  regras        text,
  regra_hash    text,
  pacientes     jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select
      c.id                                                       as clinic_id,
      c.instancia_evolution                                      as instance_name,
      c.name                                                     as clinic_name,
      coalesce(nullif(c.agent_instructions::jsonb->>'nome_agente',''), 'assistente') as nome_agente,
      trim(c.agent_instructions::jsonb->>'lembrete_sugestoes_inteligentes')          as regras
    from public.clinics c
    where coalesce(c.agente_ativo, true) = true
      and c.instancia_evolution is not null
      and coalesce(trim(c.agent_instructions::jsonb->>'lembrete_sugestoes_inteligentes'),'') <> ''
      and public._clinic_aberta_agora(c.id) = true
  ),
  pacientes_por_clinica as (
    select
      cfg.clinic_id,
      jsonb_agg(
        jsonb_build_object(
          'cs_cliente_id', cl.id,
          'telefone',      regexp_replace(cl.telefone, '\D', '', 'g'),
          'nome',          cl.nome,
          'historico',     coalesce((
            select jsonb_agg(
                     jsonb_build_object(
                       'data',          to_char(h.data_agendamento, 'YYYY-MM-DD'),
                       'procedimento',  h.nome_procedimento,
                       'profissional',  h.nome_profissional
                     )
                     order by h.data_agendamento desc
                   )
              from (
                select a.data_agendamento, a.nome_procedimento, a.nome_profissional
                  from public.cs_agendamentos a
                 where a.clinic_id = cfg.clinic_id
                   and a.cliente_id = cl.id
                   and a.status = 'concluido'
                 order by a.data_agendamento desc
                 limit 5
              ) h
          ), '[]'::jsonb)
        )
      ) as pacientes
    from cfg
    join public.cs_clientes cl
      on cl.clinic_id = cfg.clinic_id
     and coalesce(cl.bot_ativo, true) = true
     and coalesce(cl.nome,'') <> ''
     and regexp_replace(coalesce(cl.telefone,''), '\D', '', 'g') <> ''
     and not exists (
       select 1 from public.cs_lembretes_enviados le
        where le.tipo = 'inteligente'
          and le.clinic_id = cfg.clinic_id
          and le.cs_cliente_id = cl.id
          and le.enviado_at > now() - interval '30 days'
     )
     -- Só faz sentido considerar pacientes com pelo menos 1 atendimento concluído
     and exists (
       select 1 from public.cs_agendamentos a
        where a.clinic_id = cfg.clinic_id
          and a.cliente_id = cl.id
          and a.status = 'concluido'
     )
    group by cfg.clinic_id
  )
  select
    cfg.clinic_id,
    cfg.instance_name,
    cfg.clinic_name,
    cfg.nome_agente,
    cfg.regras,
    md5(cfg.regras)                          as regra_hash,
    coalesce(p.pacientes, '[]'::jsonb)       as pacientes
  from cfg
  left join pacientes_por_clinica p on p.clinic_id = cfg.clinic_id
  where coalesce(jsonb_array_length(p.pacientes), 0) > 0;
$$;

grant execute on function public.n8n_cs_lembretes_inteligentes_candidatos() to authenticated, anon, service_role;

-- ============================================================
-- 6. RPC: marcar lembrete inteligente enviado (com throttle por clínica/dia)
-- ============================================================
create or replace function public.n8n_cs_lembretes_inteligentes_marcar(
  p_clinic_id     uuid,
  p_cs_cliente_id uuid,
  p_regra_hash    text,
  p_mensagem      text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count_dia int;
  v_count_recente int;
begin
  -- Throttle: máx 20 lembretes inteligentes por clínica por dia
  select count(*) into v_count_dia
    from public.cs_lembretes_enviados
   where tipo = 'inteligente'
     and clinic_id = p_clinic_id
     and enviado_at >= (now() at time zone 'America/Sao_Paulo')::date;
  if v_count_dia >= 20 then
    return false;
  end if;

  -- Throttle: nada deste cliente nos últimos 30 dias
  select count(*) into v_count_recente
    from public.cs_lembretes_enviados
   where tipo = 'inteligente'
     and clinic_id = p_clinic_id
     and cs_cliente_id = p_cs_cliente_id
     and enviado_at > now() - interval '30 days';
  if v_count_recente > 0 then
    return false;
  end if;

  insert into public.cs_lembretes_enviados
    (clinic_id, tipo, cs_cliente_id, regra_hash, mensagem)
  values
    (p_clinic_id, 'inteligente', p_cs_cliente_id, p_regra_hash, p_mensagem);

  return true;
end;
$$;

grant execute on function public.n8n_cs_lembretes_inteligentes_marcar(uuid, uuid, text, text) to authenticated, anon, service_role;
