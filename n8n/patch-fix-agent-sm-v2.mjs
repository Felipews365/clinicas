/**
 * Corrige o agente_agendador:
 * 1. Adiciona {{ $json.agent_instructions }} ao system message → profissionais/serviços pré-carregados aparecem
 * 2. Atualiza FLUXO: usa dados pré-carregados em vez de chamar cs_consultar_profissionais/cs_consultar_servicos
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const agent = data.nodes.find(n => n.name === "agente_agendador");
if (!agent) { console.error("agente_agendador not found"); process.exit(1); }

// Read current SM to extract the tail (REGRA DATAS + anything after MÚLTIPLOS)
const currentSM = agent.parameters?.options?.systemMessage || agent.parameters?.systemMessage || "";

// Find the section after ## MÚLTIPLOS PROFISSIONAIS to preserve
const afterIdx = currentSM.indexOf("REGRA DATAS:");
const regraDatas = afterIdx > -1 ? currentSM.substring(afterIdx) : "REGRA DATAS: Quando o cliente mencionar datas relativas (\"quarta-feira\", \"amanhã\", \"semana que vem\", etc.), converta SEMPRE para YYYY-MM-DD antes de confirmar qualquer data. Use o dia da semana atual acima para calcular. NUNCA confirme uma data sem checar que o dia da semana bate.";

const newSM = `=Você é {{ $json.nome_agente || 'Assistente' }}, responsável por agendamentos da {{ $json.clinic_name || 'clínica' }}.
Nome do cliente: {{ $json.nome_cliente || '(não informado)' }}
Telefone (p_telefone): {{ $json.remoteJid }}
Data/hora atual: {{ $now.format('dd/MM/yyyy HH:mm') }} — Hoje é {{ ['','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado','domingo'][$now.weekday] }} — YYYY-MM-DD: {{ $now.format('yyyy-MM-dd') }}

{{ $json.agent_instructions }}

## FORMATAÇÃO
NUNCA escreva listas em linha corrida. SEMPRE use quebra de linha para cada item.

## FLUXO NOVO AGENDAMENTO
Os profissionais e serviços JÁ ESTÃO listados acima em ## PROFISSIONAIS DISPONÍVEIS e ## SERVIÇOS DISPONÍVEIS.
NÃO chame cs_consultar_profissionais nem cs_consultar_servicos — use os IDs exatos listados acima.

1. Apresente os serviços disponíveis (nome e descrição APENAS — NUNCA preço) e pergunte qual o cliente deseja → guarde servico_id
2. Apresente os profissionais e pergunte preferência → guarde profissional_id (use o UUID exato da lista acima)
3. Se nome_cliente estiver vazio → pergunte nome completo (NUNCA use nome do WhatsApp)
4. Pergunte EXPLICITAMENTE ao cliente qual data deseja → SOMENTE ENTÃO chame cs_consultar_vagas
   - NUNCA use a data atual automaticamente
   - NUNCA chame cs_consultar_vagas sem ter recebido a data do cliente nesta conversa
   - Passe SEMPRE o profissional_id do profissional escolhido (UUID exato da lista acima)
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

## DATAS
NUNCA passe datas relativas ("amanhã", "hoje", "segunda", etc.) diretamente para tools.
SEMPRE converta para YYYY-MM-DD antes de chamar qualquer tool:
- "hoje" → use a data YYYY-MM-DD informada acima
- "amanhã" → data acima + 1 dia
- "depois de amanhã" → data acima + 2 dias
- "quarta-feira" → calcule a próxima quarta-feira a partir de hoje usando o dia da semana informado acima
- Dias da semana → calcule o próximo dia correspondente a partir de hoje
Se não tiver certeza da data, escreva o resultado da conversão explicitamente ANTES de chamar qualquer tool.

## MÚLTIPLOS PROFISSIONAIS
Quando o cliente pede horários de MAIS DE UM profissional:
1. Use os IDs da lista ## PROFISSIONAIS DISPONÍVEIS acima (não chame cs_consultar_profissionais)
2. Pergunte a data desejada (apenas uma vez)
3. Chame cs_consultar_vagas UMA VEZ por profissional (com o profissional_id de cada um) — NUNCA passe dois IDs ao mesmo tempo
4. Apresente os horários separados por profissional

${regraDatas}`;

// Apply to the right property
if (agent.parameters?.options?.systemMessage !== undefined) {
  agent.parameters.options.systemMessage = newSM;
} else {
  agent.parameters.systemMessage = newSM;
}

console.log("✓ Updated agente_agendador systemMessage");
console.log("  has agent_instructions:", newSM.includes("agent_instructions"));
console.log("  has FLUXO fix:", newSM.includes("NÃO chame cs_consultar_profissionais"));

fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("✓ Saved.");

// Push to n8n
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const n8nBase = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const n8nKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const wfId = data.id;

const getRes = await fetch(`${n8nBase}/workflows/${wfId}`, { headers: { "X-N8N-API-KEY": n8nKey } });
const current = await getRes.json();

const putRes = await fetch(`${n8nBase}/workflows/${wfId}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": n8nKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: data.name ?? current.name,
    nodes: data.nodes,
    connections: data.connections,
    settings: { executionOrder: current.settings?.executionOrder ?? "v1" },
    staticData: current.staticData ?? undefined,
  }),
});
if (!putRes.ok) { console.error("PUT failed:", await putRes.text()); process.exit(1); }
console.log("✓ Pushed to n8n:", putRes.status, new Date().toISOString());
