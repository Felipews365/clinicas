-- =============================================================================
-- Diagnóstico: painel sem blocos / n8n sem vagas (multi-tenant)
-- Supabase SQL Editor: substitua o UUID abaixo (uma vez) e execute o ficheiro todo.
-- RPCs: painel_cs_ensure_slots_grid / painel_cs_slots_dia / n8n_cs_consultar_vagas
-- =============================================================================

drop table if exists _slots_diag_clinic;

create temp table _slots_diag_clinic (id uuid primary key);

insert into _slots_diag_clinic (id)
values ('5c8f7a44-c6b3-4835-889b-7e9f9b009125'::uuid);
/* Clínica Saúde (membro + n8n legado). Existe duplicata de nome:
   7619e1f6-1474-4181-85f7-d2a36b131c11 — use esse UUID no INSERT acima se o login for o outro tenant «Clínica Saúde». */

-- 1) Profissionais do tenant e órfãos (clinic_id nulo)
select
  'profissionais_tenant_e_orfaos' as check_id,
  pr.id,
  pr.nome,
  pr.ativo,
  pr.clinic_id
from
  public.cs_profissionais pr
where
  pr.clinic_id = (select id from _slots_diag_clinic)
  or pr.clinic_id is null
order by
  pr.clinic_id nulls first,
  pr.nome;

-- 2) Células na base para um dia (ajuste a data se precisar)
select
  'linhas_cs_horarios_disponiveis_dia' as check_id,
  count(*) as linhas
from
  public.cs_horarios_disponiveis h
  inner join public.cs_profissionais pr on pr.id = h.profissional_id
where
  h.data = '2026-03-30'
  and pr.clinic_id = (select id from _slots_diag_clinic)
  and pr.ativo = true;

-- 3) Grade horária da clínica
select
  'clinic_agenda_visible_hours' as check_id,
  c.id,
  c.name,
  c.agenda_visible_hours
from
  public.clinics c
where
  c.id = (select id from _slots_diag_clinic);

drop table if exists _slots_diag_clinic;

-- -----------------------------------------------------------------------------
-- n8n (verificação no código do repositório):
-- • n8n/workflow-kCX2LfxJrdYWB0vk-panel-aligned.json — p_clinic_id dinâmico
--   (merge webhook → clinica_id).
-- • n8n/workflow-x22*.json, workflow-live.json — UUID fixo em jsonBody;
--   alinhar por tenant / instância Evolution.
-- -----------------------------------------------------------------------------
