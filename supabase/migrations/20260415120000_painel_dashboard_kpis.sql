-- Agregados do dashboard do painel (multi-tenant). KPIs mensais, ocupação do dia,
-- insights, alertas e top serviços — alinhado a appointments + cs_agendamentos.

create or replace function public.painel_procedure_price (
  p_clinic_id uuid,
  p_service_name text
)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select coalesce(cp.preco_a_vista_brl, cp.price_brl, 0::numeric)
      from public.clinic_procedures cp
      where
        cp.clinic_id = p_clinic_id
        and cp.is_active is not false
        and lower(trim(cp.name)) = lower(trim(coalesce(p_service_name, '')))
      limit 1
    ),
    0::numeric
  );
$$;

create or replace function public.painel_dashboard_kpis (
  p_clinic_id uuid,
  p_month date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_ms date;
  v_pms date;
  v_next_ms date;
  v_pend date;
  v_prof_active int;
  v_clinic_ativo boolean;
  v_ia_plan boolean;
  v_rev_curr numeric := 0;
  v_rev_prev numeric := 0;
  v_rev_ap_curr numeric := 0;
  v_rev_cs_curr numeric := 0;
  v_rev_ap_prev numeric := 0;
  v_rev_cs_prev numeric := 0;
  v_new_curr int := 0;
  v_new_prev int := 0;
  v_conf_curr int := 0;
  v_tot_curr int := 0;
  v_conf_prev int := 0;
  v_tot_prev int := 0;
  v_rate_curr numeric := 0;
  v_rate_prev numeric := 0;
  v_occ_pct numeric := 0;
  v_cap_hours numeric;
  v_used_hours numeric;
  v_used_ap numeric;
  v_used_cs numeric;
  v_return_pct numeric := 0;
  v_retorno_vencido int := 0;
  v_represada numeric := 0;
  v_buracos int := 0;
  v_top jsonb;
  v_den_ret int;
  v_num_ret int;
  v_cs_rev_curr numeric;
  v_cs_conf_curr int;
  v_cs_tot_curr int;
  v_cs_rev_prev numeric;
  v_cs_conf_prev int;
  v_cs_tot_prev int;
begin
  if not public.rls_has_clinic_access(p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    coalesce(nullif(trim(c.timezone), ''), 'America/Sao_Paulo'),
    (now() at time zone coalesce(nullif(trim(c.timezone), ''), 'America/Sao_Paulo'))::date,
    coalesce(c.ativo, true),
    coalesce(pl.tem_agente_ia, false)
  into v_tz, v_today, v_clinic_ativo, v_ia_plan
  from public.clinics c
  left join public.planos pl on pl.id = c.plan_id
  where c.id = p_clinic_id;

  if v_tz is null then
    v_tz := 'America/Sao_Paulo';
  end if;

  v_ms := date_trunc('month', coalesce(p_month, v_today)::timestamp)::date;
  v_next_ms := (v_ms + interval '1 month')::date;
  v_pms := (v_ms - interval '1 month')::date;
  v_pend := v_ms;

  select count(*)::int
  into v_prof_active
  from public.professionals p
  where p.clinic_id = p_clinic_id
    and coalesce(p.is_active, true);

  -- Mês atual — appointments
  select
    coalesce(
      sum(
        public.painel_procedure_price(p_clinic_id, a.service_name)
      ) filter (
        where
          (a.status = 'scheduled' and coalesce(a.source, '') = 'painel')
          or a.status = 'completed'
      ),
      0
    ),
    count(*) filter (
      where
        a.status = 'scheduled'
        and coalesce(a.source, '') = 'painel'
    ) + count(*) filter (where a.status = 'completed'),
    count(*) filter (where a.status <> 'cancelled')
  into v_rev_ap_curr, v_conf_curr, v_tot_curr
  from public.appointments a
  where
    a.clinic_id = p_clinic_id
    and (a.starts_at at time zone v_tz)::date >= v_ms
    and (a.starts_at at time zone v_tz)::date < v_next_ms;

  select
    coalesce(
      sum(
        public.painel_procedure_price(
          p_clinic_id,
          nullif(trim(coalesce(ag.nome_procedimento, s.nome, '')), '')
        )
      ) filter (where ag.status is distinct from 'cancelado'),
      0
    ),
    count(*) filter (where ag.status is distinct from 'cancelado'),
    count(*) filter (where ag.status is distinct from 'cancelado')
  into v_cs_rev_curr, v_cs_conf_curr, v_cs_tot_curr
  from public.cs_agendamentos ag
  inner join public.cs_profissionais cp on cp.id = ag.profissional_id
    and cp.clinic_id = p_clinic_id
  left join public.cs_servicos s on s.id = ag.servico_id
  where
    ag.clinic_id = p_clinic_id
    and ag.data_agendamento >= v_ms
    and ag.data_agendamento < v_next_ms;

  v_rev_curr := coalesce(v_rev_ap_curr, 0) + coalesce(v_cs_rev_curr, 0);
  v_conf_curr := coalesce(v_conf_curr, 0) + coalesce(v_cs_conf_curr, 0);
  v_tot_curr := coalesce(v_tot_curr, 0) + coalesce(v_cs_tot_curr, 0);

  -- Mês anterior
  select
    coalesce(
      sum(
        public.painel_procedure_price(p_clinic_id, a.service_name)
      ) filter (
        where
          (a.status = 'scheduled' and coalesce(a.source, '') = 'painel')
          or a.status = 'completed'
      ),
      0
    ),
    count(*) filter (
      where
        a.status = 'scheduled'
        and coalesce(a.source, '') = 'painel'
    ) + count(*) filter (where a.status = 'completed'),
    count(*) filter (where a.status <> 'cancelled')
  into v_rev_ap_prev, v_conf_prev, v_tot_prev
  from public.appointments a
  where
    a.clinic_id = p_clinic_id
    and (a.starts_at at time zone v_tz)::date >= v_pms
    and (a.starts_at at time zone v_tz)::date < v_pend;

  select
    coalesce(
      sum(
        public.painel_procedure_price(
          p_clinic_id,
          nullif(trim(coalesce(ag.nome_procedimento, s.nome, '')), '')
        )
      ) filter (where ag.status is distinct from 'cancelado'),
      0
    ),
    count(*) filter (where ag.status is distinct from 'cancelado'),
    count(*) filter (where ag.status is distinct from 'cancelado')
  into v_cs_rev_prev, v_cs_conf_prev, v_cs_tot_prev
  from public.cs_agendamentos ag
  inner join public.cs_profissionais cp on cp.id = ag.profissional_id
    and cp.clinic_id = p_clinic_id
  left join public.cs_servicos s on s.id = ag.servico_id
  where
    ag.clinic_id = p_clinic_id
    and ag.data_agendamento >= v_pms
    and ag.data_agendamento < v_pend;

  v_rev_prev := coalesce(v_rev_ap_prev, 0) + coalesce(v_cs_rev_prev, 0);
  v_conf_prev := coalesce(v_conf_prev, 0) + coalesce(v_cs_conf_prev, 0);
  v_tot_prev := coalesce(v_tot_prev, 0) + coalesce(v_cs_tot_prev, 0);

  if v_tot_curr > 0 then
    v_rate_curr := round((v_conf_curr::numeric / v_tot_curr::numeric) * 100, 1);
  end if;
  if v_tot_prev > 0 then
    v_rate_prev := round((v_conf_prev::numeric / v_tot_prev::numeric) * 100, 1);
  end if;

  select count(*)::int
  into v_new_curr
  from public.cs_clientes cc
  where
    cc.clinic_id = p_clinic_id
    and (cc.created_at at time zone v_tz)::date >= v_ms
    and (cc.created_at at time zone v_tz)::date < v_next_ms;

  select count(*)::int
  into v_new_prev
  from public.cs_clientes cc
  where
    cc.clinic_id = p_clinic_id
    and (cc.created_at at time zone v_tz)::date >= v_pms
    and (cc.created_at at time zone v_tz)::date < v_pend;

  v_cap_hours := greatest(13::numeric * greatest(v_prof_active, 1), 1);

  select coalesce(
    sum(
      greatest(
        0,
        extract(
          epoch from (
            least(
              a.ends_at,
              ((v_today + interval '1 day')::timestamp at time zone v_tz)
            )
            - greatest(
                a.starts_at,
                (v_today::timestamp at time zone v_tz)
              )
          )
        ) / 3600.0
      )
    ),
    0
  )
  into v_used_ap
  from public.appointments a
  where
    a.clinic_id = p_clinic_id
    and a.status = 'scheduled'
    and (a.starts_at at time zone v_tz)::date <= v_today
    and (a.ends_at at time zone v_tz)::date >= v_today;

  select coalesce(
    sum(
      extract(
        epoch from (
          make_interval(mins => coalesce(s.duracao_minutos, 60))
        )
      ) / 3600.0
    ),
    0
  )
  into v_used_cs
  from public.cs_agendamentos ag
  inner join public.cs_profissionais cp on cp.id = ag.profissional_id
    and cp.clinic_id = p_clinic_id
  left join public.cs_servicos s on s.id = ag.servico_id
  where
    ag.clinic_id = p_clinic_id
    and ag.data_agendamento = v_today
    and ag.status is distinct from 'cancelado';

  v_used_hours := coalesce(v_used_ap, 0) + coalesce(v_used_cs, 0);
  v_occ_pct := least(
    100::numeric,
    round((v_used_hours / v_cap_hours) * 100, 1)
  );

  select
    count(*) filter (where sub.c >= 2),
    count(*)
  into v_num_ret, v_den_ret
  from (
    select count(*)::int as c
    from public.cs_agendamentos ag
    where
      ag.clinic_id = p_clinic_id
      and ag.data_agendamento >= v_today - 90
      and ag.status is distinct from 'cancelado'
    group by ag.cliente_id
  ) sub;

  if coalesce(v_den_ret, 0) > 0 then
    v_return_pct := round((v_num_ret::numeric / v_den_ret::numeric) * 100, 1);
  end if;

  select count(*)::int
  into v_retorno_vencido
  from public.cs_clientes cc
  where
    cc.clinic_id = p_clinic_id
    and cc.ultima_consulta is not null
    and cc.ultima_consulta < v_today - 180
    and cc.status_funil is distinct from 'sumido'::public.crm_status_funil;

  select coalesce(
    sum(public.painel_procedure_price(p_clinic_id, a.service_name)),
    0
  )
  into v_represada
  from public.appointments a
  where
    a.clinic_id = p_clinic_id
    and a.status = 'scheduled'
    and coalesce(a.source, '') is distinct from 'painel'
    and (a.starts_at at time zone v_tz)::date >= v_ms
    and (a.starts_at at time zone v_tz)::date < v_next_ms;

  with
    profs as (
      select p.id as pid
      from public.professionals p
      where p.clinic_id = p_clinic_id
        and coalesce(p.is_active, true)
    ),
    hours as (
      select generate_series(7, 18) as hr
    ),
    busy as (
      select distinct pr_inner.pid as prof_id, h_inner.hr
      from profs pr_inner
      cross join hours h_inner
      where exists (
        select 1
        from public.appointments a
        where
          a.clinic_id = p_clinic_id
          and a.professional_id = pr_inner.pid
          and a.status <> 'cancelled'
          and a.starts_at < ((v_today::text || ' ' || lpad((h_inner.hr + 1)::text, 2, '0') || ':00:00')::timestamp at time zone v_tz)
          and a.ends_at > ((v_today::text || ' ' || lpad(h_inner.hr::text, 2, '0') || ':00:00')::timestamp at time zone v_tz)
      )
      or exists (
        select 1
        from public.cs_agendamentos ag
        inner join public.cs_profissionais cp on cp.id = ag.profissional_id
        inner join public.professionals prx
          on prx.clinic_id = p_clinic_id
          and prx.cs_profissional_id is not distinct from cp.id
        where
          ag.clinic_id = p_clinic_id
          and prx.id = pr_inner.pid
          and ag.data_agendamento = v_today
          and ag.status is distinct from 'cancelado'
          and extract(
            hour from ag.horario
          ) = h_inner.hr
      )
    ),
    cand as (
      select pr.pid as prof_id, h.hr
      from profs pr
      cross join hours h
      where not exists (
        select 1 from busy b
        where b.prof_id = pr.pid and b.hr = h.hr
      )
    )
  select count(*)::int into v_buracos
  from cand c
  where exists (select 1 from busy b where b.prof_id = c.prof_id and b.hr = c.hr - 1)
    and exists (select 1 from busy b where b.prof_id = c.prof_id and b.hr = c.hr + 1);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name',
        sub.nm,
        'count',
        sub.cnt,
        'revenue',
        sub.rev
      )
      order by sub.cnt desc
    ),
    '[]'::jsonb
  )
  into v_top
  from (
    select
      u.nm,
      sum(u.cnt)::bigint as cnt,
      sum(u.rev) as rev
    from (
      select
        coalesce(nullif(trim(a.service_name), ''), 'Serviço') as nm,
        1::bigint as cnt,
        public.painel_procedure_price(p_clinic_id, a.service_name) as rev
      from public.appointments a
      where
        a.clinic_id = p_clinic_id
        and (a.starts_at at time zone v_tz)::date >= v_ms
        and (a.starts_at at time zone v_tz)::date < v_next_ms
        and (
          (a.status = 'scheduled' and coalesce(a.source, '') = 'painel')
          or a.status = 'completed'
        )
      union all
      select
        coalesce(
          nullif(trim(coalesce(ag.nome_procedimento, s.nome, '')), ''),
          'Serviço'
        ) as nm,
        1::bigint as cnt,
        public.painel_procedure_price(
          p_clinic_id,
          nullif(trim(coalesce(ag.nome_procedimento, s.nome, '')), '')
        ) as rev
      from public.cs_agendamentos ag
      inner join public.cs_profissionais cp on cp.id = ag.profissional_id
        and cp.clinic_id = p_clinic_id
      left join public.cs_servicos s on s.id = ag.servico_id
      where
        ag.clinic_id = p_clinic_id
        and ag.data_agendamento >= v_ms
        and ag.data_agendamento < v_next_ms
        and ag.status is distinct from 'cancelado'
    ) u
    group by u.nm
    order by sum(u.cnt) desc
    limit 12
  ) sub;

  return jsonb_build_object(
    'meta',
    jsonb_build_object(
      'timezone',
      v_tz,
      'today',
      v_today,
      'month_start',
      v_ms,
      'professionals_active',
      v_prof_active,
      'clinic_ativo',
      v_clinic_ativo,
      'ia_active',
      v_clinic_ativo and v_ia_plan
    ),
    'month',
    jsonb_build_object(
      'revenue',
      round(coalesce(v_rev_curr, 0), 2),
      'revenue_prev',
      round(coalesce(v_rev_prev, 0), 2),
      'new_patients',
      v_new_curr,
      'new_patients_prev',
      v_new_prev,
      'confirmation_rate',
      v_rate_curr,
      'confirmation_rate_prev',
      v_rate_prev,
      'occupancy_today_pct',
      v_occ_pct
    ),
    'insights',
    jsonb_build_object(
      'confirmation_pct',
      v_rate_curr,
      'return_pct',
      v_return_pct,
      'occupancy_pct',
      v_occ_pct,
      'alerts',
      jsonb_build_object(
        'retorno_vencido_count',
        v_retorno_vencido,
        'receita_represada',
        round(coalesce(v_represada, 0), 2),
        'agenda_buracos_count',
        v_buracos
      )
    ),
    'top_services',
    coalesce(v_top, '[]'::jsonb)
  );
end;
$$;

comment on function public.painel_dashboard_kpis(uuid, date) is
  'Painel: KPIs mensais, ocupação do dia, insights, alertas CRM e top serviços (tenant-safe).';

comment on function public.painel_procedure_price(uuid, text) is
  'Preço estimado (BRL) do serviço na clínica para catálogo clinic_procedures.';

revoke all on function public.painel_procedure_price(uuid, text) from public;
grant execute on function public.painel_procedure_price(uuid, text) to authenticated;
grant execute on function public.painel_procedure_price(uuid, text) to service_role;

revoke all on function public.painel_dashboard_kpis(uuid, date) from public;
grant execute on function public.painel_dashboard_kpis(uuid, date) to authenticated;
grant execute on function public.painel_dashboard_kpis(uuid, date) to service_role;
