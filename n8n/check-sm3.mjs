import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json','utf8'));

function findSMAll(obj, path) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const p = path + '.' + k;
    if (k === 'systemMessage' && typeof v === 'string' && v.length > 100) {
      const hasMsgClient = v.includes('MENSAGEM AO CLIENTE');
      const hasAgd = v.includes('agd_cs_agendar');
      console.log('Path:', p, '| hasMsgCliente:', hasMsgClient, '| hasAgd:', hasAgd, '| len:', v.length);
      if (hasMsgClient) {
        const idx = v.indexOf('MENSAGEM AO CLIENTE');
        console.log('  Snippet:', JSON.stringify(v.substring(idx, idx+200)));
      }
    } else if (typeof v === 'object' && v !== null && p.split('.').length < 12) {
      findSMAll(v, p);
    }
  }
}

// Check top-level data
findSMAll(data, 'root');
