# Assistente Clínica Completo (n8n)

## MCP n8n no Cursor (projeto)

No repositório existe `.cursor/mcp.json` com o servidor **`@leonardsellem/n8n-mcp-server`** (comunidade, não oficial n8n).

1. No n8n: **Settings → API** → cria uma **API Key**.
2. Edita `.cursor/mcp.json` → em `n8n.env`, preenche **`N8N_API_KEY`** com essa chave.
3. Ajusta **`N8N_API_URL`** se o n8n não for em `http://localhost:5678` (tem de terminar em **`/api/v1`**).
4. Webhooks com Basic Auth: opcionalmente define `N8N_WEBHOOK_USERNAME` e `N8N_WEBHOOK_PASSWORD` no mesmo bloco `env`.
5. **Reinicia o Cursor** e confere **Settings → Tools & MCP** (servidor `n8n`).

**Não commits a API key.** Se usares Git, considera variáveis só na UI do Cursor (editar MCP sem gravar a chave no ficheiro) ou um `mcp.json` local ignorado pelo Git.

Ferramentas úteis deste MCP (exemplos): listar workflows, ativar/desativar, criar/atualizar workflow, executar via API ou `run_webhook`. Ver [npm](https://www.npmjs.com/package/@leonardsellem/n8n-mcp-server).

---

## Limite / fluxo manual

Mesmo com MCP, o **URL exato** de cada webhook continua a ser copiado **no nó Webhook** do n8n após gravar/ativar. O ficheiro `assistente-clinica-completo.json` desta pasta serve para **importar** o workflow no n8n.

## Como obter o WEBHOOK URL

1. n8n → **Workflows** → **Import from File** → escolhe `assistente-clinica-completo.json`.
2. Abre o nó **Webhook** → confirma método **POST** e path `assistente-clinica-completo`.
3. **Grava** o workflow (Save).
4. Clica **Active** (interruptor no canto).
5. No nó Webhook, copia a **Production URL** ou **Test URL**, por exemplo:
   - Self-hosted: `https://SEU-N8N/webhook/assistente-clinica-completo`
   - n8n Cloud: `https://SEU-SUBDOMAIN.app.n8n.cloud/webhook/assistente-clinica-completo`

**Test URL** só funciona com o editor a escutar (“Listen for test event”).

## Body esperado (teste rápido)

```json
{
  "clinic_id": "UUID-DA-CLINICA",
  "phone": "+5511999990000",
  "patient_name": "Maria",
  "message": "Quero agendar uma consulta amanhã de manhã"
}
```

Troca `intent` conforme a mensagem (o nó **Classificar intenção (Code)** usa palavras-chave). Para produção, substitui esse nó por um **AI Agent** (LangChain) + memória.

## O que o JSON base já faz

| Passo | Nó |
|--------|-----|
| Entrada | Webhook POST |
| Normalizar | `clinic_id`, `phone`, `patient_name`, `message` |
| Intenção | Code: `schedule` / `cancel` / `reschedule` / `info` |
| Switch | 4 saídas |
| Agendar | Postgres: lista `professionals` ativos da clínica |
| Cancelar | Postgres: lista `appointments` agendados do telefone |
| Respostas | Respond to Webhook (JSON) |

## O que tens de completar no n8n (requisitos originais)

1. **WhatsApp** — Meta Cloud API (ou Twilio WhatsApp) como **trigger** à parte: o fluxo típico é *WhatsApp → HTTP Request para este webhook* com `message`, `phone`, `clinic_id`. O n8n também tem nós oficiais WhatsApp conforme a tua conta.
2. **Telegram** — Trigger **Telegram** → **Set** para mapear `message.text` e `message.from` → mesmo webhook (ou liga os nós em sequência sem webhook).
3. **OpenAI / Groq Agent + memória** — Adiciona o pacote **@n8n/n8n-nodes-langchain**: nó **AI Agent**, modelo OpenAI ou **Chat Groq**, **Window Buffer Memory** (ou Redis). Entrada: texto do cliente; saída: JSON com `intent`, `specialty`, `slot`, etc. Liga a um **Switch** em vez do nó Code.
4. **Slots livres** — Exige lógica de negócio (horário da clínica, duração, exclusão de `appointments` com overlap). Usa **Code** ou **Function** após queries Postgres/REST.
5. **INSERT agendamento** — Reutiliza a lógica de `consultorio-agendar-webhook.json` (upsert `patients` + insert `appointments`). Usa **service_role** ou Postgres com connection string (ver `supabase-mapeamento-n8n.md`).
6. **SMS (Twilio)** — Nó **Twilio** após insert com sucesso (corpo curto com data/hora).
7. **Email / Slack** — Nós **Send Email** (SMTP) ou **Slack** para notificar o profissional.
8. **Reagendamento** — Após listar marcações, segundo passo (outro webhook ou estado em Redis) para o cliente escolher índice e aplicar `UPDATE` em `appointments`.

## Segurança

- **Nunca** uses `service_role` no browser; só no n8n (credenciais).
- Valida `clinic_id` (fixo por instância ou por token) para não cruzar dados de clínicas.

## Ativar

Sem **Active ON**, o webhook de produção não corre. Sempre **Save** antes de testar o URL de produção.

## Se o Postgres não devolver linhas

Se **Listar profissionais** ou **Listar marcações** devolver zero linhas, algumas versões do n8n **não ligam** o nó seguinte. Nesse caso, no nó Postgres ativa **Always Output Data** (opções do nó).

## Ficheiro do workflow

- `assistente-clinica-completo.json` — importar no n8n.
