const https = require('https');
const fs = require('fs');

const API_HOST = 'n8n.vps7846.panel.icontainer.cloud';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkODUwY2QwZi02YmZhLTRhNmQtYWI1YS01NTUyMWNmZDY4NTQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMTBkMzUyM2QtZjIxMi00M2ZlLThhODQtZmI1ZGM0M2RkM2M0IiwiaWF0IjoxNzc0NDY3Nzk4fQ.nYUzjugWgXNjQkHC7T8ybDensc5zEqCH8oN98wNMG_w';
const WF_ID = 'x22UDZ4n5BuR7bUk';

const newSM = fs.readFileSync('n8n/new-system-message.txt', 'utf8');

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const opts = {
      hostname: API_HOST,
      path: `/api/v1${path}`,
      method,
      headers: {
        'X-N8N-API-KEY': KEY,
        'Content-Type': 'application/json',
        ...(bodyBuf ? { 'Content-Length': bodyBuf.length } : {})
      }
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
        } else {
          resolve(JSON.parse(text));
        }
      });
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

(async () => {
  console.log('Fetching workflow...');
  const wf = await apiRequest('GET', `/workflows/${WF_ID}`);
  console.log(`Workflow: ${wf.name} | nodes: ${wf.nodes.length}`);

  const agent = wf.nodes.find(n => n.type === '@n8n/n8n-nodes-langchain.agent');
  if (!agent) { console.error('AI Agent node NOT found'); process.exit(1); }

  agent.parameters.options.systemMessage = newSM;
  console.log('systemMessage updated. New start:', newSM.slice(0, 80));

  console.log('PUTting workflow...');
  const result = await apiRequest('PUT', `/workflows/${WF_ID}`, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || {}
  });
  console.log('Update OK. Active:', result.active);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
