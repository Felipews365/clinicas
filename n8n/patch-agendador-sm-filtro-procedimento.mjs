/**
 * Adiciona regra crítica: identificar procedimento ANTES de listar profissionais.
 * Quando o Enrich não detectou o procedimento na mensagem atual (curta/ambígua),
 * o agente DEVE buscar o procedimento no histórico de chat e filtrar manualmente
 * a lista PROFISSIONAIS DISPONÍVEIS pelo servico_id correspondente.
 *
 * Uso: node n8n/patch-agendador-sm-filtro-procedimento.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");

// Ancoramos logo após a linha de identidade/intro, antes de qualquer seção ##
// O início do SM atual começa com "Você é {{ $json.nome_agente..."
const NEEDLE = `## ISOLAMENTO MULTI-TENANT`;

const NEW_BLOCK = `## PROCEDIMENTO → PROFISSIONAL → HORÁRIO (ordem obrigatória, sem exceção)
⚠️ Esta é a regra mais importante do seu comportamento. Quebrar esta ordem é um erro crítico.

**Passo 1 — Confirmar procedimento**
Antes de citar qualquer profissional ou horário, você DEVE saber qual procedimento/serviço o cliente quer.
- Se já foi mencionado nesta conversa (mesmo em turnos anteriores): use esse procedimento.
- Se ainda não foi dito: pergunte "Qual procedimento você gostaria de agendar?" e cite 2–4 opções do catálogo.
- NUNCA pule para profissionais ou horários sem o procedimento confirmado.

**Passo 2 — Filtrar profissionais pelo procedimento**
Com o procedimento confirmado, identifique o **servico_id** dele em ## SERVIÇOS DISPONÍVEIS.
Na lista ## PROFISSIONAIS DISPONÍVEIS, inclua SOMENTE quem atende esta condição:
  - tem o **servico_id** listado em seus "procedimentos (servico_id)", OU
  - está marcado como "painel sem vínculos" (aceita qualquer procedimento).

⚠️ NUNCA cite um profissional para um procedimento se ele não tem esse servico_id nos seus vínculos.

Exemplo: serviço Limpeza (servico_id X). Se Dra. Jayne tem "procedimentos: Y, Z" mas não tem X → ela NÃO pode ser mencionada para Limpeza.

**Passo 3 — Chamar agd_cs_consultar_vagas com procedimento**
Ao chamar agd_cs_consultar_vagas, SEMPRE preencha **procedimento** (nome) ou **servico_id** (UUID) quando o procedimento já é conhecido nesta conversa — mesmo que a mensagem atual seja curta ou não mencione o serviço. A RPC filtra a grade pelos profissionais aptos; sem o procedimento ela devolve todos.

**Atenção: lista de profissionais pode não estar pré-filtrada**
Quando a mensagem atual é curta (ex.: "sim", "10h", um nome), o sistema pode não ter filtrado automaticamente o ## PROFISSIONAIS DISPONÍVEIS. Nesse caso, VOCÊ deve fazer o filtro manual conforme o Passo 2 acima. Nunca liste todos os profissionais de uma clínica para um procedimento específico sem verificar os vínculos.

## ISOLAMENTO MULTI-TENANT`;

function patchSm(sm) {
  if (typeof sm !== "string") return sm;
  if (sm.includes("## PROCEDIMENTO → PROFISSIONAL → HORÁRIO")) return sm;
  if (!sm.includes(NEEDLE)) return sm;
  return sm.replace(NEEDLE, NEW_BLOCK);
}

function walk(nodes) {
  let n = 0;
  if (!Array.isArray(nodes)) return 0;
  for (const node of nodes) {
    if (
      node?.name === "agente_agendador" &&
      node?.type === "@n8n/n8n-nodes-langchain.agent"
    ) {
      const sm = node?.parameters?.options?.systemMessage;
      const next = patchSm(sm);
      if (next !== sm) {
        node.parameters = node.parameters || {};
        node.parameters.options = node.parameters.options || {};
        node.parameters.options.systemMessage = next;
        n++;
      }
    }
  }
  return n;
}

const workflow = JSON.parse(readFileSync(wfPath, "utf8"));
let total = walk(workflow.nodes);
if (workflow.activeVersion?.nodes) total += walk(workflow.activeVersion.nodes);

if (total === 0) {
  console.error(
    "ERRO: nenhum node agente_agendador encontrado ou patch já aplicado."
  );
  process.exit(1);
}

writeFileSync(wfPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log(`Patch aplicado em ${total} node(s) → ${wfPath}`);
