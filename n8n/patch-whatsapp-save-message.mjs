/**
 * Patch: adiciona nó HTTP que salva cada mensagem inbound no histórico.
 *
 * Insere "HTTP Salvar msg inbound" entre:
 *   Code merge webhook e resolucao  →  Switch assinatura e acesso
 *
 * O nó chama a RPC n8n_save_whatsapp_message no Supabase (service_role).
 * neverError=true: falha silenciosa — não quebra o fluxo principal.
 *
 * Uso:
 *   node n8n/patch-whatsapp-save-message.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpPath = path.join(__dirname, '..', '.cursor', 'mcp.json');
const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
const BASE = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const KEY = mcp.mcpServers.n8n.env.N8N_API_KEY;
const headers = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };

// ── 1. Buscar workflow ativo ─────────────────────────────────────────────────
const listRes = await fetch(`${BASE}/workflows?limit=100`, { headers });
if (!listRes.ok) { console.error('LIST falhou', listRes.status); process.exit(1); }
const { data: workflows } = await listRes.json();

// Workflow ativo que contém "Code merge webhook e resolucao"
let targetWf = null;
for (const wf of workflows) {
  if (!wf.active) continue;
  const res = await fetch(`${BASE}/workflows/${wf.id}`, { headers });
  if (!res.ok) continue;
  const full = await res.json();
  if (full.nodes?.some(n => n.name === 'Code merge webhook e resolucao')) {
    targetWf = full;
    break;
  }
}

if (!targetWf) {
  // fallback: pegar pelo ID conhecido
  const res = await fetch(`${BASE}/workflows/kCX2LfxJrdYWB0vk`, { headers });
  if (!res.ok) { console.error('Workflow kCX2 não encontrado'); process.exit(1); }
  targetWf = await res.json();
}

console.log(`Workflow: "${targetWf.name}" (ID ${targetWf.id})`);

// ── 2. Verificar se já foi aplicado ─────────────────────────────────────────
if (targetWf.nodes.some(n => n.name === 'HTTP Salvar msg inbound')) {
  console.log('✅ Patch já aplicado. Nada a fazer.');
  process.exit(0);
}

// ── 3. Ler service_role key do nó existente ──────────────────────────────────
const rpcNode = targetWf.nodes.find(n => n.name === 'HTTP RPC n8n_resolve_clinic');
const svcKey = rpcNode?.parameters?.headerParameters?.parameters
  ?.find(p => p.name === 'apikey')?.value ?? '';

const supabaseUrl = 'https://xkwdwioawosthwjqijfb.supabase.co';

// ── 4. Posição: entre Code merge e Switch ────────────────────────────────────
const codeNode = targetWf.nodes.find(n => n.name === 'Code merge webhook e resolucao');
const switchNode = targetWf.nodes.find(n => n.name === 'Switch assinatura e acesso');
const newPos = [
  Math.round(((codeNode?.position[0] ?? -2560) + (switchNode?.position[0] ?? -2368)) / 2),
  (codeNode?.position[1] ?? -1680) - 120,
];

// ── 5. Novo nó ───────────────────────────────────────────────────────────────
const newNode = {
  id: 'wai-n01-save-msg',
  name: 'HTTP Salvar msg inbound',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: newPos,
  parameters: {
    method: 'POST',
    url: `${supabaseUrl}/rest/v1/rpc/n8n_save_whatsapp_message`,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'apikey',        value: svcKey },
        { name: 'Authorization', value: `Bearer ${svcKey}` },
        { name: 'Content-Type',  value: 'application/json' },
      ],
    },
    sendBody: true,
    specifyBody: 'json',
    // clinica_id vem do merge; phone tem @s.whatsapp.net (a RPC limpa); msg é o texto
    jsonBody: `={{ JSON.stringify({
  p_clinic_id: $json.clinica_id || '',
  p_phone:     $json.numCliente  || '',
  p_body:      String($json.msg  || '').trim(),
  p_direction: 'inbound'
}) }}`,
    options: {
      response: { response: { neverError: true } },
      // ignora mensagens sem texto ou enviadas pela clínica (fromMe)
    },
  },
};

// ── 6. Conexões ──────────────────────────────────────────────────────────────
// Antes: Code merge → Switch assinatura e acesso
// Depois: Code merge → HTTP Salvar msg inbound → Switch assinatura e acesso

const newConnections = {
  'Code merge webhook e resolucao': {
    main: [[{ node: 'HTTP Salvar msg inbound', type: 'main', index: 0 }]],
  },
  'HTTP Salvar msg inbound': {
    main: [[{ node: 'Switch assinatura e acesso', type: 'main', index: 0 }]],
  },
};

// ── 7. Aplicar ───────────────────────────────────────────────────────────────
targetWf.nodes.push(newNode);
targetWf.connections = { ...targetWf.connections, ...newConnections };

const body = {
  name:        targetWf.name,
  nodes:       targetWf.nodes,
  connections: targetWf.connections,
  settings:    { executionOrder: targetWf.settings?.executionOrder ?? 'v1' },
  staticData:  targetWf.staticData ?? undefined,
};

const putRes = await fetch(`${BASE}/workflows/${targetWf.id}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify(body),
});

if (!putRes.ok) {
  const txt = await putRes.text();
  console.error('PUT falhou', putRes.status, txt.slice(0, 500));
  process.exit(1);
}

console.log('✅ Patch aplicado com sucesso!');
console.log('O nó "HTTP Salvar msg inbound" foi inserido entre Code merge e Switch assinatura.');
