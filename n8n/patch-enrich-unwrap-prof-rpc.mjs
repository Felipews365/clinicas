// Patch: Enrich Agendador deve desempacotar o wrapper `{n8n_cs_profissionais_para_agente: [...]}`
// quando a RPC devolve um objecto único (em vez de array fragmentado pelo n8n).
// Sem este patch, `profs` fica vazio, `mapaBlock` não é gerado, e o agendador cai na memória de chat.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

const OLD = `const httpProfArr = Array.isArray(ctx._httpProf) ? ctx._httpProf : (ctx._httpProf ? [ctx._httpProf] : []);
  profs = httpProfArr.filter(p => p && p.id && p.nome);`;

const NEW = `let httpProfArr = Array.isArray(ctx._httpProf) ? ctx._httpProf : (ctx._httpProf ? [ctx._httpProf] : []);
  // Caso 1 (n8n fragmentou): [{id, nome, ...}, ...] — usar direto.
  // Caso 2 (RPC devolveu objecto wrapper): [{n8n_cs_profissionais_para_agente: [...]}] — desempacotar 1 nível.
  if (httpProfArr.length === 1 && httpProfArr[0] && typeof httpProfArr[0] === 'object' && !httpProfArr[0].id && !httpProfArr[0].nome) {
    for (const v of Object.values(httpProfArr[0])) {
      if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object' && (v[0].id || v[0].nome)) {
        httpProfArr = v;
        break;
      }
    }
  }
  profs = httpProfArr.filter(p => p && p.id && p.nome);`;

function patch(nodes, label) {
  const node = nodes.find(n => n.id === 'enrich-agendador-prefetch');
  if (!node) { console.log(`[${label}] node not found`); return false; }
  const code = node.parameters?.jsCode;
  if (typeof code !== 'string') { console.log(`[${label}] jsCode missing`); return false; }
  if (code.includes('Caso 2 (RPC devolveu objecto wrapper)')) {
    console.log(`[${label}] already patched`);
    return false;
  }
  if (!code.includes(OLD)) {
    console.log(`[${label}] OLD snippet not found — refusing to patch`);
    return false;
  }
  node.parameters.jsCode = code.replace(OLD, NEW);
  console.log(`[${label}] patched (len ${code.length} → ${node.parameters.jsCode.length})`);
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
