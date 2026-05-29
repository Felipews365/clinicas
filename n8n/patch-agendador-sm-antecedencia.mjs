// Patch: adiciona secção "ANTECEDÊNCIA MÍNIMA" ao system message do agente_agendador
// para que, quando as RPCs devolverem ok:false / error:"antecedencia_minima", o bot
// responda com uma mensagem clara em vez de tentar de novo ou inventar horário.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

const ANCHOR = '\n\n## ERROS DE TOOL';
const NEW_BLOCK = `\n\n## ANTECEDÊNCIA MÍNIMA
Se \`agd_cs_agendar\`, \`agd_cs_reagendar\` ou \`agd_cs_cancelar\` devolver \`{ "ok": false, "error": "antecedencia_minima", "antecedencia_minutos": X }\`:
- Responda ao cliente: "Para esse horário precisa entrar em contacto directo com a clínica — pelo nosso sistema só consigo marcar / reagendar / cancelar com pelo menos {X} minutos de antecedência."
  - Substitua {X} pelo valor numérico devolvido em \`antecedencia_minutos\`. Se \`antecedencia_minutos\` for múltiplo de 60, pode dizer "{X/60} hora(s)" em vez de minutos.
- Adapte o verbo (marcar / reagendar / cancelar) à acção que o cliente tentou.
- NÃO tente outra vez com outro horário sem o cliente pedir.
- NÃO ofereça automaticamente outro horário próximo — pergunte ao cliente se quer ver outras opções mais tarde, ou orientar para contacto directo.`;

function patch(nodes, label) {
  const node = nodes.find(n => n.id === 'ma-agent-agendador');
  if (!node) { console.log(`[${label}] node not found`); return false; }
  const sm = node.parameters?.options?.systemMessage;
  if (typeof sm !== 'string') { console.log(`[${label}] no SM`); return false; }
  if (sm.includes('## ANTECEDÊNCIA MÍNIMA')) {
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
