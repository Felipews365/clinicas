-- Horários globalmente visíveis na agenda (6h–22h, blocos de 1h).
-- A clínica define quais horas existem no sistema; médicos/agente só usam esse subconjunto.
-- Idempotente: add column if not exists.

alter table public.clinics
  add column if not exists agenda_visible_hours integer[]
  not null default array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[];

comment on column public.clinics.agenda_visible_hours is
  'Horas cheias (6–22) que a clínica permite mostrar na agenda e nas grelhas; fora disto = não listado.';

update public.clinics
set agenda_visible_hours = array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
where agenda_visible_hours is null
   or cardinality(agenda_visible_hours) = 0;
