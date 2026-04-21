import { readFileSync } from 'fs';

const mcp = JSON.parse(readFileSync('../.cursor/mcp.json', 'utf8'));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const r = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  headers: { 'X-N8N-API-KEY': apiKey }
});
const wf = await r.json();
const nodes = wf.nodes || [];

const agent = nodes.find(n => n.name === 'agente_atende_qualifica');
const sm = agent?.parameters?.options?.systemMessage || agent?.parameters?.systemMessage || '';
console.log('=== agente_atende_qualifica systemMessage COMPLETO ===');
console.log(sm);

const agent2 = nodes.find(n => n.name === 'AI Agent');
const sm2 = agent2?.parameters?.options?.systemMessage || agent2?.parameters?.systemMessage || '';
console.log('\n=== AI Agent (principal) systemMessage COMPLETO ===');
console.log(sm2);
