-- =============================================================================
-- EXECUTE APÓS schema.sql (com sucesso). Se "clinics não existe", rode schema.sql primeiro.
-- =============================================================================

insert into public.clinics (name, slug, phone)
select 'Consultório Demo', 'demo', '+5511999990000'
where not exists (select 1 from public.clinics where slug = 'demo');

insert into public.professionals (clinic_id, name, specialty)
select c.id, v.name, v.specialty
from public.clinics c
cross join (values
  ('Dra. Ana Silva', 'Clínica geral'),
  ('Dr. Bruno Costa', 'Ortodontia')
) as v(name, specialty)
where c.slug = 'demo'
  and not exists (
    select 1 from public.professionals p where p.clinic_id = c.id
  );
