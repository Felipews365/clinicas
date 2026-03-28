# Agente de atendimento clínica (prompt n8n-clinica_2)

Este pacote alinha o prompt **prompt-n8n-clinica_2.md** ao **Supabase já existente** no repo (`clinics`, `patients`, `appointments` ricos) **sem** duplicar a tabela `public.appointments`.

## Supabase

Execute no SQL Editor (após `schema.sql`):

- Ficheiro: [supabase/n8n_agent_chat_schema.sql](../supabase/n8n_agent_chat_schema.sql)

Tabelas criadas:

| Prompt original | Tabela no repo | Notas |
|-----------------|----------------|--------|
| `clients` | `chat_clients` | Upsert por `phone` |
| `sessions` | `chat_sessions` | `session_id` texto, `human_takeover`, `takeover_at` |
| `messages` | `chat_messages` | `role` user / assistant / human_agent |
| `appointments` | `chat_simple_appointments` | Modelo simples do agente; integrar depois com `appointments` reais se quiseres |

**Ligação opcional:** preenche `clinic_id` em `chat_clients` / `chat_simple_appointments` com o UUID da clínica (`$env.CLINIC_ID` no n8n).

## Variáveis de ambiente (n8n)

```env
CLINIC_ID=uuid-da-clinica
CLINIC_NAME=Nome da Clínica
IA_NAME=Luna
CLINIC_ADDRESS=Rua ...
CLINIC_HOURS=Seg–Sex 8h–18h
CLINIC_SPECIALTIES=Cardiologia, ...
CLINIC_INSURANCE=Unimed, ...
CLINIC_PHONE=...
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_VISION_MODEL=gpt-4o-mini
EVOLUTION_API_BASE=https://...
EVOLUTION_INSTANCE=...
EVOLUTION_API_KEY=...
CLINIC_OWNER_WHATSAPP=5511999990000
NEXT_APP_URL=https://...
AGENDAMENTOS_SYNC_SECRET=...
```

Credencial **Postgres** (connection string Supabase com utilizador que consiga `INSERT`/`UPDATE` nestas tabelas — costuma ser o `postgres` da base).

## Lógica de takeover (60 s)

1. `SELECT human_takeover, takeover_at FROM chat_sessions WHERE session_id = …`
2. Se `human_takeover` e `now() - takeover_at < 60s` → **não** chamar OpenAI nem enviar resposta automática (terminar execução).
3. Se `human_takeover` e passaram ≥ 60s → `UPDATE chat_sessions SET human_takeover = false, takeover_at = null` (ou manter `takeover_at` para auditoria) e continuar.
4. Se `[HUMANO_NECESSÁRIO]` na resposta → `UPDATE … SET human_takeover = true, takeover_at = now()` + notificar dono (HTTP Evolution para `CLINIC_OWNER_WHATSAPP`).

## System prompt (OpenAI)

O ficheiro JSON importável usa um **system prompt** encurtado + variáveis `CLINIC_*`. Para o texto **completo** do prompt (com `[QUEBRA]` e `[HUMANO_NECESSÁRIO]`), cola o bloco do teu ficheiro `prompt-n8n-clinica_2.md` no nó **HTTP OpenAI** ou move para `$env.AGENT_SYSTEM_PROMPT` (base64 ou ficheiro no host — cuidado com limite de tamanho).

## Multimodal

- **Áudio:** `HTTP download áudio` (cabeçalho `apikey` Evolution) → binário `data` → nó **OpenAI Whisper** (`multipart-form-data`, campo `file`). Se o multipart falhar na tua versão do n8n, recria o nó HTTP a partir do zero ou volta a definir o corpo como *Multipart*.
- **Imagem:** download com o mesmo cabeçalho → nó **Vision + fundir imagem** (Code com `this.helpers.httpRequest` para `chat/completions` e imagem em base64). Modelo: `OPENAI_VISION_MODEL` (padrão `gpt-4o-mini`).

A mensagem do utilizador em `chat_messages` é gravada **depois** do multimodal, com `current_message` já preenchido (transcrição ou descrição).

## Mensagens múltiplas (`[QUEBRA]`)

O nó **Enviar partes WhatsApp** (Code) envia cada bloco com `sendText`, com pausa aleatória **1,5–2,5 s** entre blocos (`1500 + Math.random() * 1000` ms), usando `this.helpers.httpRequest`.

## Workflow importável

- [agente-atendimento-clinica.json](./agente-atendimento-clinica.json)

Importar no n8n: **Workflows → Import from file**. Ativa o toggle **Active** manualmente (MCP `activate_workflow` pode falhar com 415).

## Webhook Evolution

URL após ativar: `POST https://<n8n>/webhook/agente-clinica-atendimento`

Configura na Evolution o evento `MESSAGES_UPSERT` com essa URL.

## Teste

1. Correr SQL do schema.
2. Importar JSON, credenciais Postgres, envs.
3. Mensagem de texto → deve gravar em `chat_messages` e responder no WhatsApp.
4. Mensagem com “humano” → `human_takeover` e alerta ao dono; nova mensagem dentro de 60 s → silêncio do bot; após 60 s → reset e bot volta.
