-- Pacientes duplicados por variação de telefone (+55… vs 55…).
--
-- Causa: patients tem UNIQUE (clinic_id, phone) sobre a STRING crua, então
-- "+5581993794747" e "5581993794747" são tratados como pacientes diferentes.
-- Um batch de sync inseriu versões só-dígitos de pacientes que já existiam com
-- "+", gerando pares duplicados (a linha "+" ficou com os agendamentos; a
-- só-dígitos ficou vazia).
--
-- Fix (tenant-safe, aplica a TODAS as clínicas):
--   1. Dedupe: por (clinic_id, telefone normalizado) escolhe um keeper (o com
--      mais filhos; desempate pelo mais antigo), repointa filhos e apaga os
--      restantes.
--   2. Normaliza patients.phone para só dígitos (como cs_clientes.telefone).
--   3. Trigger BEFORE que mantém patients.phone só com dígitos em qualquer
--      escrita futura — assim UNIQUE (clinic_id, phone) volta a impedir dupes.

-- ---------------------------------------------------------------------------
-- 1) Dedupe de duplicados existentes
-- ---------------------------------------------------------------------------
do $$
declare
  g record;
  keeper uuid;
  losers uuid[];
begin
  for g in
    select clinic_id, regexp_replace(coalesce(phone, ''), '\D', '', 'g') as pn
    from public.patients
    where coalesce(phone, '') <> ''
    group by clinic_id, regexp_replace(coalesce(phone, ''), '\D', '', 'g')
    having count(*) > 1
  loop
    -- keeper: mais filhos (agendamentos + prontuário); desempate pelo mais antigo
    select id into keeper
    from public.patients p
    where p.clinic_id = g.clinic_id
      and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = g.pn
    order by (
        (select count(*) from public.appointments a where a.patient_id = p.id)
      + (select count(*) from public.cs_prontuario_ficha f where f.patient_id = p.id)
      + (select count(*) from public.cs_prontuario_registros r where r.patient_id = p.id)
      + (select count(*) from public.cs_prontuario_anexos an where an.patient_id = p.id)
      ) desc,
      p.created_at asc
    limit 1;

    select array_agg(id) into losers
    from public.patients p
    where p.clinic_id = g.clinic_id
      and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = g.pn
      and p.id <> keeper;

    if losers is null then
      continue;
    end if;

    -- repointar filhos dos losers -> keeper (appointments tem FK RESTRICT:
    -- repointar antes de apagar é obrigatório)
    update public.appointments set patient_id = keeper where patient_id = any(losers);
    update public.cs_prontuario_registros set patient_id = keeper where patient_id = any(losers);
    update public.cs_prontuario_anexos set patient_id = keeper where patient_id = any(losers);

    -- ficha tem UNIQUE (clinic_id, patient_id): só migra se o keeper ainda não
    -- tiver ficha; senão a do loser é descartada no cascade do delete abaixo
    update public.cs_prontuario_ficha f
    set patient_id = keeper
    where f.patient_id = any(losers)
      and not exists (
        select 1 from public.cs_prontuario_ficha k where k.patient_id = keeper
      );

    -- apagar os losers (cascade limpa prontuário remanescente)
    delete from public.patients where id = any(losers);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Normalizar telefones remanescentes para só dígitos
-- ---------------------------------------------------------------------------
update public.patients
set phone = nullif(regexp_replace(phone, '\D', '', 'g'), '')
where phone is not null and phone ~ '\D';

-- ---------------------------------------------------------------------------
-- 3) Trigger BEFORE: mantém patients.phone só com dígitos em qualquer escrita
-- ---------------------------------------------------------------------------
create or replace function public._trg_patients_normalize_phone()
returns trigger
language plpgsql
as $$
begin
  if new.phone is not null then
    new.phone := nullif(regexp_replace(new.phone, '\D', '', 'g'), '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_patients_normalize_phone on public.patients;
create trigger trg_patients_normalize_phone
  before insert or update of phone on public.patients
  for each row
  execute function public._trg_patients_normalize_phone();
