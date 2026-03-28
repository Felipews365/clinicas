# Assistente Clínica Premium + Edit Fields

Workflow criado no n8n via MCP.

- **ID atual (v2):** `GjSnS6ktwY8RMTb9`
- **Webhook (Evolution):** `POST https://<n8n>/webhook/assistente-clinica-premium-v2`
- O workflow duplicado `Ns3jyoSVQWLiwDvv` foi **removido** (ficou corrompido após um update parcial).

## Sequência de nós

1. **Webhook Premium** — recebe o payload da Evolution (`MESSAGES_UPSERT` ou corpo JSON equivalente).
2. **Edit Fields** (Set) — `payload_bruto`, `evento`.
3. **Limpar e normalizar** (Code) — extrai `wa_id`, `cliente_telefone`, `mensagem_limpa` (trim, lowercase, emojis repetidos colapsados), `tipo_media` (`texto` | `imagem` | `audio`), `media_url`, `formato_exibicao`.
4. **É áudio?** → placeholder (substituir por download + Whisper) → **Unir ramos**
5. **É imagem?** → **Vision se imagem** (GPT-4o) → **Merge Vision no texto** → **Unir ramos**  
   ou **Pass só texto** → **Unir ramos**
6. **GPT-4o classificar** — JSON `intencao`: `duvida|agendar|cancelar|reagendar|humano|novo_cliente`
7. **Parse intenção + contexto** — junta resposta OpenAI ao item normalizado.
8. **É humano?** — sim: WA dono → Postgres `whatsapp_sessions` → sync → **Wait 1 min** → WA cliente “volta IA”; não: **GPT-4o responder** → WA cliente.

## Variáveis de ambiente

`CLINIC_ID`, `EVOLUTION_API_BASE`, `EVOLUTION_INSTANCE`, `EVOLUTION_API_KEY`, `CLINIC_OWNER_WHATSAPP`, `OPENAI_API_KEY`, `OPENAI_AGENT_MODEL` (opcional, default gpt-4o), `OPENAI_VISION_MODEL`, `NEXT_APP_URL` ou `NEXT_PUBLIC_APP_URL`, `AGENDAMENTOS_SYNC_SECRET`.

## OpenAI “Agent”

O fluxo usa **duas chamadas HTTP** Chat Completions (classificar + responder) com personalidade no system prompt, em vez do nó LangChain **AI Agent** (memória/tools). Para Agent real, substitui **GPT-4o classificar** / **GPT-4o responder** por **AI Agent** + modelo + **Window Buffer Memory** (`sessionId` = `wa_id`).

## Multimodal

- **Imagem:** `media_url` tem de ser URL acessível pela API OpenAI.
- **Áudio:** hoje é placeholder; encadear HTTP GET do ficheiro + `POST /v1/audio/transcriptions` e gravar o texto em `mensagem_limpa` antes de **Unir ramos**.

## Wait 1 minuto

Em **n8n Cloud** / filas, o nó **Wait** precisa de URL de retoma. Se não configurares, testa com **Wait** em segundos ou remove o nó até teres resume.

## Ativar

No editor do n8n, toggle **Active**. O MCP `activate_workflow` pode falhar (415) — ativa manualmente.
