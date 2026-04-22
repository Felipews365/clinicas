/**
 * Atualiza o nó "Enrich Agendador" com código mais robusto:
 * - Usa $helpers.httpRequest() com json:true para auto-parse
 * - Lida com resposta como string ou objeto
 * - Fallback silencioso se falhar (não bloqueia o agente)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const SUPABASE_URL = "https://xkwdwioawosthwjqijfb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhrd2R3aW9hd29zdGh3anFpamZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUyNzUzMywiZXhwIjoyMDkwMTAzNTMzfQ._CoWPqn1bDqNRJ-g6EzGnqE86YI_LW5T_N6At3CPal4";

const enrichCode = `// Pré-busca profissionais e serviços e injeta IDs no contexto do agente_agendador.
// Elimina necessidade de o LLM chamar agd_cs_consultar_profissionais/servicos
// (que geravam "Required → at " por gpt-4o-mini retornar arguments:"" para tools sem params reais).

const ctx = $input.first().json;
const clinicId = ctx.clinic_id || '';

const SB_URL = ${JSON.stringify(SUPABASE_URL)};
const SB_KEY = ${JSON.stringify(SUPABASE_KEY)};

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: 'Bearer ' + SB_KEY,
  'Content-Type': 'application/json',
  Accept: 'application/json'
};

function parseJson(val) {
  if (Array.isArray(val) || (val && typeof val === 'object')) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
}

let profBlock = '';
let servicosBlock = '';

if (clinicId) {
  // --- Profissionais ---
  try {
    const raw = await $helpers.httpRequest({
      method: 'GET',
      url: SB_URL + '/rest/v1/cs_profissionais?select=id,nome,especialidade&ativo=eq.true&order=nome.asc&clinic_id=eq.' + clinicId,
      headers: sbHeaders,
      json: true
    });
    const profs = parseJson(raw);
    if (profs.length > 0) {
      const linhas = profs.map(p =>
        '  - ' + (p.nome || '?') +
        (p.especialidade ? ' (' + p.especialidade + ')' : '') +
        ' | profissional_id: ' + p.id
      ).join('\\n');
      profBlock = '\\n\\n## PROFISSIONAIS DISPONÍVEIS (use os profissional_id exatos abaixo para cs_consultar_vagas e cs_agendar):\\n' + linhas;
    }
  } catch(e) {
    // Fallback silencioso — agente ainda pode usar a tool
  }

  // --- Serviços ---
  try {
    const raw2 = await $helpers.httpRequest({
      method: 'POST',
      url: SB_URL + '/rest/v1/rpc/n8n_clinic_procedimentos',
      headers: sbHeaders,
      body: JSON.stringify({ p_clinic_id: clinicId }),
      json: true
    });
    const svcs = parseJson(raw2);
    if (svcs.length > 0) {
      const linhas = svcs.slice(0, 20).map(s =>
        '  - ' + (s.nome || '?') +
        (s.preco_a_vista_brl ? ' | R$' + s.preco_a_vista_brl : s.valor_brl ? ' | R$' + s.valor_brl : '') +
        (s.duracao_minutos ? ' | ' + s.duracao_minutos + 'min' : '') +
        ' | servico_id: ' + s.id
      ).join('\\n');
      servicosBlock = '\\n\\n## SERVIÇOS DISPONÍVEIS (use os servico_id exatos abaixo para cs_agendar):\\n' + linhas;
    }
  } catch(e) {
    // Fallback silencioso
  }
}

return [{
  json: {
    ...ctx,
    agent_instructions: (ctx.agent_instructions || '') + profBlock + servicosBlock
  }
}];`;

const enrichNode = data.nodes.find(n => n.name === "Enrich Agendador");
if (!enrichNode) {
  console.error("Enrich Agendador node not found!");
  process.exit(1);
}

enrichNode.parameters.jsCode = enrichCode;
console.log("✓ Enrich Agendador code updated (", enrichCode.length, "chars)");

fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("✓ workflow-kCX2-live.json saved.");

// Push
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const workflowId = data.id;

const getRes = await fetch(`${baseUrl}/workflows/${workflowId}`, { headers: { "X-N8N-API-KEY": apiKey } });
if (!getRes.ok) { console.error("GET failed"); process.exit(1); }
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
if (!putRes.ok) { console.error("PUT failed", text.substring(0,200)); process.exit(1); }
console.log("✓ Pushed to n8n:", putRes.status, text.slice(0, 100));
