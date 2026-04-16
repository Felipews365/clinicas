# CLAUDE.md — Consultório 2026

## Papel
Criar, manter e evoluir workflows n8n + banco de dados Supabase para o sistema de atendimento via WhatsApp de clínicas.

---

## Instâncias e acesso

| Serviço | URL |
|---|---|
| n8n Editor (UI) | https://editor.docker-script7.com.br |
| n8n API | https://n8n.vps7846.panel.icontainer.cloud/api/v1 |
| Supabase | Usar MCP `mcp__supabase__*` (projeto já configurado) |

- **n8n API Key**: guardada em memória (`reference_n8n_api.md`)
- Para subir workflow via API usar `PUT /api/v1/workflows/{id}` com payload contendo apenas `name`, `nodes`, `connections`, `settings.executionOrder`, `staticData`
- O workflow principal é o `kCX2LfxJrdYWB0vk` (`workflow-kCX2-live.json`)

---

## Estrutura do projeto

```
n8n/
  workflow-kCX2-live.json   ← workflow principal (sempre manter sincronizado com n8n)
supabase/
  migrations/               ← todas as migrations SQL versionadas
web/
  src/                      ← painel web (Next.js)
```

---

## Regras de desenvolvimento

### Workflow n8n
- O arquivo `workflow-kCX2-live.json` tem **dois blocos** de nodes: `nodes[]` (top-level) e `activeVersion.nodes[]` — ambos devem ser atualizados juntos
- Após editar o JSON local, sempre subir via API (não copiar/colar na UI)
- Workflow tem dois agentes AI idênticos (`AI Agent` e cópia em `activeVersion`) — manter ambos sincronizados

### Supabase / Banco
- Toda alteração de schema via `mcp__supabase__apply_migration` E criar arquivo `.sql` em `supabase/migrations/`
- Nomear migrations: `YYYYMMDDHHMMSS_descricao_snake_case.sql`
- RPCs usadas pelo agente n8n: prefixo `n8n_cs_*`

### Serviços (dual-source)
- O painel v2 salva procedimentos em `clinic_procedures` (campos: `id`, `name`, `clinic_id`)
- O legado usa `cs_servicos` (campos: `id`, `nome`, `clinic_id`)
- A RPC `n8n_cs_agendar` tenta `clinic_procedures` primeiro; se não achar, tenta `cs_servicos`
- Quando o serviço vem de `clinic_procedures`, `cs_agendamentos.servico_id` fica **NULL** (sem FK entre as tabelas) — o nome é preservado em `nome_procedimento`
- `cs_agendamentos.servico_id` é **nullable** por design — não adicionar NOT NULL nessa coluna

### Multi-tenant (SaaS)
- Cada clínica é um **tenant** isolado identificado por `clinic_id` (UUID)
- A clínica é resolvida a partir do `instance_name` da Evolution API → tabela `clinics`
- **Toda query ao banco DEVE incluir `clinic_id`** para garantir isolamento entre clínicas
- Cada clínica tem sua própria configuração em `clinics.agent_instructions` (JSON):
  - `nome_agente`: nome do assistente virtual da clínica
  - `saudacao_novo`: template de boas-vindas para cliente novo
  - `saudacao_retorno`: template de boas-vindas para cliente de retorno
  - `identidade`, `triagem`, `tom`, `orientacoes`, `transferir`, `outros`: instruções específicas
- `cs_clientes`, `cs_agendamentos`, slots, serviços, profissionais — tudo filtrado por `clinic_id`
- Ao criar RPCs novas, sempre receber `p_clinic_id uuid` como primeiro parâmetro

### Agente WhatsApp (fluxo resumido)
1. Webhook recebe mensagem → `Campos iniciais` extrai dados
2. `Code merge webhook e resolucao` resolve `clinica_id` pelo `instance_name`
3. `Get Empresa` busca dados da clínica (incluindo `agent_instructions`)
4. `Get Cliente` busca cliente por `clinic_id` + `telefone`
5. `Verificar se cliente está cadastrado`: se não existe → `Create Cliente` com `nome = ''`
6. `Bot inativo` verifica se atendimento humano assumiu
7. Fila Redis (debounce 6s) agrupa mensagens rápidas
8. `Monta Contexto` monta payload para o AI Agent:
   - injeta `clinic_name`, `nome_agente`, `agent_instructions`, `saudacao_novo/retorno`
   - `nome_cliente` vazio = cliente novo → agente pergunta o nome
   - `nome_cliente` preenchido = cliente de retorno → agente saúda pelo nome
9. AI Agent responde usando tools RPC do Supabase (todas recebem `p_clinic_id`)
10. Resposta enviada via Evolution API (WhatsApp)

### Tools do AI Agent
| Tool | RPC / Destino |
|---|---|
| `cs_salvar_nome` | `n8n_cs_salvar_nome` — salva nome confirmado pelo cliente |
| `cs_consultar_servicos` | lista procedimentos |
| `cs_consultar_profissionais` | lista profissionais |
| `cs_consultar_vagas` | horários disponíveis |
| `cs_agendar` | cria agendamento — retorna `profissional_whatsapp` |
| `cs_buscar_agendamentos` | consulta agendamentos do cliente |
| `cs_reagendar` | reagenda — retorna `profissional_whatsapp` |
| `cs_cancelar` | cancela — retorna `profissional_whatsapp` |
| `cs_notificar_profissional` | Evolution API — envia WhatsApp ao profissional |

### Notificação de profissionais
- Após `cs_agendar`, `cs_reagendar` ou `cs_cancelar`, o agente chama `cs_notificar_profissional` se `profissional_whatsapp` não for nulo
- O `profissional_whatsapp` vem das RPCs via `LEFT JOIN professionals ON cs_profissional_id = cs_profissionais.id`
- O campo `professionals.whatsapp` é cadastrado no painel web (componente `professionals-manager-modal.tsx`)
- Se o profissional não tiver WhatsApp cadastrado, `profissional_whatsapp` retorna `null` e a notificação é pulada silenciosamente
- O tool `cs_notificar_profissional` usa a mesma `instanceName` da clínica (Evolution API)

### Identificação de cliente novo vs retorno
- `cs_clientes.nome` = vazio (`''`) → nunca confirmou o nome → **cliente novo**
- `cs_clientes.nome` = preenchido → nome confirmado via `cs_salvar_nome` → **cliente de retorno**
- `Create Cliente` sempre cria com `nome = ''` (DEFAULT `''` no banco)
- NÃO salvar `pushName` do WhatsApp como nome — é nome do WhatsApp, não confirmado
