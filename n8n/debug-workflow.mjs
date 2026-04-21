import { readFileSync } from 'fs';

const mcp = JSON.parse(readFileSync('../.cursor/mcp.json', 'utf8'));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const r = await fetch(baseUrl + '/workflows/kCX2LfxJrdYWB0vk', {
  headers: { 'X-N8N-API-KEY': apiKey }
});
const wf = await r.json();
const nodes = wf.nodes || [];

const montaNode = nodes.find(n => n.name === 'Monta Contexto');
console.log('=== MONTA CONTEXTO (primeiras 10 linhas) ===');
console.log((montaNode?.parameters?.jsCode || '').split('\n').slice(0, 10).join('\n'));

const agentNodes = nodes.filter(n => n.type === '@n8n/n8n-nodes-langchain.agent');
for (const an of agentNodes) {
  const sm = an.parameters?.options?.systemMessage || an.parameters?.systemMessage || '';
  console.log('\n=== AGENT "' + an.name + '" systemMessage (primeiros 800 chars) ===');
  console.log(sm.slice(0, 800));
}

const buscaNode = nodes.find(n => n.name && n.name.includes('Config'));
console.log('\n=== BUSCAR CONFIG node ===');
console.log('name:', buscaNode?.name);
console.log('type:', buscaNode?.type);
if (buscaNode) {
  const p = buscaNode.parameters || {};
  console.log('url:', p.url);
  console.log('qs params:', JSON.stringify(p.queryParameters || p.sendQuery, null, 2));
  console.log('full params:', JSON.stringify(p, null, 2).slice(0, 1000));
}
