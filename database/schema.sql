-- ============================================================================
-- SCHEMA MULTI-TENANT WHATSAPP CLÍNICAS
-- ============================================================================

-- Extensão para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABELA: clinicas
-- Dados principais de cada clínica no SaaS
-- ============================================================================
CREATE TABLE IF NOT EXISTS clinicas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome TEXT NOT NULL,
  instancia_evolution TEXT UNIQUE,
  prompt_agente TEXT,
  status_whatsapp TEXT DEFAULT 'desconectado',
  plano TEXT DEFAULT 'trial', -- trial, basico, pro, premium
  trial_inicio DATE,
  trial_dias INTEGER DEFAULT 14,
  trial_fim DATE GENERATED ALWAYS AS (
    CASE
      WHEN trial_inicio IS NOT NULL THEN trial_inicio + (trial_dias || ' days')::INTERVAL
      ELSE NULL
    END
  ) STORED,
  assinatura_vencimento DATE,
  motivo_bloqueio TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ============================================================================
-- TABELA: dados_clinica
-- Armazenamento de dados customizados por clínica (chave-valor)
-- Exemplo: endereço, horário funcionamento, especialidades, etc.
-- ============================================================================
CREATE TABLE IF NOT EXISTS dados_clinica (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinica_id UUID NOT NULL REFERENCES clinicas(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,
  valor TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(clinica_id, chave)
);

-- ============================================================================
-- TABELA: conversas
-- Histórico de conversas por paciente (limitado a 20 mensagens)
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinica_id UUID NOT NULL REFERENCES clinicas(id) ON DELETE CASCADE,
  paciente_telefone TEXT NOT NULL,
  historico JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(clinica_id, paciente_telefone)
);

-- ============================================================================
-- TABELA: historico_pagamentos
-- Registra todos os eventos de pagamento para auditoria
-- ============================================================================
CREATE TABLE IF NOT EXISTS historico_pagamentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinica_id UUID NOT NULL REFERENCES clinicas(id) ON DELETE CASCADE,
  valor DECIMAL(10, 2),
  status TEXT, -- PAYMENT_CONFIRMED, PAYMENT_OVERDUE, etc
  referencia TEXT,
  pago_em TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ============================================================================
-- ÍNDICES para performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_conversas_clinica_telefone ON conversas(clinica_id, paciente_telefone);
CREATE INDEX IF NOT EXISTS idx_dados_clinica_chave ON dados_clinica(clinica_id, chave);
CREATE INDEX IF NOT EXISTS idx_historico_clinica ON historico_pagamentos(clinica_id);
CREATE INDEX IF NOT EXISTS idx_clinicas_instancia ON clinicas(instancia_evolution);

-- ============================================================================
-- VIEW: clinicas_acesso
-- Calcula o status de acesso de cada clínica em tempo real
-- Status: 'liberado' | 'trial_expirado' | 'inadimplente' | 'bloqueado'
-- ============================================================================
CREATE OR REPLACE VIEW clinicas_acesso AS
SELECT
  c.id,
  c.nome,
  c.instancia_evolution,
  c.prompt_agente,
  c.status_whatsapp,
  c.plano,
  c.trial_inicio,
  c.trial_fim,
  c.assinatura_vencimento,
  c.ativo,
  CASE
    WHEN c.ativo = false OR c.motivo_bloqueio IS NOT NULL THEN 'bloqueado'
    WHEN c.plano = 'trial' AND CURRENT_DATE > c.trial_fim THEN 'trial_expirado'
    WHEN c.plano != 'trial' AND CURRENT_DATE > c.assinatura_vencimento THEN 'inadimplente'
    ELSE 'liberado'
  END AS status_acesso,
  c.motivo_bloqueio,
  c.created_at,
  c.updated_at
FROM clinicas c;

-- ============================================================================
-- FUNÇÃO: bloquear_clinicas_vencidas()
-- Bloqueia clínicas com trial ou assinatura vencidos
-- Executar diariamente via CRON (job scheduler)
-- ============================================================================
CREATE OR REPLACE FUNCTION bloquear_clinicas_vencidas()
RETURNS void AS $$
BEGIN
  -- Bloquear clínicas em trial vencido
  UPDATE clinicas
  SET
    ativo = false,
    motivo_bloqueio = 'Trial expirado em ' || trial_fim::TEXT
  WHERE
    plano = 'trial'
    AND trial_fim IS NOT NULL
    AND CURRENT_DATE > trial_fim
    AND ativo = true;

  -- Bloquear clínicas com assinatura vencida
  UPDATE clinicas
  SET
    ativo = false,
    motivo_bloqueio = 'Assinatura vencida em ' || assinatura_vencimento::TEXT
  WHERE
    plano != 'trial'
    AND assinatura_vencimento IS NOT NULL
    AND CURRENT_DATE > assinatura_vencimento
    AND ativo = true;

  -- Log da execução
  RAISE NOTICE 'Função bloquear_clinicas_vencidas() executada em %', NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNÇÃO: reativar_clinica(clinica_id UUID, dias INTEGER)
-- Reativa clínica após pagamento recebido
-- Estende trial ou assinatura dependendo do plano
-- ============================================================================
CREATE OR REPLACE FUNCTION reativar_clinica(
  p_clinica_id UUID,
  p_dias INTEGER DEFAULT 30
)
RETURNS VOID AS $$
DECLARE
  v_plano TEXT;
BEGIN
  SELECT plano INTO v_plano FROM clinicas WHERE id = p_clinica_id;

  IF v_plano = 'trial' THEN
    UPDATE clinicas
    SET
      ativo = true,
      motivo_bloqueio = NULL,
      trial_fim = trial_fim + (p_dias || ' days')::INTERVAL,
      updated_at = NOW()
    WHERE id = p_clinica_id;
  ELSE
    UPDATE clinicas
    SET
      ativo = true,
      motivo_bloqueio = NULL,
      assinatura_vencimento = assinatura_vencimento + (p_dias || ' days')::INTERVAL,
      updated_at = NOW()
    WHERE id = p_clinica_id;
  END IF;

  RAISE NOTICE 'Clínica % reativada por % dias', p_clinica_id, p_dias;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNÇÃO: atualizar_timestamp()
-- Trigger para atualizar updated_at automaticamente
-- ============================================================================
CREATE OR REPLACE FUNCTION atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS: updated_at
-- Aplicar em todas as tabelas principais
-- ============================================================================
CREATE TRIGGER trigger_clinicas_updated_at
BEFORE UPDATE ON clinicas
FOR EACH ROW
EXECUTE FUNCTION atualizar_timestamp();

CREATE TRIGGER trigger_dados_clinica_updated_at
BEFORE UPDATE ON dados_clinica
FOR EACH ROW
EXECUTE FUNCTION atualizar_timestamp();

CREATE TRIGGER trigger_conversas_updated_at
BEFORE UPDATE ON conversas
FOR EACH ROW
EXECUTE FUNCTION atualizar_timestamp();

-- ============================================================================
-- RLS (Row Level Security)
-- Ativar RLS nas tabelas para isolamento de dados
-- ============================================================================
-- Bloqueia acesso via anon key — service_role bypassa RLS automaticamente
-- clinics, cs_*, clinic_members, clinic_procedures já têm RLS + políticas próprias
ALTER TABLE clinic_whatsapp_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_integrations_service_only" ON clinic_whatsapp_integrations
  FOR ALL USING (false);

ALTER TABLE conversas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversas_service_only" ON conversas
  FOR ALL USING (false);

-- ============================================================================
-- COMENTÁRIOS EXPLICATIVOS
-- ============================================================================
COMMENT ON TABLE clinicas IS 'Dados principais de cada clínica no SaaS';
COMMENT ON TABLE dados_clinica IS 'Dados customizados por clínica (chave-valor)';
COMMENT ON TABLE conversas IS 'Histórico de conversas WhatsApp por paciente';
COMMENT ON TABLE historico_pagamentos IS 'Log de eventos de pagamento para auditoria';
COMMENT ON VIEW clinicas_acesso IS 'Status de acesso calculado em tempo real';
COMMENT ON FUNCTION bloquear_clinicas_vencidas() IS 'CRON: Bloqueia clínicas vencidas diariamente';
COMMENT ON FUNCTION reativar_clinica(UUID, INTEGER) IS 'Reativa clínica após pagamento confirmado';
