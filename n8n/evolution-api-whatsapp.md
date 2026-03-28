# WhatsApp com Evolution API (n8n)

## Workflow pronto no repositório

Importa no n8n: **[clinica-whatsapp-completo-evolution.json](./clinica-whatsapp-completo-evolution.json)** — já traz **Webhook** + **Parse Evolution** + **HTTP Request** para `sendText` no lugar dos nós Meta.

---

Se usas **Evolution API** em vez do WhatsApp Business Cloud (Meta), **não uses** os nós nativos **WhatsApp Trigger** e **WhatsApp Business Cloud** do n8n. Usa:

1. **Webhook** (n8n) para receber eventos da Evolution  
2. **HTTP Request** para enviar mensagens (`POST /message/sendText/{instance}`)

Documentação oficial Evolution: [Webhooks](https://doc.evolution-api.com/v2/en/configuration/webhooks) · [Send text](https://doc.evolution-api.com/v2/api-reference/message-controller/send-text)

---

## 1. URL que colocas na Evolution

1. No n8n, cria (ou duplica) o fluxo com um nó **Webhook**:
   - Método: **POST**
   - Path: por exemplo `evolution-clinica` (URL final: `https://<teu-n8n>/webhook/evolution-clinica`)
   - **Response**: pode ser *Immediately* com `200` e corpo vazio, ou *When last node finishes* se quiseres devolver JSON (a Evolution só precisa de HTTP 200 na maioria dos casos).

2. Na Evolution, regista o webhook da instância (ex.: `POST /webhook/instance` com o teu payload) com:
   - `url`: URL completa do webhook n8n  
   - `events`: inclui **`MESSAGES_UPSERT`** (mensagens recebidas)  
   - Opcional: `webhook_by_events: true` e então usas o path `.../messages-upsert` na URL base que a doc indica.

3. **Ignora** a configuração de webhook no Meta Developer Console — isso é só para Cloud API. A Evolution fala com o teu servidor Evolution; o teu servidor chama o n8n.

---

## 2. Variáveis de ambiente (n8n)

| Variável | Exemplo | Uso |
|----------|---------|-----|
| `EVOLUTION_API_BASE` | `https://evolution.seudominio.com` | URL base da Evolution (sem barra final) |
| `EVOLUTION_INSTANCE` | `clinica` | Nome da instância (path `{instance}`) |
| `EVOLUTION_API_KEY` | (global apikey) | Cabeçalho `apikey` nos pedidos de envio |
| `CLINIC_ID` | UUID | Igual ao fluxo atual (Supabase) |
| `CLINIC_OWNER_WHATSAPP` | `5511999990000` | Número do dono (só dígitos, país + DDD + número) |

Remove a dependência de `WHATSAPP_PHONE_NUMBER_ID` nos envios; o “remetente” é a sessão Evolution já ligada ao número da clínica.

---

## 3. Nó **Code** — normalizar payload (receção)

O corpo varia com a versão da Evolution e com `webhook_by_events`. Usa **Executar nó** uma vez com uma mensagem real e ajusta os caminhos. Ponto de partida que costuma funcionar em **v2**:

```javascript
const root = $json.body ?? $json;

function jidToDigits(jid) {
  if (!jid || typeof jid !== 'string') return '';
  const user = jid.split('@')[0];
  return user.split(':')[0].replace(/\D/g, '');
}

function extractText(m) {
  if (!m || typeof m !== 'object') return '';
  if (m.conversation) return String(m.conversation);
  if (m.extendedTextMessage?.text) return String(m.extendedTextMessage.text);
  if (m.imageMessage?.caption) return String(m.imageMessage.caption);
  return '';
}

// evento messages.upsert: muitas vezes em root.data (objeto ou array)
let payload = root.data ?? root;
if (Array.isArray(payload)) payload = payload[0];
const key = payload.key ?? payload?.message?.key;
const fromMe = key?.fromMe === true;
if (fromMe) {
  return []; // não responder às próprias mensagens da clínica
}

const remoteJid = key?.remoteJid || payload.remoteJid || '';
const waDigits = jidToDigits(remoteJid);
const e164 = waDigits ? `+${waDigits}` : '';
const msgObj = payload.message ?? payload;
const body = extractText(msgObj).trim();
const pushName = payload.pushName || payload.notifyName || '';

const clinicId = $env.CLINIC_ID || '';

let intencao = 'duvida';
const lower = body.toLowerCase();
if (/falar com|humano|atendente|operador|pessoa real|falar com algu[eé]m|quero um humano/.test(lower)) intencao = 'humano';
else if (/cancelar|desmarcar|anular/.test(lower)) intencao = 'cancelamento';
else if (/reagendar|remarcar|mudar/.test(lower)) intencao = 'reagendamento';
else if (/agendar|marcar|consulta|vaga|hor[aá]rio|dispon[ií]vel|especialidade/.test(lower)) intencao = 'agendamento';

return [{
  json: {
    wa_id: waDigits,
    e164,
    message_text: body,
    clinic_id: clinicId,
    intencao,
    patient_hint: pushName,
    evolution_remote_jid: remoteJid,
  },
}];
```

Liga a saída deste nó ao mesmo **IF / Switch** que já tens no fluxo “Clínica WhatsApp Completo” (substituindo o nó “Parse e classificar” que lia o formato Meta).

---

## 4. Enviar texto (substituir nós “WhatsApp”)

Para cada envio, usa **HTTP Request**:

- **Method:** POST  
- **URL:** `={{ $env.EVOLUTION_API_BASE }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}`  
- **Headers:**  
  - `apikey`: `={{ $env.EVOLUTION_API_KEY }}`  
  - `Content-Type`: `application/json`  
- **Body (JSON):**

```json
{
  "number": "={{ $json.wa_id }}",
  "text": "Texto da resposta aqui"
}
```

Quando o número veio do item anterior como `wa_id` só com dígitos, corresponde ao que a Evolution espera na maioria dos setups. Se a tua instância exigir `@s.whatsapp.net`, monta o JID a partir do `evolution_remote_jid` guardado no Parse.

**Cliente:** `number` = `{{ $('Parse Evolution').first().json.wa_id }}` (ou nome do teu nó Parse).  
**Dono:** `number` = `{{ $env.CLINIC_OWNER_WHATSAPP }}` (só dígitos).

---

## 5. Checklist rápido

- [ ] Webhook n8n público (HTTPS) acessível pela Evolution  
- [ ] Evento `MESSAGES_UPSERT` ativo; ignorar `fromMe` no Code  
- [ ] Todos os nós de envio Meta substituídos por **HTTP Request** + `apikey`  
- [ ] `CLINIC_ID`, Postgres e `POST /api/agendamentos-sync` iguais ao fluxo atual  

---

## 6. Comunidade / nó pronto

Existe pacote comunitário **n8n + Evolution** (ex.: [NCNodes / Evolution](https://ncnodes.com/package/n8n-nodes-evolution-api-en/evolutionapi/Event:Webhook)) se preferires nós dedicados em vez de Webhook + HTTP manual — a lógica (eventos, `apikey`, instância) é a mesma.
