// Patch: restaura o prefixo `=` no systemMessage do node `agente_atende_qualifica`.
// Sem o `=`, o n8n trata a string como literal e o LLM recebe `{{ $json.xxx }}` como texto.
// O bug fez o bot responder ao cliente com `Olá, {{ $json.nome_cliente_primeiro || '-' }}!`.
// Também sincroniza o SM do `activeVersion.nodes[]` com o texto top-level.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

function ensureEquals(nodes, label) {
  const node = nodes.find(n => n.name === 'agente_atende_qualifica');
  if (!node) { console.log(`[${label}] node not found`); return null; }
  const sm = node.parameters?.options?.systemMessage;
  if (typeof sm !== 'string') { console.log(`[${label}] systemMessage missing`); return null; }
  if (sm.startsWith('=')) {
    console.log(`[${label}] already has = prefix (len=${sm.length})`);
    return sm;
  }
  node.parameters.options.systemMessage = '=' + sm;
  console.log(`[${label}] prefixed with =, new len=${node.parameters.options.systemMessage.length}`);
  return node.parameters.options.systemMessage;
}

const topSm = ensureEquals(wf.nodes || [], 'top');

// Sincronizar activeVersion com o texto top-level (regra do CLAUDE.md: ambos juntos)
if (topSm && wf.activeVersion?.nodes) {
  const avNode = wf.activeVersion.nodes.find(n => n.name === 'agente_atende_qualifica');
  if (avNode) {
    const before = avNode.parameters?.options?.systemMessage;
    if (before !== topSm) {
      avNode.parameters.options.systemMessage = topSm;
      console.log(`[av] systemMessage replaced to match top (was len=${before?.length}, now len=${topSm.length})`);
    } else {
      console.log('[av] already matches top');
    }
  } else {
    console.log('[av] node not found');
  }
}

writeFileSync(WF_PATH, JSON.stringify(wf, null, 2) + '\n', 'utf8');
console.log('Done.');
