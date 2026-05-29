// Patch: adiciona regra no system message do agente_agendador proibindo o uso
// de horários vindos da MEMÓRIA da conversa. Antes de listar qualquer horário
// (agendamento ou reagendamento) o agente DEVE chamar agd_cs_consultar_vagas
// para a data alvo — horários listados em mensagens anteriores podem já ter
// passado (são listas antigas, não verdades actuais).

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

const ANCHOR = '\n\n## INÍCIO DA MENSAGEM — PROIBIDO PREÂMBULO';
const NEW_BLOCK = `\n\n## HORÁRIOS — PROIBIDO USAR MEMÓRIA
NUNCA liste horários disponíveis com base em mensagens anteriores da conversa. Horários listados antes podem JÁ TER PASSADO (ex.: às 14h o sistema mostrou "14:00, 14:30, 16:00, 17:30"; às 17:08 só "17:30" continua válido).

Regra absoluta:
- ANTES de listar qualquer horário ao cliente (seja para agendar OU reagendar), chame SEMPRE \`agd_cs_consultar_vagas\` com a data alvo e o \`profissional_id\` escolhido.
- Use APENAS os horários que essa chamada acabou de devolver. Ignore qualquer lista de horários que apareça no histórico da conversa.
- Vale especialmente para reagendamento: o cliente já agendou antes → o histórico TEM horários antigos → não os reuse.

❌ ERRADO (sem chamar a tool, copiou da memória):
"Os horários disponíveis para hoje são: 14:00, 14:30, 16:00, 17:30"
(quando já são 17:08 — 14:00/14:30/16:00 já passaram)

✅ CORRETO (chama agd_cs_consultar_vagas → usa só o resultado fresh):
"Para hoje temos 17:30, 18:00 e 18:30. Qual prefere?"`;

function patch(nodes, label) {
  const node = nodes.find(n => n.id === 'ma-agent-agendador');
  if (!node) { console.log(`[${label}] node not found`); return false; }
  const sm = node.parameters?.options?.systemMessage;
  if (typeof sm !== 'string') { console.log(`[${label}] no SM`); return false; }
  if (sm.includes('## HORÁRIOS — PROIBIDO USAR MEMÓRIA')) {
    console.log(`[${label}] already patched`);
    return false;
  }
  if (!sm.includes(ANCHOR)) {
    console.log(`[${label}] anchor not found`);
    return false;
  }
  node.parameters.options.systemMessage = sm.replace(ANCHOR, NEW_BLOCK + ANCHOR);
  console.log(`[${label}] patched (len ${sm.length} → ${node.parameters.options.systemMessage.length})`);
  return true;
}

const t = patch(wf.nodes || [], 'top');
const a = patch(wf.activeVersion?.nodes || [], 'av');

if (t || a) {
  writeFileSync(WF_PATH, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  console.log('Saved.');
} else {
  console.log('No changes.');
}
