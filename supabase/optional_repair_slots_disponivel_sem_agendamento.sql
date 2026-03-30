-- =============================================================================
-- REPARAÇÃO OPCIONAL — cs_horarios_disponiveis
-- =============================================================================
-- Objetivo: corrigir linhas antigas criadas quando a grelha punha disponivel=false
-- fora do "horário comercial", alinhando com a regra actual: na grade oficial da
-- clínica (agenda_visible_hours), o defeito é DISPONÍVEL salvo bloqueio manual ou
-- agendamento activo.
--
-- O que este script FAZ:
--   Marca disponivel = true em slots onde:
--   • o profissional pertence à clínica (ou clinic_id null, usa grade 6–22);
--   • a hora do slot está em clinics.agenda_visible_hours (ou falback 6..22);
--   • disponivel está false;
--   • NÃO existe agendamento activo (cs_agendamentos nesse profissional/data/hora,
--     status fora de cancelado/concluído);
--   • bloqueio_manual = false (não apagar bloqueios marcados no painel).
--
-- Trade-off IMPORTANTE:
--   Bloqueios manuais reais (bloqueio_manual = true) NÃO são alterados por este script.
--   Linhas «fantasma» (disponivel false sem agendamento e sem bloqueio_manual) passam a livres.
--   Se precisas de manter esses bloqueios, NÃO executes este script — ou reverte
--   à mão depois.
--
-- Como usar:
--   1) Recomendado: fazer backup ou testar em staging.
--   2) Opcional: correr só o SELECT de pré-visualização (secção A).
--   3) Correr o UPDATE (secção B) no SQL Editor do Supabase ou psql.
-- =============================================================================

-- Grade por defeito quando a clínica não define horas (alinhado às RPCs do painel).
-- Ajusta se o teu projecto usar outro intervalo.

-- ---------------------------------------------------------------------------
-- A) Pré-visualização: quantas linhas seriam afectadas
-- ---------------------------------------------------------------------------
-- select count(*) as linhas_a_actualizar
-- from public.cs_horarios_disponiveis h
-- inner join public.cs_profissionais pr on pr.id = h.profissional_id
-- left join public.clinics c on c.id = pr.clinic_id
-- where h.disponivel = false
--   and coalesce(h.bloqueio_manual, false) = false
--   and extract(hour from h.horario)::integer = any (
--     coalesce(
--       c.agenda_visible_hours,
--       array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
--     )
--   )
--   and not exists (
--     select 1
--     from public.cs_agendamentos a
--     where a.profissional_id = h.profissional_id
--       and a.data_agendamento = h.data
--       and a.horario = h.horario
--       and a.status not in ('cancelado', 'concluido')
--   );

-- ---------------------------------------------------------------------------
-- B) Actualização
-- ---------------------------------------------------------------------------
update public.cs_horarios_disponiveis h
set
  disponivel = true,
  bloqueio_manual = false
from public.cs_profissionais pr
left join public.clinics c on c.id = pr.clinic_id
where pr.id = h.profissional_id
  and h.disponivel = false
  and coalesce(h.bloqueio_manual, false) = false
  and extract(hour from h.horario)::integer = any (
    coalesce(
      c.agenda_visible_hours,
      array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
    )
  )
  and not exists (
    select 1
    from public.cs_agendamentos a
    where a.profissional_id = h.profissional_id
      and a.data_agendamento = h.data
      and a.horario = h.horario
      and a.status not in ('cancelado', 'concluido')
  );
