/**
 * Fix definitivo: "Required → at " ao agendar
 *
 * Causa raiz confirmada:
 *   gpt-4o-mini gera arguments:"" (string vazia) para ferramentas que considera
 *   "sem parâmetros reais" (agd_cs_consultar_profissionais, agd_cs_consultar_servicos).
 *   JSON.parse("") lança SyntaxError → toolInput=undefined → Zod: "Required → at "
 *
 * Solução:
 *   1. Adiciona nó Code "Enrich Agendador" entre "IF mensagem válida" e "agente_agendador"
 *      → busca profissionais (com UUIDs) via $helpers.httpRequest
 *      → injeta lista formatada no agent_instructions do sistema
 *   2. Agente já tem os profissional_ids no contexto → pode chamar agd_cs_consultar_vagas
 *      diretamente sem precisar de agd_cs_consultar_profissionais
 *   3. Melhora descrições das tools "chamada" como fallback
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

// ── Supabase config (already hardcoded in other nodes) ──
const SUPABASE_URL = "https://xkwdwioawosthwjqijfb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhrd2R3aW9hd29zdGh3anFpamZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUyNzUzMywiZXhwIjoyMDkwMTAzNTMzfQ._CoWPqn1bDqNRJ-g6EzGnqE86YI_LW5T_N6At3CPal4";

// ── Positions ──
const ifMens = data.nodes.find(n => n.name === "IF mensagem válida");
const agAgend = data.nodes.find(n => n.name === "agente_agendador");
const ifPos = ifMens?.position || [1000, -128];
const agPos = agAgend?.position || [3392, -128];

// Place Enrich node between them
const enrichPos = [Math.round((ifPos[0] + agPos[0]) / 2) - 100, ifPos[1] + 240];

// ── 1. Add "Enrich Agendador" Code node ──
const ENRICH_ID = "enrich-agendador-prefetch";
const existingEnrich = data.nodes.find(n => n.id === ENRICH_ID);

const enrichCode = `// Pré-busca profissionais da clínica e injeta no contexto do agendador
// Isso elimina a necessidade de o LLM chamar agd_cs_consultar_profissionais
// (que gerava "Required → at " por retornar arguments:"" no gpt-4o-mini)

const ctx = $input.first().json;
const clinicId = ctx.clinic_id || '';

const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
const SUPABASE_KEY = ${JSON.stringify(SUPABASE_KEY)};

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json'
};

// Buscar profissionais ativos
let profBlock = '';
let servicosBlock = '';

try {
  const profs = await $helpers.httpRequest({
    method: 'GET',
    url: SUPABASE_URL + '/rest/v1/cs_profissionais?select=id,nome,especialidade&ativo=eq.true&order=nome.asc&clinic_id=eq.' + clinicId,
    headers
  });
  if (Array.isArray(profs) && profs.length > 0) {
    const linhas = profs.map(p =>
      '  - ' + p.nome + (p.especialidade ? ' (' + p.especialidade + ')' : '') +
      ' | profissional_id: ' + p.id
    ).join('\\n');
    profBlock = '\\n\\n## PROFISSIONAIS DISPONÍVEIS (use os profissional_id exatos abaixo ao chamar cs_consultar_vagas):\\n' + linhas;
  }
} catch(e) {
  // Fallback: profissionais não pré-carregados — agente usará a tool
  profBlock = '';
}

// Buscar serviços ativos
try {
  const servicos = await $helpers.httpRequest({
    method: 'POST',
    url: SUPABASE_URL + '/rest/v1/rpc/n8n_clinic_procedimentos',
    headers,
    body: JSON.stringify({ p_clinic_id: clinicId })
  });
  if (Array.isArray(servicos) && servicos.length > 0) {
    const linhas = servicos.slice(0, 15).map(s =>
      '  - ' + s.nome + (s.preco ? ' | R$' + s.preco : '') +
      (s.duracao_min ? ' | ' + s.duracao_min + 'min' : '') +
      ' | servico_id: ' + s.id
    ).join('\\n');
    servicosBlock = '\\n\\n## SERVIÇOS DISPONÍVEIS (use os servico_id exatos abaixo ao agendar):\\n' + linhas;
  }
} catch(e) {
  servicosBlock = '';
}

return [{
  json: {
    ...ctx,
    agent_instructions: (ctx.agent_instructions || '') + profBlock + servicosBlock
  }
}];`;

if (existingEnrich) {
  existingEnrich.parameters.jsCode = enrichCode;
  console.log("✓ Enrich Agendador node updated.");
} else {
  data.nodes.push({
    id: ENRICH_ID,
    name: "Enrich Agendador",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: enrichPos,
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: enrichCode
    }
  });
  console.log("✓ Enrich Agendador node added at position", enrichPos);
}

// ── 2. Rewire connections ──
// Before: IF mensagem válida [0] → agente_agendador
// After:  IF mensagem válida [0] → Enrich Agendador → agente_agendador

const ifConns = data.connections["IF mensagem válida"];
if (ifConns?.main?.[0]) {
  const wasToAgent = ifConns.main[0].find(c => c.node === "agente_agendador");
  if (wasToAgent) {
    // Replace with Enrich Agendador
    ifConns.main[0] = ifConns.main[0].map(c =>
      c.node === "agente_agendador"
        ? { node: "Enrich Agendador", type: "main", index: 0 }
        : c
    );
    console.log("✓ IF mensagem válida [0] → Enrich Agendador");
  } else {
    const hasEnrich = ifConns.main[0].find(c => c.node === "Enrich Agendador");
    if (!hasEnrich) {
      ifConns.main[0].push({ node: "Enrich Agendador", type: "main", index: 0 });
    }
    console.log("✓ IF mensagem válida [0] already has Enrich Agendador");
  }
}

// Add: Enrich Agendador → agente_agendador
if (!data.connections["Enrich Agendador"]) {
  data.connections["Enrich Agendador"] = {
    main: [[{ node: "agente_agendador", type: "main", index: 0 }]]
  };
  console.log("✓ Enrich Agendador → agente_agendador connection added");
} else {
  console.log("✓ Enrich Agendador connections already exist");
}

// ── 3. Fix chamada placeholder descriptions (backup) ──
const toolsToFix = ["agd_cs_consultar_profissionais", "agd_cs_consultar_servicos",
  "cs_consultar_profissionais", "cs_consultar_servicos",
  "faq_cs_consultar_servicos", "esp_cs_consultar_servicos"];

data.nodes.forEach(node => {
  if (!toolsToFix.includes(node.name)) return;
  const ph = node.parameters?.placeholderDefinitions?.values || [];
  const chamada = ph.find(p => p.name === "chamada");
  if (!chamada) return;

  // Give it a clearer description so the LLM always provides a value
  if (node.name.includes("profissionais")) {
    chamada.description = "OBRIGATÓRIO: passe exatamente o texto 'listar' para buscar todos os profissionais ativos.";
  } else {
    chamada.description = "OBRIGATÓRIO: passe exatamente o texto 'listar' para buscar todos os serviços/procedimentos disponíveis.";
  }
  console.log(`✓ ${node.name}: placeholder description updated`);
});

// ── 4. Update agente_agendador system message to mention pre-fetched data ──
const agNode = data.nodes.find(n => n.name === "agente_agendador");
if (agNode?.parameters?.options?.systemMessage) {
  const sm = agNode.parameters.options.systemMessage;
  const addendum = `\n\n## PROFISSIONAIS E SERVIÇOS\nOs profissionais e serviços da clínica estão listados no campo agent_instructions acima (com seus profissional_id e servico_id exatos).\nUse esses IDs diretamente ao chamar cs_consultar_vagas ou cs_agendar — NÃO precisa chamar cs_consultar_profissionais ou cs_consultar_servicos primeiro se os dados já estiverem no contexto.`;
  
  if (!sm.includes("profissional_id e servico_id exatos")) {
    // The system message is an expression — append to the last part
    // Format: =Você é... (multiline expression)
    // We need to add a note at the end
    // The expression ends without }} so we can append text
    agNode.parameters.options.systemMessage = sm + addendum;
    console.log("✓ agente_agendador system message updated with profissionais hint");
  } else {
    console.log("✓ agente_agendador system message already has profissionais hint");
  }
}

// ── Save ──
fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("\n✓ workflow-kCX2-live.json saved.");

// ── Verify ──
console.log("\n=== Verification ===");
console.log("IF mensagem válida [0] →", data.connections["IF mensagem válida"]?.main?.[0]?.map(c => c.node).join(", "));
console.log("Enrich Agendador →", data.connections["Enrich Agendador"]?.main?.[0]?.map(c => c.node).join(", "));
const enrichNode = data.nodes.find(n => n.name === "Enrich Agendador");
console.log("Enrich Agendador exists:", !!enrichNode);
console.log("Code length:", enrichNode?.parameters?.jsCode?.length, "chars");

// ── Push ──
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const workflowId = data.id;

console.log(`\nPushing workflow ${workflowId} to n8n...`);
const getRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
if (!getRes.ok) { console.error("GET failed", getRes.status); process.exit(1); }
const current = await getRes.json();

const putRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: data.name ?? current.name,
    nodes: data.nodes,
    connections: data.connections,
    settings: { executionOrder: current.settings?.executionOrder ?? "v1" },
    staticData: current.staticData ?? undefined,
  }),
});
const text = await putRes.text();
if (!putRes.ok) { console.error("PUT failed", putRes.status, text.substring(0, 300)); process.exit(1); }
console.log("✓ Pushed to n8n:", putRes.status, text.slice(0, 150));
