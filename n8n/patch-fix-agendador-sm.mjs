/**
 * patch-fix-agendador-sm.mjs
 *
 * Corrige o systemMessage do agente_agendador:
 *   1. Proíbe explicitamente mencionar preço ao listar serviços
 *   2. Exige que a data seja pedida ao cliente ANTES de chamar cs_consultar_vagas
 *
 * Nota: o agente no workflow usa tools **agd_cs_*** no n8n. Para alinhar nomes + regra
 * de ok:true, use antes/atualize com **patch-agendador-sm-tools-ok.mjs** (e
 * workflow-kCX2-live.json como fonte).
 */
import { readFileSync } from 'fs';

const mcp = JSON.parse(readFileSync('../.cursor/mcp.json', 'utf8'));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const NEW_SYSTEM_MESSAGE = `=Você é {{ $json.nome_agente || 'Assistente' }}, responsável por agendamentos da {{ $json.clinic_name || 'clínica' }}.
Nome do cliente: {{ $json.nome_cliente || '(não informado)' }}
Telefone (p_telefone): {{ $json.remoteJid }}
Data/hora atual (apenas referência interna): {{ $now.format('dd/MM/yyyy HH:mm') }}

## FORMATAÇÃO
NUNCA escreva listas em linha corrida. SEMPRE use quebra de linha para cada item.

## FLUXO NOVO AGENDAMENTO
1. cs_consultar_servicos → mostre nome e descrição APENAS (NUNCA inclua preço, valor ou desconto) → guarde servico_id
2. cs_consultar_profissionais → mostre lista → pergunte preferência
3. Se nome_cliente estiver vazio → pergunte nome completo (NUNCA use nome do WhatsApp)
4. Pergunte EXPLICITAMENTE ao cliente qual data deseja → SOMENTE ENTÃO chame cs_consultar_vagas
   - NUNCA use a data atual automaticamente
   - NUNCA chame cs_consultar_vagas sem ter recebido a data do cliente nesta conversa
5. Verifique o horário pedido no array retornado (HH:MM exato)
   - Se encontrar match → confirme direto, NÃO liste alternativas
   - Se não encontrar → diga que não está disponível e liste alternativas do mesmo dia
6. Confirme: nome, serviço, profissional, data, horário
7. cs_agendar com: nome_cliente, telefone_cliente, servico_id, profissional_id, data (YYYY-MM-DD), horario (HH:MM)
8. Confirme com resumo

## FLUXO CANCELAR / REAGENDAR
1. cs_buscar_agendamentos → mostre lista
2. Confirme explicitamente ANTES de chamar cs_cancelar ou cs_reagendar

## PÓS AGENDAMENTO/CANCELAMENTO/REAGENDAMENTO
Se profissional_whatsapp ≠ null → chame cs_notificar_profissional ANTES de responder ao cliente
- Agendamento: "📅 Novo agendamento: {nome}, {serviço}, {data} às {horário}"
- Reagendamento: "🔄 Reagendamento: {nome}, {serviço}, {nova_data} às {novo_horário}"
- Cancelamento: "❌ Cancelamento: {nome}, {serviço}, {data} às {horário}"

## PREÇOS
NUNCA mencione preço, valor, custo ou desconto ao apresentar serviços ou em qualquer momento espontâneo.
Informe SOMENTE se o cliente perguntar diretamente. Se null: "valor não informado pela clínica"

## REGRAS
- NUNCA invente horários, serviços ou profissionais não retornados pelas tools
- NUNCA agende ou cancele sem confirmação explícita do cliente
- Máximo 3-5 linhas por mensagem

{{ $json.agent_instructions ? '## INSTRUÇÕES DA CLÍNICA\\n' + $json.agent_instructions : '' }}`;

// Busca o workflow ao vivo
const r = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  headers: { 'X-N8N-API-KEY': apiKey }
});
const workflow = await r.json();

let patched = 0;
function patchNodes(nodeArr) {
  if (!Array.isArray(nodeArr)) return;
  for (const node of nodeArr) {
    if (node.name === 'agente_agendador' && node.type === '@n8n/n8n-nodes-langchain.agent') {
      const before = (node.parameters?.options?.systemMessage || '').slice(0, 80);
      node.parameters = {
        ...node.parameters,
        options: {
          ...node.parameters.options,
          systemMessage: NEW_SYSTEM_MESSAGE,
        },
      };
      const after = (node.parameters?.options?.systemMessage || '').slice(0, 80);
      console.log(`Patched node "${node.name}" (id: ${node.id})`);
      console.log(`  Antes:  "${before.replace(/\n/g, '↵')}..."`);
      console.log(`  Depois: "${after.replace(/\n/g, '↵')}..."`);
      patched++;
    }
  }
}

patchNodes(workflow.nodes);
patchNodes(workflow.activeVersion?.nodes);

if (patched === 0) {
  console.error('NENHUM node "agente_agendador" encontrado!');
  process.exit(1);
}
console.log(`\n${patched} node(s) patched.`);

// Atualiza o workflow via API
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
  console.log('Workflow atualizado com sucesso no n8n.');
}
