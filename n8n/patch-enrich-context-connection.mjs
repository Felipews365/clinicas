// Patch: add direct connection IF mensagem vÃƒÂ¡lida → Enrich Agendador
// so context is available via $input.all() instead of $('IF mensagem vÃƒÂ¡lida')
// which fails in n8n 2.10.x task runner when node is 3+ hops back.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

const ifName = wf.nodes.find(n => n.name.includes('mensagem v'))?.name;
const enrichName = 'Enrich Agendador';

if (!ifName) { console.error('IF mensagem node not found'); process.exit(1); }

// Add connection: IF mensagem -> Enrich Agendador (output[0])
const ifConns = wf.connections[ifName];
const existingOutput0 = ifConns.main[0];
// Check it's not already connected to Enrich
const alreadyConnected = existingOutput0.some(c => c.node === enrichName);
if (!alreadyConnected) {
  existingOutput0.push({ node: enrichName, type: 'main', index: 0 });
  console.log(`Added connection: ${ifName} → ${enrichName}`);
} else {
  console.log('Connection already exists');
}

writeFileSync(WF_PATH, JSON.stringify(wf, null, 2), 'utf8');
console.log('Saved workflow');
