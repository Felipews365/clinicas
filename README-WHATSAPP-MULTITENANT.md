# 🚀 Sistema Multi-Tenant WhatsApp para Clínicas

Plataforma SaaS completa para gerenciar WhatsApp de múltiplas clínicas com isolamento total de dados, agente IA personalizado e gerenciamento de assinatura.

## 📦 O que foi criado

```
consultorio/
├── database/
│   └── schema.sql                    # Schema Supabase (4 tabelas + 2 funções + 1 view)
├── backend/
│   ├── clinica.service.js            # Serviço principal (criação de instâncias)
│   ├── pagamento.webhook.js          # Webhook Asaas (pagamentos)
│   └── exemplo-uso.js                # 10 exemplos práticos de uso
├── n8n/
│   └── fluxo-clinicas.json           # Workflow n8n (processamento de mensagens)
├── .env.example                      # Template de variáveis ambiente
├── IMPLEMENTACAO.md                  # Guia passo-a-passo de setup
├── CHECKLIST-VALIDACAO.md            # Testes de validação
└── README-WHATSAPP-MULTITENANT.md    # Este arquivo
```

## ⚡ Início Rápido (5 Passos)

### 1. Executar Schema.sql
```bash
# No Supabase SQL Editor, cole database/schema.sql inteiro
# Cria: clinicas, dados_clinica, conversas, historico_pagamentos
# VIEW: clinicas_acesso (status em tempo real)
# Funções: bloquear_clinicas_vencidas(), reativar_clinica()
```

### 2. Configurar .env
```bash
cp .env.example .env
# Preencha com suas credenciais:
# - EVOLUTION_API_URL + KEY
# - SUPABASE_URL + SERVICE_KEY
# - ANTHROPIC_API_KEY
# - N8N_WEBHOOK_URL
# - ASAAS_TOKEN (opcional)
```

### 3. Importar Workflow n8n
```bash
# No n8n: Ctrl+G (ou menu) > Import from JSON
# Importe n8n/fluxo-clinicas.json
# Configura: Supabase, Anthropic, Evolution API
```

### 4. Instalar & Rodar Backend
```bash
npm install
node backend/server.js    # ou npm start
```

### 5. Testar Sistema
```bash
# Criar uma clínica de teste
node backend/exemplo-uso.js 1

# Verificar dados salvos
node backend/exemplo-uso.js 2

# Simular webhook
node backend/exemplo-uso.js 6
```

## 🎯 Funcionalidades Principais

### ✅ Multi-Tenant Isolado
- Cada clínica tem seu UUID único
- Dados isolados por `clinica_id` em todas as tabelas
- RLS (Row Level Security) ativado

### ✅ Gerenciamento de Acesso
- **Trial**: 14 dias grátis (customizável)
- **Bloqueio automático**: CRON diário bloqueia expirados
- **VIEW em tempo real**: `clinicas_acesso` calcula status
- Status: `liberado`, `trial_expirado`, `inadimplente`, `bloqueado`

### ✅ Agente IA Personalizado
- Prompt customizado por clínica
- Claude Opus 4.6 responde mensagens
- Histórico de conversa (máx 20 mensagens)
- Isolamento completo: contexto + dados da clínica

### ✅ Webhook WhatsApp
- Endpoint único `/webhook/whatsapp` para todas as clínicas
- Processa `MESSAGES_UPSERT` (mensagens) e `CONNECTION_UPDATE` (status)
- Salva histórico automaticamente

### ✅ Pagamentos (Asaas)
- `PAYMENT_CONFIRMED` → Reativa clínica
- `PAYMENT_OVERDUE` → Registra vencimento
- `PAYMENT_DELETED` → Registra cancelamento

## 📊 Banco de Dados

### Tabelas
| Tabela | Descrição |
|--------|-----------|
| `clinicas` | Dados principais (nome, instância, plano, trial, status) |
| `dados_clinica` | Customizados por clínica (chave-valor) |
| `conversas` | Histórico WhatsApp por paciente |
| `historico_pagamentos` | Log de eventos de pagamento |

### VIEW
| View | Descrição |
|------|-----------|
| `clinicas_acesso` | Status calculado em tempo real (liberado/bloqueado/vencido) |

### Funções
| Função | Descrição |
|--------|-----------|
| `bloquear_clinicas_vencidas()` | CRON: Bloqueia expiradas diariamente |
| `reativar_clinica(id, dias)` | Estende trial/assinatura após pagamento |

## 🔄 Fluxo de Mensagem

```
Paciente envia msg no WhatsApp
          ↓
Evolution API recebe
          ↓
Webhook n8n: /webhook/whatsapp
          ↓
Switch: evento = MESSAGES_UPSERT?
          ↓ SIM
Buscar clínica em clinicas_acesso
          ↓
Status = liberado?
          ↓ SIM
Buscar histórico da conversa
          ↓
Montar system prompt (isolado por clínica)
          ↓
Claude API gera resposta
          ↓
Evolution: enviar msg via WhatsApp
          ↓
Salvar histórico (máx 20 msgs)
          ↓
Resposta enviada ✅
```

## 🔐 Segurança

✅ **Isolamento Total**
```javascript
// ❌ NUNCA faça isso
await supabase.from('conversas').select('*');

// ✅ SEMPRE filtre
await supabase
  .from('conversas')
  .select('*')
  .eq('clinica_id', clinicaId);
```

✅ **Credenciais**
- Use `.env` NUNCA hardcode
- `SERVICE_KEY` apenas backend
- `ANON_KEY` apenas frontend
- Rotação periódica de keys

✅ **Validações**
- Webhook valida instância → clinica_id
- Histórico limitado a 20 msgs (controle de tokens)
- RLS ativado em todas as tabelas

## 📚 Documentação

| Arquivo | Descrição |
|---------|-----------|
| `IMPLEMENTACAO.md` | 5️⃣ Passo-a-passo completo com prints |
| `CHECKLIST-VALIDACAO.md` | ✅ Testes para validar cada componente |
| `backend/exemplo-uso.js` | 1️⃣0️⃣ Exemplos práticos (node exemplo-uso.js N) |

## 🧪 Exemplos Práticos

```bash
# 1. Criar clínica
node backend/exemplo-uso.js 1

# 2. Obter dados
node backend/exemplo-uso.js 2

# 3. Salvar dados customizados
node backend/exemplo-uso.js 3

# 4. Verificar status da conexão
node backend/exemplo-uso.js 4

# 5. Enviar mensagem de teste
node backend/exemplo-uso.js 5

# 6. Simular webhook
node backend/exemplo-uso.js 6

# 7. Deletar clínica
node backend/exemplo-uso.js 7

# 8. Fluxo completo de onboarding
node backend/exemplo-uso.js 8

# 9. Estados de acesso
node backend/exemplo-uso.js 9

# 10. Integração Express
node backend/exemplo-uso.js 10
```

## 🚨 Troubleshooting

### ❌ Clínica não recebe mensagens
- [ ] Verificar `status_whatsapp = 'conectado'`
- [ ] Verificar `status_acesso = 'liberado'` na VIEW
- [ ] Testar webhook n8n manualmente
- [ ] Ver logs do n8n em Executions

### ❌ Mensagens não salvam
- [ ] Verificar conexão PostgreSQL n8n
- [ ] Validar UUID da clínica
- [ ] Confirmar tabela `conversas` existe

### ❌ Webhook não dispara
- [ ] Verificar URL no Asaas está correta
- [ ] Testar servidor backend está rodando
- [ ] Ver logs: `curl -v http://localhost:3000/health`

## 📞 Próximos Passos

- [ ] Criar painel de clínicas (React/Vue)
- [ ] Implementar autenticação JWT
- [ ] Adicionar métricas e relatórios
- [ ] Integrar múltiplos canais (SMS, Email)
- [ ] Implementar backup automático
- [ ] Setup de CI/CD (GitHub Actions)

## 🤝 Contribuindo

1. Ler `IMPLEMENTACAO.md` para entender a arquitetura
2. Validar alterações com `CHECKLIST-VALIDACAO.md`
3. Testar com `backend/exemplo-uso.js`
4. Seguir padrão: `clinica_id` em TODAS as queries

## 📄 Variáveis de Ambiente

```env
# Evolution API
EVOLUTION_API_URL=https://api.evolution-api.com
EVOLUTION_API_KEY=sua_chave

# Supabase
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_KEY=sua_service_key

# n8n
N8N_WEBHOOK_URL=https://seu-n8n.com

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Asaas (Pagamentos)
ASAAS_TOKEN=seu_token

# Servidor
PORT=3000
NODE_ENV=development
```

## 📊 Estrutura de Dados Exemplo

```json
{
  "clinica": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "nome": "Clínica Santa Maria",
    "instancia_evolution": "clinica-550e8400",
    "status_whatsapp": "conectado",
    "plano": "pro",
    "status_acesso": "liberado",
    "prompt_agente": "Você é um assistente de agendamento...",
    "dados_customizados": {
      "endereco": "Rua das Flores, 123",
      "telefone": "(11) 3456-7890",
      "especialidades": "Clínica Geral, Cardiologia"
    },
    "conversa_paciente": {
      "paciente_telefone": "11999999999",
      "historico": [
        {"role": "user", "content": "Olá, gostaria de agendar"},
        {"role": "assistant", "content": "Claro! Qual especialidade?"},
        {"role": "user", "content": "Cardiologia"}
      ]
    }
  }
}
```

---

**Versão:** 1.0
**Data:** 2026-03-31
**Status:** ✅ Pronto para usar

**Criado com ❤️ para clínicas modernas**
