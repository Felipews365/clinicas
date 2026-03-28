# Assistente Clínica Inteligente (n8n + Next + Supabase)

## 1. Webhook WhatsApp (URL)

No n8n, após importar e **ativar** o workflow, o trigger expõe:

`POST https://<SEU_HOST_N8N>/webhook/assistente-clinica-inteligente`

- **Evolution API:** na instância, webhook com esta URL e evento `MESSAGES_UPSERT`; no n8n, um **Code** no início mapeia o payload da Evolution para o JSON abaixo. Guia: [evolution-api-whatsapp.md](./evolution-api-whatsapp.md).
- **Meta WhatsApp Cloud API:** em *App → WhatsApp → Configuration*, o *Callback URL* aponta para o URL acima (ou para o teu proxy que reencaminha para o n8n). O Meta envia o payload deles; podes acrescentar um nó **Code** no início que mapeia `entry[0].changes[0].value.messages[0]` para o formato JSON esperado abaixo.
- **Twilio / outro:** igual — normaliza para o body esperado.

### Body esperado pelo workflow (exemplo)

```json
{
  "clinic_id": "uuid-da-clinica",
  "phone": "+5511999990000",
  "patient_name": "Maria",
  "message": "texto do utilizador"
}
```

O teu middleware WhatsApp deve resolver `clinic_id` (ex.: por número de telefone da clínica ou por `slug` na configuração).

## 2. API Next.js — revalidar painel

`POST https://<DOMÍNIO>/api/agendamentos-sync`

Cabeçalho **um** dos dois:

- `Authorization: Bearer <AGENDAMENTOS_SYNC_SECRET>`
- ou `x-agendamentos-sync-secret: <AGENDAMENTOS_SYNC_SECRET>`

Definir em `web/.env.local` (ver `.env.example`). Chamar este endpoint **sempre** que o n8n fizer INSERT/UPDATE em `appointments` ou em `whatsapp_sessions` (o workflow já inclui um nó HTTP de exemplo).

Variáveis úteis no n8n (ambiente):

- `AGENDAMENTOS_SYNC_SECRET` — igual ao `.env.local` do Next
- `NEXT_PUBLIC_APP_URL` — URL base da app (ex. `https://app.tudominio.com`)

## 3. Dashboard — “Assumir WhatsApp”

1. Executar `supabase/whatsapp_sessions.sql` no SQL Editor (o MCP do projeto pode estar só leitura; usa o ficheiro local).
2. No painel (**Agendamentos**), botão **WhatsApp humano** abre o modal com filas pendentes (`needs_human` e não `staff_handling`).
3. **Assumir WhatsApp** chama `POST /api/whatsapp/claim` com cookie de sessão e corpo `{ "session_id": "<uuid>" }`, marca `staff_handling: true` e `needs_human: false`, e faz `revalidatePath` no servidor.

## 4. Telegram / Twilio / OpenAI

- **Telegram:** no workflow, nó *Telegram dono* usa `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` como variáveis de ambiente no n8n. Podes trocar por **Send Email** ou **Slack**.
- **Twilio SMS:** adiciona após INSERT de `appointments` (nó oficial Twilio no n8n).
- **OpenAI Agent:** substitui ou antecede o nó *Responder dúvida* — ver *sticky note* no canvas do workflow.

## 5. Modelo Supabase (repo)

Tabelas reais: `clinics`, `professionals`, `patients`, `appointments`. Não há `cliente_nome`/`telefone` em `appointments`: o telefone está em `patients.phone`; o nome em `patients.name`. O workflow usa joins compatíveis com `schema.sql`.

Tabela extra: `whatsapp_sessions` (`needs_human`, `staff_handling`, `last_message_preview`).

## 6. Teste completo (checklist)

1. SQL: `whatsapp_sessions` aplicado; Postgres no n8n com user que consiga escrever (ligação directa `postgres` ao Supabase costuma contornar RLS).
2. Next: `AGENDAMENTOS_SYNC_SECRET` definido; `curl -X POST .../api/agendamentos-sync -H "Authorization: Bearer ..."` → `{ "ok": true }`.
3. n8n: importar `assistente-clinica-inteligente.json`, credenciais Postgres, env vars, **Activate**.
4. `curl -X POST https://<n8n>/webhook/assistente-clinica-inteligente -H "Content-Type: application/json" -d "{\"clinic_id\":\"...\",\"phone\":\"+5511...\",\"message\":\"falar com humano\"}"` → resposta JSON de escalação; ver linha em `whatsapp_sessions`.
5. Abrir painel → **WhatsApp humano** → **Assumir** → linha atualizada.
6. Agendamento: após implementares INSERT no fluxo, repetir `curl` com mensagem de agendar e confirmar SMS + sync.

## Ativar o workflow

No n8n: **Workflows** → abrir *Assistente Clinica Inteligente* → toggle **Active**. Sem ativar, o webhook não recebe tráfego público.
