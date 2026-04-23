-- Garante coluna usada por cs_prof_panel_hours_for_prof_date (migração 20260424120000 pode não ter corrido antes da de horas ocultas).

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS works_saturday boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.professionals.works_saturday IS
  'Se false, o profissional não tem grade aos sábados (painel e agente), mesmo com sabado_aberto na clínica.';
