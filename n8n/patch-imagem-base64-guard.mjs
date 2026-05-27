// Patch: add IF guard for null base64 before Baixa a imagem1.
// When Evolution API sends imageMessage without base64 (e.g. large images),
// ConvertToFile crashes. Route null base64 to Edit Fields3 (text path) instead.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

const NEW_IF_ID = 'if-base64-valido';
const NEW_IF_NAME = 'IF base64 válido';

function patch(nodes, connections) {
  // Check if already patched
  if (nodes.find(n => n.id === NEW_IF_ID)) {
    console.log('Already patched (nodes)');
    return false;
  }

  const pegaBase64 = nodes.find(n => n.name === 'Pega o base64 da imagem1');
  if (!pegaBase64) { console.log('Pega base64 node not found'); return false; }

  // New IF node positioned between Pega base64 and Baixa imagem
  const [px, py] = pegaBase64.position;
  const newIF = {
    id: NEW_IF_ID,
    name: NEW_IF_NAME,
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [px + 200, py],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{
          id: 'base64-not-null-check',
          leftValue: '={{ $json.base64 }}',
          rightValue: '',
          operator: { type: 'string', operation: 'notEmpty', singleValue: true },
        }],
        combinator: 'and',
      },
    },
  };

  nodes.push(newIF);

  // Rewire: Pega o base64 da imagem1 → IF base64 válido (instead of → Baixa a imagem1)
  const pegaConns = connections[pegaBase64.name];
  if (pegaConns?.main?.[0]) {
    pegaConns.main[0] = pegaConns.main[0].map(c =>
      c.node === 'Baixa a imagem1' ? { node: NEW_IF_NAME, type: 'main', index: 0 } : c
    );
  }

  // IF [out0] TRUE → Baixa a imagem1
  // IF [out1] FALSE → Edit Fields3
  connections[NEW_IF_NAME] = {
    main: [
      [{ node: 'Baixa a imagem1', type: 'main', index: 0 }],
      [{ node: 'Edit Fields3', type: 'main', index: 0 }],
    ],
  };

  console.log('Patched nodes array');
  return true;
}

let changed = false;
changed |= patch(wf.nodes, wf.connections);
if (wf.activeVersion?.nodes) {
  changed |= patch(wf.activeVersion.nodes, wf.activeVersion.connections || wf.connections);
}

if (changed) {
  writeFileSync(WF_PATH, JSON.stringify(wf, null, 2), 'utf8');
  console.log('Saved workflow with IF base64 guard');
} else {
  console.log('No changes made');
}
