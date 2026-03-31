# Sistema Multi-Tenant WhatsApp para Clínicas

Implementação completa de um sistema SaaS para gerenciar WhatsApp de múltiplas clínicas usando Evolution API, n8n e Supabase.

## 📋 Visão Geral

Este sistema permite que cada clínica tenha:
- ✅ Seu próprio número de WhatsApp (instância Evolution API)
- ✅ Prompt de agente IA personalizado
- ✅ Dados isolados no banco de dados (multi-tenant)
- ✅ Gerenciamento de trial e assinatura
- ✅ Um único fluxo n8n atendendo todas as clínicas

## 🏗️ Arquitetura

```
┌─────────────────┐         ┌──────────────────┐         ┌───────────────┐
│   Evolution     │         │      Supabase    │         │   n8n Flow    │
│      API        │────────▶│   (Database)     │◀────────│   (Webhook)   │
│                 │         │                  │         │               │
└─────────────────┘         └──────────────────┘         └───────────────┘
                                    ▲                            │
                                    │                            │
                                    └────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│           Anthropic Claude API (Agente IA por Clínica)              │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│    Backend Express (Gerenciamento de Clínicas + Webhook Asaas)   │
└──────────────────────────────────────────────────────────────────┘
```

## 📁 Estrutura de Arquivos

```
consultorio/
├── database/
│   └── schema.sql               # Schema multi-tenant
├── backend/
│   ├── clinica.service.js       # Serviço de criação de instâncias
│   ├── pagamento.webhook.js     # Webhook para pagamentos
│   └── server.js                # (será criado) Express setup
├── n8n/
│   └── fluxo-clinicas.json      # Workflow n8n
├── .env.example                 # Variáveis de ambiente
└── IMPLEMENTACAO.md             # Este arquivo
```

## 🚀 Passo a Passo da Implementação

### 1️⃣ Configurar Banco de Dados Supabase

#### 1.1 Criar novo projeto Supabase
- Acesse [supabase.com](https://supabase.com)
- Crie um novo projeto
- Aguarde inicialização

#### 1.2 Executar schema.sql
- No dashboard Supabase, vá para **SQL Editor**
- Crie uma nova query
- Cole todo o conteúdo de `database/schema.sql`
- Clique em **Run**
- Confirme que todas as tabelas, views e funções foram criadas

```sql
-- Verificar tabelas criadas
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Verificar views
SELECT viewname FROM pg_views WHERE schemaname = 'public';
```

#### 1.3 Copiar credenciais Supabase
- No Supabase, vá para **Settings > API**
- Copie:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY` (não use `anon_key`)
  - `SUPABASE_ANON_KEY` (para frontend, se necessário)

### 2️⃣ Configurar Evolution API

#### 2.1 Acessar Evolution API
- Acesse a instância Evolution API fornecida
- Autentique-se com suas credenciais
- Vá para **Settings > API Keys**
- Gere uma nova chave de API

#### 2.2 Copiar credenciais Evolution
- `EVOLUTION_API_URL`: URL base da API
- `EVOLUTION_API_KEY`: Chave de API gerada

### 3️⃣ Configurar n8n

#### 3.1 Criar workflow n8n
- Acesse seu n8n (ex: https://seu-n8n.com)
- Crie um novo workflow
- Clique em **Import from JSON**
- Cole todo o conteúdo de `n8n/fluxo-clinicas.json`

#### 3.2 Configurar credenciais no n8n
- Vá para **Credentials**
- Crie credenciais para:
  - **Supabase**: conexão PostgreSQL
  - **Anthropic**: API key do Claude
  - **Evolution API**: API key

#### 3.3 Configurar variáveis de ambiente no n8n
- Vá para **Settings > Environment Variables**
- Adicione:
  ```
  EVOLUTION_API_URL=https://seu-evolution.com
  EVOLUTION_API_KEY=sua_chave_aqui
  ```

#### 3.4 Ativar webhook
- No workflow, clique no nó "Webhook WhatsApp"
- Copie a URL do webhook (ex: `https://seu-n8n.com/webhook/xxx`)
- Salve esta URL - será usada no backend

### 4️⃣ Configurar Backend Express

#### 4.1 Instalar dependências
```bash
npm install express dotenv @supabase/supabase-js axios uuid anthropic
```

#### 4.2 Criar arquivo .env
```bash
cp .env.example .env
```

Edite `.env` e preencha:
```env
EVOLUTION_API_URL=https://seu-evolution.com
EVOLUTION_API_KEY=sua_chave
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_KEY=sua_service_key
N8N_WEBHOOK_URL=https://seu-n8n.com
ANTHROPIC_API_KEY=sk-ant-...
ASAAS_TOKEN=seu_token_asaas
PORT=3000
NODE_ENV=development
```

#### 4.3 Criar servidor Express básico (backend/server.js)
```javascript
const express = require('express');
const pagamentoWebhook = require('./pagamento.webhook');
require('dotenv').config();

const app = express();
app.use(express.json());

// Webhook de pagamentos
app.use('/webhooks', pagamentoWebhook);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
```

#### 4.4 Executar servidor
```bash
npm start
```

### 5️⃣ Configurar Asaas Webhook

#### 5.1 No painel Asaas
- Vá para **Integração > Webhooks**
- Adicione novo webhook:
  - **URL**: `https://seu-backend.com/webhooks/asaas`
  - **Eventos**: PAYMENT_CONFIRMED, PAYMENT_OVERDUE, PAYMENT_DELETED
  - Ative

#### 5.2 Configurar Anthropic API

- Vá para [console.anthropic.com](https://console.anthropic.com)
- Crie uma API key
- Adicione em `.env` como `ANTHROPIC_API_KEY`

## 🔄 Fluxo de Funcionamento

### Criar uma Nova Clínica

```javascript
const { criarInstanciaClinica } = require('./backend/clinica.service');

const resultado = await criarInstanciaClinica('clinica-uuid-aqui');
console.log(resultado);
/*
{
  sucesso: true,
  nomeInstancia: 'clinica-abc12345',
  statusWhatsapp: 'aguardando_qr',
  qrCode: 'data:image/png;base64,...',
  mensagem: 'Instância criada com sucesso...'
}
*/
```

### Fluxo de Mensagem WhatsApp

1. **Paciente envia mensagem** → Evolution API recebe
2. **Evolution dispara webhook** → n8n `/webhook/whatsapp`
3. **n8n valida clínica** → Busca em `clinicas_acesso` VIEW
4. **Verifica acesso** → Bloqueado/Liberado/Trial Expirado
5. **Se liberado:**
   - Busca histórico da conversa
   - Monta prompt isolado com dados da clínica
   - Chama Claude API
   - Envia resposta via Evolution
   - Salva histórico (máx 20 mensagens)
6. **Se bloqueado:**
   - Envia mensagem de bloqueio
   - Não chama Claude

### Fluxo de Pagamento

1. **Asaas envia evento de pagamento** → Webhook do Backend
2. **Backend processa evento:**
   - Se `PAYMENT_CONFIRMED`: Chama `reativar_clinica()`
   - Se `PAYMENT_OVERDUE`: Apenas registra (bloqueio acontece no CRON)
3. **CRON diário** (configurar no Supabase):
   - Executa `bloquear_clinicas_vencidas()`
   - Desativa clínicas expiradas

## 🔐 Isolamento Multi-Tenant

### Garantir Segurança

✅ **Em todas as queries:**
- Sempre filtrar por `clinica_id`
- Usar WHERE clauses apropriadas
- Nunca confiar apenas no frontend para filtragem

✅ **No código n8n:**
```
WHERE instancia_evolution = {{ $json.instance }}
WHERE clinica_id = @clinicaId
```

✅ **No backend:**
```javascript
// ❌ ERRADO - Sem filtro por clínica
await supabase.from('conversas').select('*');

// ✅ CORRETO - Com filtro
await supabase
  .from('conversas')
  .select('*')
  .eq('clinica_id', clinicaId);
```

## 📊 Gerenciamento de Trial

### Estados Possíveis (via VIEW `clinicas_acesso`)

| Estado | Condição | Ação |
|--------|----------|------|
| `liberado` | Ativa e dentro do prazo | Aceita mensagens |
| `trial_expirado` | Trial vencido | Bloqueia (CRON desativa) |
| `inadimplente` | Assinatura vencida | Bloqueia (CRON desativa) |
| `bloqueado` | `ativo = false` | Bloqueia imediatamente |

### Criar Clínica em Trial

```javascript
// Depois de criar instância
const { error } = await supabase
  .from('clinicas')
  .update({
    plano: 'trial',
    trial_inicio: new Date().toISOString().split('T')[0],
    trial_dias: 14
  })
  .eq('id', clinicaId);
```

### Reativar após Pagamento

```javascript
// O webhook de pagamento chama automaticamente
await supabase.rpc('reativar_clinica', {
  p_clinica_id: clinicaId,
  p_dias: 30
});
```

## 🔧 Manutenção

### Agendar CRON para Bloquear Vencidas

No Supabase **Database > Webhooks** ou usando um serviço externo:

```bash
# Executar diariamente às 00:00
0 0 * * * SELECT bloquear_clinicas_vencidas();
```

### Monitorar Logs

**n8n Logs:**
- Dashboard do workflow
- Ver execuções e erros

**Backend Logs:**
```bash
node backend/server.js 2>&1 | tee logs/app.log
```

**Supabase Logs:**
- **Database > Webhooks** para ver execuções de funções
- **Logs** para ver queries executadas

## 🐛 Troubleshooting

### Clínica não recebe mensagens

1. ✅ Verificar se `status_whatsapp = 'conectado'` no Supabase
2. ✅ Verificar se `status_acesso = 'liberado'` na VIEW
3. ✅ Testar webhook do n8n manualmente
4. ✅ Verificar logs do n8n

### Mensagens não salvam no histórico

1. ✅ Verificar conexão PostgreSQL no n8n
2. ✅ Validar UUID da clínica
3. ✅ Confirmar tabela `conversas` existe
4. ✅ Ver logs de erro no n8n

### Webhook de pagamento não dispara

1. ✅ Verificar URL correta no Asaas
2. ✅ Testar webhook manualmente (Asaas sandbox)
3. ✅ Confirmar servidor backend está rodando
4. ✅ Verificar logs do backend

## 🚨 Checklist de Segurança

- [ ] Usar `SUPABASE_SERVICE_KEY` apenas no backend
- [ ] Usar `SUPABASE_ANON_KEY` apenas no frontend
- [ ] Habilitar RLS em todas as tabelas
- [ ] Sempre filtrar por `clinica_id`
- [ ] Validar tokens de autenticação (JWT)
- [ ] Usar HTTPS em URLs de webhook
- [ ] Não expor API keys em logs
- [ ] Rotacionar API keys periodicamente

## 📚 Referências

- [Evolution API Docs](https://evolution-api.readme.io/)
- [Supabase Docs](https://supabase.com/docs)
- [n8n Docs](https://docs.n8n.io)
- [Anthropic API Docs](https://docs.anthropic.com/)

## 💡 Próximos Passos

- [ ] Criar interface do painel de clínicas (React/Vue)
- [ ] Implementar autenticação JWT
- [ ] Adicionar métricas e relatórios
- [ ] Implementar backup automático
- [ ] Criar documentação de API para clínicas
- [ ] Adicionar suporte a WhatsApp Business API (em vez de Baileys)

---

**Criado em:** 2026-03-31
**Última atualização:** 2026-03-31
