-- Duração padrão dos slots para a clínica.
-- Os profissionais herdam este valor como pré-preenchimento ao serem criados.
-- O valor por profissional (professionals.slot_duration_minutes) sempre prevalece.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS slot_duration_minutes smallint NOT NULL DEFAULT 60
    CHECK (slot_duration_minutes IN (15, 30, 60));
