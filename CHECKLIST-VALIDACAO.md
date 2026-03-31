# ✅ Checklist de Validação - Sistema Multi-Tenant WhatsApp

Documento para validar se todos os componentes estão funcionando corretamente.

---

## 📦 FASE 1: Configuração de Infraestrutura

### Supabase
- [ ] Projeto criado em supabase.com
- [ ] Arquivo `database/schema.sql` executado com sucesso
- [ ] Tabelas criadas: `clinicas`, `dados_clinica`, `conversas`, `historico_pagamentos`
- [ ] VIEW `clinicas_acesso` criada
- [ ] Função `bloquear_clinicas_vencidas()` criada
- [ ] Função `reativar_clinica()` criada
- [ ] Índices criados para performance
- [ ] RLS habilitado nas tabelas
- [ ] Credenciais copiadas:
  - [ ] SUPABASE_URL
  - [ ] SUPABASE_SERVICE_KEY
  - [ ] SUPABASE_ANON_KEY (opcional)

**Validação:**
```sql
-- Testar no SQL Editor do Supabase
SELECT * FROM clinicas_acesso LIMIT 1;
SELECT * FROM pg_tables WHERE schemaname = 'public';
```

---

### Evolution API
- [ ] Instância acessível
- [ ] Autenticação testada
- [ ] API Key gerada e testada
- [ ] Credenciais copiadas:
  - [ ] EVOLUTION_API_URL
  - [ ] EVOLUTION_API_KEY

**Validação:**
```bash
curl -X GET "https://sua-evolution.com/instance/fetchInstances" \
  -H "apikey: sua_evolution_api_key"
```

---

### Anthropic Claude API
- [ ] Conta criada em console.anthropic.com
- [ ] API Key gerada
- [ ] Crédito de teste/pagamento configurado
- [ ] Credencial copiada:
  - [ ] ANTHROPIC_API_KEY

**Validação:**
```bash
curl https://api.anthropic.com/v1/models \
  -H "x-api-key: sk-ant-..."
```

---

### n8n
- [ ] Instância acessível
- [ ] Credenciais de administrador funciona
- [ ] Arquivo `n8n/fluxo-clinicas.json` importado
- [ ] Workflow criado com sucesso
- [ ] Credenciais do Supabase configuradas no n8n
- [ ] Credenciais do Anthropic configuradas no n8n
- [ ] Credenciais da Evolution configuradas no n8n
- [ ] Variáveis de ambiente configuradas:
  - [ ] EVOLUTION_API_URL
  - [ ] EVOLUTION_API_KEY
- [ ] Webhook ativado e URL anotada

**Validação:**
- Abrir workflow no n8n
- Clicar no nó "Webhook WhatsApp"
- Copiar URL do webhook (ex: `https://seu-n8n.com/webhook/xxx`)
- Testar botão "Test webhook" (sem payload ainda)

---

## 🔧 FASE 2: Backend Express

### Dependências
- [ ] Node.js v14+ instalado
- [ ] npm/yarn funciona
- [ ] Arquivo `.env` criado a partir de `.env.example`
- [ ] Todas as variáveis preenchidas:
  - [ ] EVOLUTION_API_URL
  - [ ] EVOLUTION_API_KEY
  - [ ] SUPABASE_URL
  - [ ] SUPABASE_SERVICE_KEY
  - [ ] N8N_WEBHOOK_URL
  - [ ] ANTHROPIC_API_KEY
  - [ ] ASAAS_TOKEN
  - [ ] PORT=3000
  - [ ] NODE_ENV=development

**Validação:**
```bash
cat .env | grep -E "EVOLUTION_API_URL|SUPABASE_URL|ANTHROPIC_API_KEY"
```

### Arquivos Backend
- [ ] `backend/clinica.service.js` criado
- [ ] `backend/pagamento.webhook.js` criado
- [ ] `backend/exemplo-uso.js` criado (para testes)
- [ ] `backend/server.js` criado (ou usar um existente)

**Validação:**
```bash
ls -la backend/
```

### Instalação de Dependências
- [ ] `npm install` executado com sucesso
- [ ] Verificar `node_modules/` existe

**Validação:**
```bash
npm list @supabase/supabase-js axios anthropic
```

---

## 🧪 FASE 3: Testes Funcionais

### Teste 1: Criar Clínica
```bash
node backend/exemplo-uso.js 1
```

**Esperado:**
- ✅ Clínica criada com sucesso
- ✅ Nome da instância: `clinica-xxxxxxxx`
- ✅ Status: `aguardando_qr`
- ✅ QR Code disponível (base64 ou null se ainda não gerado)

**Validar no Supabase:**
```sql
SELECT id, nome, instancia_evolution, status_whatsapp FROM clinicas ORDER BY created_at DESC LIMIT 1;
```

---

### Teste 2: Salvar Dados da Clínica
```bash
node backend/exemplo-uso.js 3
```

**Esperado:**
- ✅ Todos os dados salvos com sucesso
- ✅ Dados aparecem em `dados_clinica`

**Validar no Supabase:**
```sql
SELECT chave, valor FROM dados_clinica WHERE clinica_id = 'uuid-da-clinica';
```

---

### Teste 3: Verificar Status de Conexão
```bash
node backend/exemplo-uso.js 4
```

**Esperado:**
- ✅ Status da instância retornado
- ✅ Pode estar: `open`, `connecting`, ou `close`

---

### Teste 4: Webhook WhatsApp no n8n

**Teste manual no n8n:**
1. Abrir workflow "Fluxo WhatsApp Multi-Tenant"
2. Clicar no nó "Webhook WhatsApp"
3. Clicar "Test webhook"
4. Copiar payload de teste:
```json
{
  "event": "MESSAGES_UPSERT",
  "instance": "clinica-xxxxxxxx",
  "data": {
    "key": "5511999999999",
    "status": "RECEIVED",
    "message": {
      "body": "Olá, tudo bem?",
      "timestamp": 1690000000000,
      "fromMe": false
    }
  }
}
```
5. Clicar "Execute node"

**Esperado:**
- ✅ Webhook recebe payload
- ✅ Fluxo executa sem erros
- ✅ Mensagem é processada

---

### Teste 5: Webhook de Pagamento

**Testar manualmente:**
```bash
curl -X POST http://localhost:3000/webhooks/asaas \
  -H "Content-Type: application/json" \
  -d '{
    "event": "PAYMENT_CONFIRMED",
    "payment": {
      "id": "pay_123456",
      "value": 99.90,
      "externalReference": "clinica-550e8400-e29b-41d4-a716-446655440000",
      "confirmedDate": "2026-03-31T10:00:00Z"
    }
  }'
```

**Esperado:**
- ✅ Resposta HTTP 200
- ✅ Registro em `historico_pagamentos`
- ✅ Clínica reativada no Supabase

**Validar:**
```sql
SELECT * FROM historico_pagamentos ORDER BY created_at DESC LIMIT 1;
```

---

## 🔐 FASE 4: Segurança

### Isolamento Multi-Tenant
- [ ] Tabela `clinicas` tem `id` UUID como primary key
- [ ] Todas as tabelas filhas têm `clinica_id` FK
- [ ] RLS habilitado em `clinicas`, `dados_clinica`, `conversas`, `historico_pagamentos`
- [ ] Nenhuma query sem WHERE `clinica_id = @clinicaId`

**Validação:**
```sql
-- Verificar RLS ativado
SELECT tablename FROM pg_tables WHERE schemaname='public';
SELECT * FROM information_schema.table_constraints
WHERE constraint_type = 'FOREIGN KEY' AND table_name IN ('dados_clinica', 'conversas', 'historico_pagamentos');
```

---

### Credenciais
- [ ] `.env` não está no git (verificar `.gitignore`)
- [ ] `SUPABASE_SERVICE_KEY` usado APENAS no backend
- [ ] `SUPABASE_ANON_KEY` usado APENAS no frontend
- [ ] `ANTHROPIC_API_KEY` não exposto em logs
- [ ] `EVOLUTION_API_KEY` não hardcoded
- [ ] Todas as keys estão em variáveis de ambiente

**Validação:**
```bash
grep -r "sk-ant-" . --exclude-dir=node_modules --exclude-dir=.git
grep -r "SUPABASE_SERVICE_KEY" . --exclude-dir=node_modules --exclude-dir=.git
```

---

### URLs e Endpoints
- [ ] Webhook URLs usam HTTPS (em produção)
- [ ] Asaas webhook URL está configurado no painel
- [ ] n8n webhook URL está configurado na instância Evolution
- [ ] Backend Express acessível externamente (em produção)

---

## 📊 FASE 5: Validação de Dados

### Tabelas Existem
```sql
-- Executar no Supabase SQL Editor
SELECT
  tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

**Esperado:**
- clinicas
- conversas
- dados_clinica
- historico_pagamentos

---

### Função SQL Executa
```sql
-- Testar função de bloqueio
SELECT bloquear_clinicas_vencidas();

-- Testar função de reativação
SELECT reativar_clinica('550e8400-e29b-41d4-a716-446655440000'::uuid, 30);
```

**Esperado:**
- ✅ Sem erros de syntax
- ✅ Registros atualizados

---

### VIEW Calcula Corretamente
```sql
SELECT id, nome, status_acesso FROM clinicas_acesso LIMIT 5;
```

**Esperado:**
- Coluna `status_acesso` com valores: `liberado`, `trial_expirado`, `inadimplente`, `bloqueado`

---

## 🚀 FASE 6: Fluxo Completo

### Cenário 1: Clínica em Trial Funcional
```sql
-- Inserir teste
INSERT INTO clinicas (id, nome, instancia_evolution, prompt_agente, plano, trial_inicio, trial_dias, ativo)
VALUES (
  uuid_generate_v4(),
  'Clínica Teste',
  'clinica-teste',
  'Você é um assistente da clínica...',
  'trial',
  CURRENT_DATE,
  14,
  true
);

-- Verificar status
SELECT id, nome, status_acesso FROM clinicas_acesso WHERE nome = 'Clínica Teste';
-- Esperado: status_acesso = 'liberado'
```

---

### Cenário 2: Trial Expirado
```sql
-- Atualizar para trial expirado
UPDATE clinicas
SET trial_inicio = CURRENT_DATE - INTERVAL '20 days'
WHERE nome = 'Clínica Teste';

-- Verificar status
SELECT id, nome, status_acesso FROM clinicas_acesso WHERE nome = 'Clínica Teste';
-- Esperado: status_acesso = 'trial_expirado' (se trial_days <= 14)
```

---

### Cenário 3: Receber Mensagem WhatsApp
1. Abrir WhatsApp
2. Mandar mensagem para o número da clínica
3. Evolution API recebe mensagem
4. Webhook n8n processa
5. Claude gera resposta
6. Resposta enviada de volta via WhatsApp

**Validar:**
- [ ] Mensagem aparece na evolução API
- [ ] Webhook n8n foi chamado (ver logs)
- [ ] Histórico salvo no Supabase
- [ ] Resposta recebida no WhatsApp

---

## 📋 Checklist Final

- [ ] Todos os arquivos criados
- [ ] Banco de dados configurado
- [ ] Backend funciona (`npm start` sem erros)
- [ ] n8n workflow importado e ativo
- [ ] Webhook URL teste passa
- [ ] Evolution API acessível
- [ ] Claude API funciona
- [ ] Pagamentos webhook configurado
- [ ] Segurança validada
- [ ] Testes 1-5 passaram
- [ ] Fluxo completo funciona

---

## 🆘 Se Algo Não Funciona

### Erro: "Clínica não encontrada"
- [ ] Verificar se UUID da clínica está correto
- [ ] Verificar se clínica foi realmente criada:
  ```sql
  SELECT * FROM clinicas WHERE id = 'seu-uuid';
  ```

### Erro: "Connection refused" no Supabase
- [ ] Verificar SUPABASE_URL no `.env`
- [ ] Verificar SUPABASE_SERVICE_KEY é válida
- [ ] Testar conexão:
  ```bash
  npm install -g psql
  psql -h seu-projeto.supabase.co ...
  ```

### Erro: "Webhook não executa"
- [ ] Verificar URL do webhook no n8n (copiar exata)
- [ ] Verificar se a instância n8n está ativa
- [ ] Testar webhook manualmente (botão Test do n8n)
- [ ] Ver logs do n8n em "Executions"

### Erro: "Claude API error"
- [ ] Verificar API Key (começar com `sk-ant-`)
- [ ] Verificar se tem crédito na conta
- [ ] Testar:
  ```bash
  curl https://api.anthropic.com/v1/messages \
    -H "x-api-key: seu-key" \
    -H "anthropic-version: 2023-06-01" \
    -d '{"model":"claude-opus-4-6","max_tokens":100,"messages":[{"role":"user","content":"test"}]}'
  ```

### Erro: "Evolution API connection failed"
- [ ] Verificar EVOLUTION_API_URL (sem /webhook no final)
- [ ] Verificar API Key da Evolution
- [ ] Testar ping:
  ```bash
  curl -X GET "https://sua-evolution.com/instance/fetchInstances" \
    -H "apikey: sua_chave"
  ```

---

## 📞 Suporte

Documentação:
- Evolution API: https://evolution-api.readme.io/
- Supabase: https://supabase.com/docs
- n8n: https://docs.n8n.io
- Anthropic: https://docs.anthropic.com/

---

**Data de Criação:** 2026-03-31
**Última Verificação:** 2026-03-31
