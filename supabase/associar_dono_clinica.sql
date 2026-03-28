-- Associa um utilizador Supabase Auth como dono da clínica (acesso ao portal).
-- 1) Authentication → Users → copie o UUID do email do dono.
-- 2) Table Editor → clinics → copie o id da clínica (ou use o slug).
-- 3) Substitua os UUIDs abaixo e execute no SQL Editor.

-- update public.clinics
-- set owner_id = 'UUID-DO-UTILIZADOR-AUTH'
-- where id = 'UUID-DA-CLINICA';

-- Exemplo por slug:
-- update public.clinics
-- set owner_id = 'UUID-DO-UTILIZADOR-AUTH'
-- where slug = 'demo';
