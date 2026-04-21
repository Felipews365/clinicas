import { readFileSync } from 'fs';

const mcp = JSON.parse(readFileSync('../.cursor/mcp.json', 'utf8'));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const r = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  headers: { 'X-N8N-API-KEY': apiKey }
});
const wf = await r.json();
const nodes = wf.nodes || [];

// 1. Nome EXATO de todos os nodes que têm "buscar" ou "config" no nome
console.log('=== Nodes com "Config" ou "Buscar" no nome ===');
nodes.filter(n => /config|buscar/i.test(n.name || '')).forEach(n => {
  console.log(`  [${Buffer.from(n.name).toString('hex')}] "${n.name}"`);
});

// 2. Monta Contexto: primeiras 3 linhas
const monta = nodes.find(n => n.name === 'Monta Contexto');
console.log('\n=== Monta Contexto (primeiras 5 linhas) ===');
console.log((monta?.parameters?.jsCode || '').split('\n').slice(0, 5).join('\n'));

// 3. systemMessage completo de cada AI agent
console.log('\n=== AI Agent systemMessages COMPLETOS ===');
const agentNodes = nodes.filter(n => n.type === '@n8n/n8n-nodes-langchain.agent');
for (const an of agentNodes) {
  const sm = an.parameters?.options?.systemMessage || an.parameters?.systemMessage || '';
  console.log(`\n--- "${an.name}" (${sm.length} chars) ---`);
  console.log(sm.slice(0, 1500));
  if (sm.length > 1500) console.log('... [truncated]');
}
