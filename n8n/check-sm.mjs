import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json','utf8'));

let found = 0;
for (const node of data.nodes) {
  // Check all possible locations for systemMessage
  const sm = node.parameters?.systemMessage;
  if (sm && typeof sm === 'string' && sm.length > 100) {
    found++;
    if (sm.includes('MENSAGEM AO CLIENTE')) {
      const idx = sm.indexOf('MENSAGEM AO CLIENTE');
      console.log('Node:', node.name);
      console.log('SM snippet:', JSON.stringify(sm.substring(idx, idx+400)));
      console.log('---');
    }
  }
}
console.log('Nodes with systemMessage:', found);
