# Clinica WhatsApp Completo

Workflow criado no n8n via API (ID: `DjVTf9Gi4rZGJCsu`). Nome: **Clinica WhatsApp Completo**.

## Usas Evolution API?

Este ficheiro descreve o fluxo com **WhatsApp Cloud (Meta)** nos nós nativos do n8n. Para Evolution, **importa** o workflow pronto: [clinica-whatsapp-completo-evolution.json](./clinica-whatsapp-completo-evolution.json) (nome: *Clinica WhatsApp Completo (Evolution API)*). Guia: [evolution-api-whatsapp.md](./evolution-api-whatsapp.md).

## Ativar o workflow

O MCP `activate_workflow` pode falhar com erro 415 (formato do pedido). **Ative manualmente** no n8n: abra o workflow e ligue o toggle **Active**.

> O WhatsApp Cloud só permite **um webhook por aplicação Meta**. Se outro workflow já usar o mesmo App, desative-o antes.

## URL de webhook (Callback URL no Meta)

1. Com o workflow **ativo**, abra o nó **WhatsApp Trigger**.
2. Copie a **Production Webhook URL** (ou Test URL para desenvolvimento).
3. No [Meta for Developers](https://developers.facebook.com/) → a sua **App** → **WhatsApp** → **Configuration** (ou Webhooks):
   - **Callback URL**: cole o URL do n8n.
   - **Verify token**: o **ID do nó** do WhatsApp Trigger (no n8n: clique no nó → copie o ID; neste import é `c1a00001-0001-4001-8001-000000000001` se não tiver sido alterado após import).

O n8n regista o webhook na Graph API quando o trigger é guardado/ativado (credenciais **WhatsApp Trigger API** obrigatórias).

## Configurar WhatsApp Business (resumo)

1. **Conta Meta Business** + **App** com produto **WhatsApp**.
2. **WhatsApp Business Account** e **número** de telefone de teste ou produção.
3. Em **API Setup**, obtenha o **Phone number ID** (use na variável `WHATSAPP_PHONE_NUMBER_ID` ou escolha o número nas credenciais do nó de envio).
4. **Access Token** com permissões `whatsapp_business_messaging`, etc.
5. No n8n:
   - Credencial **WhatsApp Trigger API** (App ID, App Secret, etc., conforme [documentação n8n](https://docs.n8n.io/integrations/builtin/credentials/whatsapp/)).
   - Credencial **WhatsApp Business Cloud** (envio) para os nós *WA …*.
6. **Subscrição de webhook** no Meta: objeto `whatsapp_business_account`, campo `messages` (o trigger do n8n faz isto ao ativar).

## Variáveis de ambiente no n8n

| Variável | Uso |
|----------|-----|
| `CLINIC_ID` | UUID da clínica no Supabase |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número que **envia** (Cloud API) |
| `CLINIC_OWNER_WHATSAPP` | WhatsApp do dono (só dígitos, ex. `5511999990000`) para alertas |
| `NEXT_APP_URL` ou `NEXT_PUBLIC_APP_URL` | Base da app Next (ex. `https://app.seudominio.com`) |
| `AGENDAMENTOS_SYNC_SECRET` | Igual ao `AGENDAMENTOS_SYNC_SECRET` do Next |
| `OPENAI_API_KEY` | Dúvidas (HTTP Chat Completions) |
| `OPENAI_CHAT_MODEL` | Opcional (default `gpt-4o-mini`) |

## Supabase

1. Executar `supabase/whatsapp_sessions.sql` (se ainda não existir a tabela).
2. Executar `supabase/whatsapp_sessions_manual_numero.sql` se a tabela já existir sem as colunas `manual` e `numero_cliente`.

Ligação **Postgres** no n8n: credencial **Supabase Postgres** (como nos outros workflows).

## Teste (execute_workflow / webhook)

Este fluxo **não** usa o nó *Webhook* genérico: o gatilho é **WhatsApp Trigger**. O MCP `run_webhook` **não** dispara este workflow.

Testes possíveis:

- **Executar nó** no editor (dados fixos) ou enviar mensagem real do WhatsApp para o número da clínica.
- **Painel Meta** → WhatsApp → API → enviar mensagem de teste (se disponível).

## OpenAI Agent + memória

A classificação inicial está em **Code** (`Parse e classificar`) para robustez. Para **OpenAI Agent** com memória por conversa, substitua por: **AI Agent** + **OpenAI Chat Model** + **Window Buffer Memory** (session key = `wa_id`), saída JSON com `intencao`, ligando ao nó **E pedido humano?** / **Switch intencao**. Instruções no sticky **Notas** dentro do canvas.

## Próximo passo: INSERT agendamento + slots

O ramo **Agendamento** lista profissionais e pede dados. Para **slots livres** e **INSERT** em `patients` + `appointments`, reutilize a lógica do workflow **Clínica - Atendimento Inteligente com Supabase** (webhook `clinica-atendimento`) e acrescente **HTTP Sync** após cada escrita.
