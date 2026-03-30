-- Modelo de expediente no painel de vagas (agrupa «expediente padrão» vs «outros horários»).
-- Executar no SQL Editor do Supabase (projeto já com tabela public.clinics).

alter table public.clinics
  add column if not exists slots_expediente jsonb not null default '{"preset":"two_blocks"}'::jsonb;

comment on column public.clinics.slots_expediente is
  'JSON: {"preset":"two_blocks"|"morning_full"|"extended"|"all_together"} — ver web/src/lib/slots-expediente.ts';
