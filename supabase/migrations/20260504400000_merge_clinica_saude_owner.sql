-- Migration: Fusão das duas "Clínica Saúde" + limpeza completa
-- A clínica real (5c8f7a44) tinha todos os dados: Jayne, 24 clientes, 17 agendamentos.
-- A clínica fantasma (7619e1f6) foi criada por engano com a conta atual do painel e apagada.

-- Passo 1: Mover Dr. João Lucas para a clínica real (único exclusivo da fantasma)
UPDATE professionals
SET clinic_id = '5c8f7a44-c6b3-4835-889b-7e9f9b009125'
WHERE clinic_id = '7619e1f6-1474-4181-85f7-d2a36b131c11'
  AND LOWER(name) LIKE '%jo_o%lucas%';

-- Passo 2: Apagar profissionais restantes da clínica fantasma (duplicados)
DELETE FROM professionals
WHERE clinic_id = '7619e1f6-1474-4181-85f7-d2a36b131c11';

-- Passo 3: Transferir ownership da clínica real para o utilizador atual do painel
UPDATE clinics
SET owner_id = '01b7e850-5355-41cb-bbf7-aecf70d33e5a'
WHERE id = '5c8f7a44-c6b3-4835-889b-7e9f9b009125';

-- Passo 4: Remover entradas de clinic_members da clínica fantasma
DELETE FROM clinic_members
WHERE clinic_id = '7619e1f6-1474-4181-85f7-d2a36b131c11';

-- Passo 5: Garantir que o utilizador é membro admin da clínica real
INSERT INTO clinic_members (clinic_id, user_id, role)
VALUES (
  '5c8f7a44-c6b3-4835-889b-7e9f9b009125',
  '01b7e850-5355-41cb-bbf7-aecf70d33e5a',
  'admin'
)
ON CONFLICT DO NOTHING;

-- Passo 6: Apagar a clínica fantasma
DELETE FROM clinics
WHERE id = '7619e1f6-1474-4181-85f7-d2a36b131c11';
