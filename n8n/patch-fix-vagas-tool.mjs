/**
 * patch-fix-vagas-tool.mjs
 *
 * Atualiza o tool agd_cs_consultar_vagas no n8n:
 *   1. Adiciona p_profissional_id no body (filtra slots pelo profissional escolhido)
 *   2. Atualiza toolDescription para instruir o LLM a passar profissional_id
 *   3. Adiciona Prefer: params=single-object para evitar PGRST203
 */
import { readFileSync } from 'fs';

const mcp = JSON.parse(readFileSync('../.cursor/mcp.json', 'utf8'));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const r = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  headers: { 'X-N8N-API-KEY': apiKey }
});
const workflow = await r.json();

// Novo body: inclui p_profissional_id (passado pelo LLM via placeholder)
const NEW_JSON_BODY = `={{ '{"p_clinic_id":"' + $('Code merge webhook e resolucao').first().json.clinica_id + '","p_data":"{data_solicitada}","p_profissional_id":' + ('{profissional_id}' === 'null' ? 'null' : '"' + '{profissional_id}' + '"') + '}' }}`;

const NEW_TOOL_DESCRIPTION = `Lista horários disponíveis de um profissional em um dia específico.
Sempre pergunte ao cliente qual data deseja ANTES de chamar esta tool.
Parâmetros:
- data_solicitada: data no formato YYYY-MM-DD (obrigatório)
- profissional_id: UUID do profissional (obrigatório quando o cliente já escolheu o profissional; use null se ainda não souber)
Retorna array com horários livres. Mostre apenas os horários — NUNCA mencione preços.`;

let patched = 0;

function patchNodes(nodeArr) {
  if (!Array.isArray(nodeArr)) return;
  for (const node of nodeArr) {
    if (node.name === 'agd_cs_consultar_vagas' && node.type === '@n8n/n8n-nodes-langchain.toolHttpRequest') {
      const before = node.parameters?.jsonBody?.slice(0, 60) ?? '';

      node.parameters = {
        ...node.parameters,
        toolDescription: NEW_TOOL_DESCRIPTION,
        jsonBody: NEW_JSON_BODY,
        // Adiciona header Prefer para evitar ambiguidade de overload (segurança extra)
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: 'Prefer',
              value: 'params=single-object',
            },
          ],
        },
        placeholderDefinitions: {
          values: [
            {
              name: 'data_solicitada',
              description: 'Data desejada em formato YYYY-MM-DD. Pergunte ao cliente antes de chamar.',
              type: 'string',
            },
            {
              name: 'profissional_id',
              description: 'UUID do profissional escolhido pelo cliente. Use null se ainda não souber.',
              type: 'string',
            },
          ],
        },
      };

      console.log(`Patched tool "${node.name}" (id: ${node.id})`);
      console.log(`  jsonBody antes:  "${before}..."`);
      console.log(`  jsonBody depois: "${NEW_JSON_BODY.slice(0, 60)}..."`);
      patched++;
    }
  }
}

patchNodes(workflow.nodes);
patchNodes(workflow.activeVersion?.nodes);

if (patched === 0) {
  console.error('NENHUM tool "agd_cs_consultar_vagas" encontrado!');
  process.exit(1);
}
console.log(`\n${patched} node(s) patched.`);

// PUT workflow atualizado
const putBody = {
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: { executionOrder: workflow.settings?.executionOrder ?? 'v1' },
  staticData: workflow.staticData ?? undefined,
};

const putRes = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  method: 'PUT',
  headers: {
    'X-N8N-API-KEY': apiKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(putBody),
});

console.log(`\nPUT ${putRes.ok ? 'OK' : 'ERRO'} ${putRes.status}`);
if (!putRes.ok) {
  const txt = await putRes.text();
  console.error(txt.slice(0, 500));
} else {
  console.log('Workflow atualizado com sucesso.');
}
