-- Corrige o cs_profissional_id quebrado de Dr. João Lucas.
-- O registro em professionals apontava para UUID inexistente (26a292e6-...)
-- enquanto o cs_profissional real tem id d979c0a9-...
UPDATE professionals
SET cs_profissional_id = 'd979c0a9-8208-4759-99ec-c87e03dc5db7'
WHERE clinic_id = '5c8f7a44-c6b3-4835-889b-7e9f9b009125'
  AND name ILIKE '%Jo%o Lucas%'
  AND cs_profissional_id = '26a292e6-3443-405d-a1a9-5e116304086a';
