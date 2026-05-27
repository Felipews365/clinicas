// Patch: add guard in Enrich Agendador to skip runs without context (mensagem empty).
// Root cause: IF mensagem válida and HTTP Fetch Servicos both connect to Enrich Agendador.
// n8n 2.10.x runs the node TWICE — once per upstream trigger. When triggered by HTTP Fetch Servicos
// alone (no context item), ctx.mensagem is empty and the output has no mensagem field.
// agente_agendador then receives that item and throws "No prompt specified".
// Fix: return [] when ctx.mensagem is falsy (context-less run).

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

const GUARD_LINE = `// Guard: if no mensagem in context, this is a services-only run — skip to avoid empty prompt in agente_agendador
if (!ctx.mensagem) {
  return [];
}\n\n`;

let patchedNodes = 0;
for (const arr of [wf.nodes, wf.activeVersion?.nodes].filter(Boolean)) {
  const node = arr.find((n) => n.id === 'enrich-agendador-prefetch');
  if (!node) continue;

  const code = node.parameters.jsCode;

  // Insert guard right after ctx is set (after the line that assigns ctx)
  const anchor = 'let profBlock = \'\';\nlet servicosBlock = \'\';';
  if (!code.includes(GUARD_LINE)) {
    node.parameters.jsCode = code.replace(anchor, GUARD_LINE + anchor);
    patchedNodes++;
    console.log('Patched node:', node.name, '(id:', node.id + ')');
  } else {
    console.log('Guard already present in node:', node.name);
    patchedNodes++;
  }
}

if (patchedNodes === 0) {
  console.error('ERROR: enrich-agendador-prefetch not found in either nodes block!');
  process.exit(1);
}

writeFileSync(WF_PATH, JSON.stringify(wf, null, 2), 'utf8');
console.log(`Patched ${patchedNodes} occurrence(s). Saved to ${WF_PATH}`);
