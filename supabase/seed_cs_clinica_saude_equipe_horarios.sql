-- =============================================================================
-- Cadastro SaaS: Dra. Maria Letícia + Dr. João Lucas + vagas (30 dias)
-- Horário: seg–sex 08h–20h; sáb 08h–11h; dom fechado
-- Idempotente por (nome + clinic_id). Exige uma linha em public.clinics.
--
-- v_target_clinic:
--   • NULL (predefinição) = primeira clínica por created_at — só para dev com 1 tenant
--   • ou defina explicitamente o UUID do tenant, ex. 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid
-- =============================================================================

do $$
declare
  v_target_clinic uuid := null;
  v_clinic uuid;
  n_clinics int;
begin
  select
    count(*) into n_clinics
  from
    public.clinics;

  if n_clinics = 0 then
    raise exception 'seed_cs_clinica_saude: crie uma clínica em public.clinicas antes deste seed';
  end if;

  v_clinic := coalesce(
    v_target_clinic,
    (
      select
        c.id
      from
        public.clinics c
      order by
        c.id asc
      limit
        1
    )
  );

  if v_clinic is null then
    raise exception 'seed_cs_clinica_saude: não foi possível resolver clinic_id';
  end if;

  insert into public.cs_profissionais (nome, especialidade, ativo, clinic_id)
  select
    'Dra. Maria Letícia',
    'Clínica geral',
    true,
    v_clinic
  where
    not exists (
      select
        1
      from
        public.cs_profissionais p
      where
        p.nome = 'Dra. Maria Letícia'
        and p.clinic_id = v_clinic
    );

  insert into public.cs_profissionais (nome, especialidade, ativo, clinic_id)
  select
    'Dr. João Lucas',
    'Clínica geral',
    true,
    v_clinic
  where
    not exists (
      select
        1
      from
        public.cs_profissionais p
      where
        p.nome = 'Dr. João Lucas'
        and p.clinic_id = v_clinic
    );

  -- Órfãos legados (seed antigo sem clinic_id): só se existir exatamente 1 clínica
  if n_clinics = 1 then
    update public.cs_profissionais p
    set
      clinic_id = v_clinic
    where
      p.clinic_id is null
      and p.nome in ('Dra. Maria Letícia', 'Dr. João Lucas')
      and p.ativo = true;
  end if;

  insert into public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel)
  select
    p.id,
    d.day_date,
    slot.t,
    true
  from
    public.cs_profissionais p
    cross join lateral (
      select
        (g.gs)::date as day_date,
        extract(
          dow
          from
            (g.gs)::date
        )::int as dow
      from
        generate_series(
          current_date,
          current_date + 29,
          interval '1 day'
        ) as g(gs)
    ) d
    cross join lateral unnest(
      case
        when d.dow in (1, 2, 3, 4, 5) then array[
          time '08:00',
          time '09:00',
          time '10:00',
          time '11:00',
          time '12:00',
          time '13:00',
          time '14:00',
          time '15:00',
          time '16:00',
          time '17:00',
          time '18:00',
          time '19:00',
          time '20:00'
        ]
        when d.dow = 6 then array[
          time '08:00',
          time '09:00',
          time '10:00',
          time '11:00'
        ]
        else array[]::time[]
      end
    ) as slot (t)
  where
    p.clinic_id = v_clinic
    and p.nome in ('Dra. Maria Letícia', 'Dr. João Lucas')
    and p.ativo = true
  on conflict (profissional_id, data, horario) do nothing;
end;
$$;

comment on table public.cs_profissionais is
  'Profissionais do agendamento n8n (cs_*). Seed Clínica Saúde: Maria Letícia, João Lucas (tenant via clinic_id).';
