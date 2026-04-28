import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json','utf8'));

function findSM(obj, path) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const p = path + '.' + k;
    if (k === 'systemMessage' && typeof v === 'string' && v.includes('MENSAGEM AO CLIENTE')) {
      const idx = v.indexOf('MENSAGEM AO CLIENTE');
      console.log('Found at path:', p);
      console.log('Snippet:', JSON.stringify(v.substring(idx, idx+300)));
      console.log('---');
    } else if (typeof v === 'object' && v !== null) {
      findSM(v, p);
    }
  }
}

for (const node of data.nodes) {
  findSM(node, 'nodes[' + (node.name||node.id) + ']');
}
