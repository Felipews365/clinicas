// Patch: corrige strings JS multi-linha quebradas no systemMessage do agente_atende_qualifica.
// As linhas finais do SM tinham `'## TRIAGEM\n' + ...` com newline literal dentro de aspas simples,
// o que é syntax error em JS. Substituir por \\n (backslash-n) dentro da string.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

function fix(nodes, label) {
  const node = nodes.find(n => n.name === 'agente_atende_qualifica');
  if (!node) { console.log(`[${label}] node not found`); return null; }
  const sm = node.parameters?.options?.systemMessage;
  if (typeof sm !== 'string') { console.log(`[${label}] missing`); return null; }

  // Replace the broken multi-line string in the TRIAGEM block
  let newSm = sm.replace(
    "{{ $json.instr_triagem ? '## TRIAGEM\n' + $json.instr_triagem : '' }}",
    "{{ $json.instr_triagem ? '## TRIAGEM\\n' + $json.instr_triagem : '' }}"
  );
  // Replace the broken multi-line string in the QUANDO TRANSFERIR block
  newSm = newSm.replace(
    "{{ $json.instr_transferir ? '## QUANDO TRANSFERIR\n' + $json.instr_transferir : '' }}",
    "{{ $json.instr_transferir ? '## QUANDO TRANSFERIR\\n' + $json.instr_transferir : '' }}"
  );

  if (newSm === sm) {
    console.log(`[${label}] no change (pattern not found or already fixed)`);
    return sm;
  }
  node.parameters.options.systemMessage = newSm;
  console.log(`[${label}] fixed multi-line strings (len ${sm.length} → ${newSm.length})`);
  return newSm;
}

const topSm = fix(wf.nodes || [], 'top');
if (topSm && wf.activeVersion?.nodes) {
  const avNode = wf.activeVersion.nodes.find(n => n.name === 'agente_atende_qualifica');
  if (avNode) {
    avNode.parameters.options.systemMessage = topSm;
    console.log('[av] synced with top');
  }
}

writeFileSync(WF_PATH, JSON.stringify(wf, null, 2) + '\n', 'utf8');
console.log('Done.');
