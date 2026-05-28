-- Lembretes inteligentes por procedimento + lembrete genérico de «saudades».
--
-- O que muda:
-- 1. `clinic_procedures.reminder_months smallint NULL` — meses após o último agendamento
--    concluído desse procedimento para acionar lembrete. NULL = sem lembrete para esse
--    procedimento.
-- 2. `clinics.agent_instructions->>'lembrete_saudades_meses'` (string) — usado pelo RPC.
--    NULL/0 = desliga o lembrete genérico. UI grava no JSON em clinic-profile-panel.
-- 3. RPC `n8n_cs_lembretes_inteligentes_candidatos` reescrita: por paciente examina
--    o ÚLTIMO agendamento concluído; se o procedimento tiver `reminder_months` e
--    bater, gera lembrete tipo "procedimento"; senão, se passou `lembrete_saudades_meses`
--    sem visita, gera tipo "saudades". Procedimento-específico tem prioridade.

alter table public.clinic_procedures
  add column if not exists reminder_months smallint null
    check (reminder_months is null or (reminder_months between 1 and 120));

comment on column public.clinic_procedures.reminder_months is
  'Meses após o último agendamento concluído deste procedimento para o agente proactivo enviar lembrete via WhatsApp. NULL = não envia.';

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
      coalesce(trim(c.agent_instructions::jsonb->>'lembrete_sugestoes_inteligentes'),'') as regras,
      nullif(c.agent_instructions::jsonb->>'lembrete_saudades_meses','')::int          as saudades_meses
    from public.clinics c
    where coalesce(c.agente_ativo, true) = true
      and c.instancia_evolution is not null
      and public._clinic_aberta_agora(c.id) = true
  ),
  -- último agendamento concluído por paciente
  ultimo as (
    select distinct on (a.clinic_id, a.cliente_id)
      a.clinic_id,
      a.cliente_id,
      a.data_agendamento,
      a.nome_procedimento,
      a.nome_profissional
    from public.cs_agendamentos a
    where a.status = 'concluido'
    order by a.clinic_id, a.cliente_id, a.data_agendamento desc
  ),
  -- avalia regra por paciente
  avaliacao as (
    select
      cfg.clinic_id,
      cfg.instance_name,
      cfg.clinic_name,
      cfg.nome_agente,
      cfg.regras,
      cfg.saudades_meses,
      cl.id            as cs_cliente_id,
      cl.nome          as nome,
      regexp_replace(cl.telefone, '\D', '', 'g') as telefone,
      u.data_agendamento,
      u.nome_procedimento,
      u.nome_profissional,
      cp.reminder_months,
      -- meses cheios decorridos desde a última visita (data SP)
      extract(year from age((now() at time zone 'America/Sao_Paulo')::date, u.data_agendamento))::int * 12
        + extract(month from age((now() at time zone 'America/Sao_Paulo')::date, u.data_agendamento))::int
        as meses_desde
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
    join ultimo u
      on u.clinic_id = cfg.clinic_id
     and u.cliente_id = cl.id
    left join public.clinic_procedures cp
      on cp.clinic_id = cfg.clinic_id
     and lower(btrim(cp.name)) = lower(btrim(u.nome_procedimento))
  ),
  -- decide tipo e filtra
  decidido as (
    select
      a.*,
      case
        when a.reminder_months is not null and a.meses_desde >= a.reminder_months then 'procedimento'
        when a.saudades_meses is not null and a.saudades_meses > 0
             and a.meses_desde >= a.saudades_meses then 'saudades'
        else null
      end as tipo_lembrete
    from avaliacao a
  ),
  pacientes_por_clinica as (
    select
      d.clinic_id,
      jsonb_agg(
        jsonb_build_object(
          'cs_cliente_id',    d.cs_cliente_id,
          'telefone',         d.telefone,
          'nome',             d.nome,
          'tipo_lembrete',    d.tipo_lembrete,
          'ultimo_procedimento', d.nome_procedimento,
          'ultimo_profissional', d.nome_profissional,
          'ultima_data',      to_char(d.data_agendamento, 'YYYY-MM-DD'),
          'meses_desde',      d.meses_desde
        )
      ) as pacientes
    from decidido d
    where d.tipo_lembrete is not null
    group by d.clinic_id
  )
  select
    cfg.clinic_id,
    cfg.instance_name,
    cfg.clinic_name,
    cfg.nome_agente,
    cfg.regras,
    md5(cfg.regras || '|' || coalesce(cfg.saudades_meses::text,''))  as regra_hash,
    coalesce(p.pacientes, '[]'::jsonb)                                as pacientes
  from cfg
  left join pacientes_por_clinica p on p.clinic_id = cfg.clinic_id
  where coalesce(jsonb_array_length(p.pacientes), 0) > 0;
$$;

grant execute on function public.n8n_cs_lembretes_inteligentes_candidatos() to authenticated, anon, service_role;
