import { readFileSync } from 'fs';

// 1. Busca configuração do tool no workflow
const mcp = JSON.parse(readFileSync('../.cursor/mcp.json', 'utf8'));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const r = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  headers: { 'X-N8N-API-KEY': apiKey }
});
const wf = await r.json();
const nodes = wf.nodes || [];

const toolNode = nodes.find(n => n.name === 'agd_cs_consultar_vagas');
console.log('=== agd_cs_consultar_vagas PARAMS ===');
console.log(JSON.stringify(toolNode?.parameters, null, 2));

// 2. Testa a RPC com parâmetros que o tool envia
const envContent = readFileSync('../web/.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
}
const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = env.SUPABASE_SERVICE_ROLE_KEY;

console.log('\n=== Teste 1-param (sem data) ===');
const t1 = await fetch(`${supaUrl}/rest/v1/rpc/n8n_cs_consultar_vagas`, {
  method: 'POST',
  headers: { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_clinic_id: '5c8f7a44-c6b3-4835-889b-7e9f9b009125' }),
});
console.log('Status:', t1.status);
const d1 = await t1.json();
console.log('Total retornado:', Array.isArray(d1) ? d1.length : typeof d1);
if (Array.isArray(d1)) console.log('Primeiros 3:', JSON.stringify(d1.slice(0, 3), null, 2));
else console.log('Resposta:', JSON.stringify(d1).slice(0, 500));

console.log('\n=== Teste 2-param (com data 22/04) ===');
const t2 = await fetch(`${supaUrl}/rest/v1/rpc/n8n_cs_consultar_vagas`, {
  method: 'POST',
  headers: { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Content-Type': 'application/json', 'Prefer': 'params=single-object' },
  body: JSON.stringify({ p_clinic_id: '5c8f7a44-c6b3-4835-889b-7e9f9b009125', p_data: '2026-04-22' }),
});
console.log('Status:', t2.status);
const d2 = await t2.json();
console.log('Total retornado:', Array.isArray(d2) ? d2.length : typeof d2);
if (Array.isArray(d2)) {
  // Filtra só Dr João Lucas
  const joao = d2.filter(s => s.profissional && s.profissional.includes('Jo'));
  console.log('Dr João Lucas slots:', JSON.stringify(joao, null, 2));
} else console.log('Resposta:', JSON.stringify(d2).slice(0, 500));
