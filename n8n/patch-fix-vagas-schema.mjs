/**
 * patch-fix-vagas-schema.mjs
 *
 * Corrige "Received tool input did not match expected schema ✖ Required → at "
 *
 * Causa raiz: jsonBody do agd_cs_consultar_vagas usava formato ={{ '...' }}
 * (expressão pura). O n8n não consegue extrair placeholders de expressão pura
 * e gera schema com campo vazio '' obrigatório → erro "Required → at ".
 *
 * Fix: mudar para formato misto ={...} igual ao agd_cs_buscar_agendamentos,
 * onde o n8n detecta {placeholder} corretamente.
 * profissional_id passa a ser obrigatório (UUID real) — alinhado com o fluxo
 * que já exige escolher profissional antes de verificar vagas.
 */
import { readFileSync } from 'fs';

const mcp = JSON.parse(readFileSync('../.cursor/mcp.json', 'utf8'));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Formato misto ={...}: n8n detecta {placeholders} e resolve ={{ expr }} como expressão
const NEW_JSON_BODY = `={
  "p_clinic_id": "={{ $('Code merge webhook e resolucao').first().json.clinica_id }}",
  "p_data": "{data_solicitada}",
  "p_profissional_id": "{profissional_id}"
}`;

const NEW_TOOL_DESCRIPTION = `Lista horários disponíveis de um profissional em um dia específico.
Fluxo obrigatório ANTES de chamar:
1. cs_consultar_profissionais → obtenha a lista de profissionais
2. Cliente escolhe o profissional → guarde o UUID (profissional_id)
3. Pergunte ao cliente a data desejada
4. Chame esta tool com profissional_id e data_solicitada
Parâmetros:
- data_solicitada: data no formato YYYY-MM-DD (obrigatório)
- profissional_id: UUID do profissional escolhido (obrigatório — nunca use null)
Retorna array com horários livres. Mostre apenas os horários — NUNCA mencione preços.`;

const NEW_PLACEHOLDER_DEFINITIONS = {
  values: [
    {
      name: 'data_solicitada',
      description: 'Data desejada em formato YYYY-MM-DD.',
      type: 'string',
    },
    {
      name: 'profissional_id',
      description: 'UUID do profissional escolhido pelo cliente (de cs_consultar_profissionais). Obrigatório.',
      type: 'string',
    },
  ],
};

const r = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  headers: { 'X-N8N-API-KEY': apiKey },
});
const workflow = await r.json();

let patched = 0;

function patchNodes(nodeArr) {
  if (!Array.isArray(nodeArr)) return;
  for (const node of nodeArr) {
    if (node.name === 'agd_cs_consultar_vagas' && node.type === '@n8n/n8n-nodes-langchain.toolHttpRequest') {
      node.parameters = {
        ...node.parameters,
        toolDescription: NEW_TOOL_DESCRIPTION,
        jsonBody: NEW_JSON_BODY,
        placeholderDefinitions: NEW_PLACEHOLDER_DEFINITIONS,
      };
      patched++;
      console.log(`Patched "${node.name}" (id: ${node.id})`);
    }
  }
}

patchNodes(workflow.nodes);
patchNodes(workflow.activeVersion?.nodes);

if (patched === 0) {
  console.error('ERRO: nenhum node agd_cs_consultar_vagas encontrado!');
  process.exit(1);
}
console.log(`\n${patched} node(s) patched.`);

const putBody = {
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: { executionOrder: workflow.settings?.executionOrder ?? 'v1' },
  staticData: workflow.staticData ?? undefined,
};

const putRes = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  method: 'PUT',
  headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify(putBody),
});

console.log(`PUT ${putRes.ok ? 'OK' : 'ERRO'} ${putRes.status}`);
if (!putRes.ok) {
  console.error(await putRes.text());
} else {
  console.log('Workflow atualizado com sucesso.');
}
