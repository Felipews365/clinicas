/**
 * Adiciona dois HTTP Request nodes nativos para pré-buscar profissionais e serviços
 * ANTES do Enrich Agendador Code node.
 * 
 * Fluxo resultante:
 *   IF mensagem válida → HTTP Fetch Profissionais → HTTP Fetch Servicos → Enrich Agendador → agente_agendador
 *
 * Usa responseFormat: "text" em ambos os HTTP nodes para garantir 1 item de saída
 * (evita que arrays do Supabase sejam divididos em múltiplos itens).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const SUPABASE_URL = "https://xkwdwioawosthwjqijfb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhrd2R3aW9hd29zdGh3anFpamZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUyNzUzMywiZXhwIjoyMDkwMTAzNTMzfQ._CoWPqn1bDqNRJ-g6EzGnqE86YI_LW5T_N6At3CPal4";
const SB_HEADERS = [
  { name: "apikey", value: SUPABASE_KEY },
  { name: "Authorization", value: "Bearer " + SUPABASE_KEY },
  { name: "Content-Type", value: "application/json" },
  { name: "Accept", value: "application/json" }
];

// ── 1. Define the two new HTTP Request nodes ────────────────────────────────

const httpProfNode = {
  id: "http-prefetch-profissionais",
  name: "HTTP Fetch Profissionais",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1400, -128],
  parameters: {
    method: "GET",
    url: `={{ '${SUPABASE_URL}/rest/v1/cs_profissionais?select=id,nome,especialidade&ativo=eq.true&order=nome.asc&clinic_id=eq.' + $('IF mensagem válida').first().json.clinic_id }}`,
    sendHeaders: true,
    headerParameters: { parameters: SB_HEADERS },
    options: {
      response: {
        response: {
          responseFormat: "text"
        }
      }
    }
  }
};

const httpSvcNode = {
  id: "http-prefetch-servicos",
  name: "HTTP Fetch Servicos",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1750, -128],
  parameters: {
    method: "POST",
    url: `=${SUPABASE_URL}/rest/v1/rpc/n8n_clinic_procedimentos`,
    sendHeaders: true,
    headerParameters: { parameters: SB_HEADERS },
    sendBody: true,
    specifyBody: "json",
    jsonBody: `={{ JSON.stringify({ p_clinic_id: $('IF mensagem válida').first().json.clinic_id }) }}`,
    options: {
      response: {
        response: {
          responseFormat: "text"
        }
      }
    }
  }
};

// ── 2. Update Enrich Agendador Code node (no more HTTP - just format) ───────

const enrichCode = `// Formata profissionais e serviços pré-buscados pelos HTTP nodes anteriores.
// Resposta em texto (responseFormat: "text") → $json.data contém JSON string.

const ctx = $('IF mensagem válida').first().json;

let profBlock = '';
let servicosBlock = '';

// Profissionais
try {
  const rawProf = $('HTTP Fetch Profissionais').first().json;
  // responseFormat text → rawProf.data = "[{...}]" string
  const profData = typeof rawProf.data === 'string' ? rawProf.data : JSON.stringify(rawProf);
  const profs = JSON.parse(profData);
  if (Array.isArray(profs) && profs.length > 0) {
    const linhas = profs.map(p =>
      '  - ' + (p.nome || '?') +
      (p.especialidade ? ' (' + p.especialidade + ')' : '') +
      ' | profissional_id: ' + p.id
    ).join('\\n');
    profBlock = '\\n\\n## PROFISSIONAIS DISPONÍVEIS (use estes profissional_id ao chamar cs_consultar_vagas — NÃO chame cs_consultar_profissionais):\\n' + linhas;
  }
} catch(e) { /* sem profissionais: agent usa tool normalmente */ }

// Serviços
try {
  const rawSvc = $('HTTP Fetch Servicos').first().json;
  const svcData = typeof rawSvc.data === 'string' ? rawSvc.data : JSON.stringify(rawSvc);
  const svcs = JSON.parse(svcData);
  if (Array.isArray(svcs) && svcs.length > 0) {
    const linhas = svcs.slice(0, 20).map(s =>
      '  - ' + (s.nome || '?') +
      (s.preco_a_vista_brl ? ' | R$' + s.preco_a_vista_brl : '') +
      (s.duracao_minutos ? ' | ' + s.duracao_minutos + 'min' : '') +
      ' | servico_id: ' + s.id
    ).join('\\n');
    servicosBlock = '\\n\\n## SERVIÇOS DISPONÍVEIS (use estes servico_id ao chamar cs_agendar — NÃO chame cs_consultar_servicos):\\n' + linhas;
  }
} catch(e) { /* sem serviços */ }

return [{
  json: {
    ...ctx,
    agent_instructions: (ctx.agent_instructions || '') + profBlock + servicosBlock,
    _profissionais_pre_carregados: profBlock !== '',
    _servicos_pre_carregados: servicosBlock !== ''
  }
}];`;

// ── 3. Apply changes to workflow ────────────────────────────────────────────

// Remove old HTTP nodes if they somehow exist
data.nodes = data.nodes.filter(n =>
  n.id !== "http-prefetch-profissionais" && n.id !== "http-prefetch-servicos"
);

// Add new HTTP nodes
data.nodes.push(httpProfNode);
data.nodes.push(httpSvcNode);

// Update Enrich Agendador code
const enrichNode = data.nodes.find(n => n.name === "Enrich Agendador");
if (!enrichNode) { console.error("Enrich Agendador not found"); process.exit(1); }
enrichNode.parameters.jsCode = enrichCode;
// Move Enrich Agendador to make room
enrichNode.position = [2096, -128];

// ── 4. Rewire connections ────────────────────────────────────────────────────
// Old: IF mensagem válida[0] → Enrich Agendador
// New: IF mensagem válida[0] → HTTP Fetch Profissionais → HTTP Fetch Servicos → Enrich Agendador

const c = data.connections;

// IF mensagem válida → HTTP Fetch Profissionais (true output = index 0)
c["IF mensagem válida"].main[0] = [{ node: "HTTP Fetch Profissionais", type: "main", index: 0 }];

// HTTP Fetch Profissionais → HTTP Fetch Servicos
c["HTTP Fetch Profissionais"] = { main: [[{ node: "HTTP Fetch Servicos", type: "main", index: 0 }]] };

// HTTP Fetch Servicos → Enrich Agendador
c["HTTP Fetch Servicos"] = { main: [[{ node: "Enrich Agendador", type: "main", index: 0 }]] };

console.log("✓ Added HTTP Fetch Profissionais and HTTP Fetch Servicos nodes");
console.log("✓ Updated Enrich Agendador code (formatting only, no HTTP)");
console.log("✓ Rewired: IF → HTTP Prof → HTTP Svc → Enrich → agente_agendador");

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
const respText = await putRes.text();
if (!putRes.ok) { console.error("PUT failed:", respText.substring(0, 300)); process.exit(1); }
console.log("✓ Pushed to n8n:", putRes.status, new Date().toISOString());
