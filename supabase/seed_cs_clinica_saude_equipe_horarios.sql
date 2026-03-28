-- =============================================================================
-- Cadastro: Dra. Maria Letícia + Dr. João Lucas + vagas (30 dias)
-- Horário: seg–sex 08h–12h e 14h–18h; sábado 08h–12h; domingo fechado
-- Slots: de hora em hora (08,09,10,11 / 14,15,16,17)
-- Idempotente: profissionais por nome; vagas com ON CONFLICT DO NOTHING
-- =============================================================================

-- Profissionais
insert into public.cs_profissionais (nome, especialidade, ativo)
select 'Dra. Maria Letícia', 'Clínica geral', true
where not exists (
  select 1 from public.cs_profissionais p where p.nome = 'Dra. Maria Letícia'
);

insert into public.cs_profissionais (nome, especialidade, ativo)
select 'Dr. João Lucas', 'Clínica geral', true
where not exists (
  select 1 from public.cs_profissionais p where p.nome = 'Dr. João Lucas'
);

-- Vagas: próximos 30 dias, regras por dia da semana
-- dow: 0=domingo … 6=sábado (PostgreSQL)
insert into public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel)
select
  p.id,
  d.day_date,
  slot.t,
  true
from public.cs_profissionais p
cross join lateral (
  select (g.gs)::date as day_date, extract(dow from (g.gs)::date)::int as dow
  from generate_series(
    current_date,
    current_date + 29,
    interval '1 day'
  ) as g(gs)
) d
cross join lateral unnest(
  case
    when d.dow in (1, 2, 3, 4, 5) then
      array[
        time '08:00',
        time '09:00',
        time '10:00',
        time '11:00',
        time '14:00',
        time '15:00',
        time '16:00',
        time '17:00'
      ]
    when d.dow = 6 then
      array[
        time '08:00',
        time '09:00',
        time '10:00',
        time '11:00'
      ]
    else
      array[]::time[]
  end
) as slot (t)
where p.nome in ('Dra. Maria Letícia', 'Dr. João Lucas')
  and p.ativo = true
on conflict (profissional_id, data, horario) do nothing;

comment on table public.cs_profissionais is
  'Profissionais do agendamento n8n (cs_*). Cadastro Clínica Saúde: Maria Letícia, João Lucas.';
