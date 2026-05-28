// Patch: adiciona regra no topo do system message do agente_agendador proibindo
// preâmbulos do tipo "vou verificar", "um momento", "deixa eu checar" no INÍCIO da
// mensagem, mesmo quando seguidos de informação útil.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

const ANCHOR = '\n\n## REGRA OBRIGATÓRIA — LISTAGEM COMPLETA';
const NEW_BLOCK = `\n\n## INÍCIO DA MENSAGEM — PROIBIDO PREÂMBULO
A PRIMEIRA frase da sua resposta ao cliente NUNCA pode ser:
- "Vou verificar..." / "Vou consultar..." / "Vou buscar..." / "Vou checar..."
- "Um momento" / "Aguarde" / "Um instante" / "Só um momento"
- "Deixa eu ver" / "Deixa eu verificar" / "Deixa eu checar"
- Qualquer outra frase que descreva o que você está prestes a fazer.

Vá DIRETO ao conteúdo. Esta regra vale mesmo se a frase for seguida pela informação correta na mesma mensagem — o preâmbulo é proibido em qualquer caso.

❌ ERRADO: "Para agendar a limpeza, vou verificar os profissionais. Um momento. Os profissionais são: ..."
✅ CORRETO: "Para limpeza, temos: Dr. Herick, Dra. Maria Letícia, jose. Com qual prefere?"

❌ ERRADO: "Deixa eu consultar os horários. Tenho 10h, 11h, 14h."
✅ CORRETO: "Para essa data temos 10h, 11h e 14h. Qual prefere?"`;

function patch(nodes, label) {
  const node = nodes.find(n => n.id === 'ma-agent-agendador');
  if (!node) { console.log(`[${label}] node not found`); return false; }
  const sm = node.parameters?.options?.systemMessage;
  if (typeof sm !== 'string') { console.log(`[${label}] no SM`); return false; }
  if (sm.includes('## INÍCIO DA MENSAGEM — PROIBIDO PREÂMBULO')) {
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
