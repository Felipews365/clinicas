-- cs_agendamentos.servico_id era NOT NULL mas a RPC n8n_cs_agendar salva NULL
-- quando o serviço vem de clinic_procedures (tabela do painel v2), já que não há FK
-- entre as duas tabelas. O nome do serviço é preservado em nome_procedimento.
ALTER TABLE public.cs_agendamentos
  ALTER COLUMN servico_id DROP NOT NULL;
