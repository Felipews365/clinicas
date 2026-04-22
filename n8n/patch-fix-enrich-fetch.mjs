/**
 * Fix: Enrich Agendador usava $helpers.httpRequest() que não existe em Code nodes.
 * Troca para fetch() nativo (Node 18+, disponível em n8n 2.x).
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
// Usa fetch() nativo (Node 18+) — $helpers.httpRequest() não funciona em Code nodes.

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

let profBlock = '';
let servicosBlock = '';

if (clinicId) {
  // --- Profissionais ---
  try {
    const resp = await fetch(
      SB_URL + '/rest/v1/cs_profissionais?select=id,nome,especialidade&ativo=eq.true&order=nome.asc&clinic_id=eq.' + clinicId,
      { headers: sbHeaders }
    );
    if (resp.ok) {
      const profs = await resp.json();
      if (Array.isArray(profs) && profs.length > 0) {
        const linhas = profs.map(p =>
          '  - ' + (p.nome || '?') +
          (p.especialidade ? ' (' + p.especialidade + ')' : '') +
          ' | profissional_id: ' + p.id
        ).join('\\n');
        profBlock = '\\n\\n## PROFISSIONAIS DISPONÍVEIS (use estes profissional_id ao chamar cs_consultar_vagas e cs_agendar — NÃO chame cs_consultar_profissionais):\\n' + linhas;
      }
    }
  } catch(e) { /* fallback silencioso */ }

  // --- Serviços ---
  try {
    const resp2 = await fetch(
      SB_URL + '/rest/v1/rpc/n8n_clinic_procedimentos',
      {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({ p_clinic_id: clinicId })
      }
    );
    if (resp2.ok) {
      const svcs = await resp2.json();
      if (Array.isArray(svcs) && svcs.length > 0) {
        const linhas = svcs.slice(0, 20).map(s =>
          '  - ' + (s.nome || '?') +
          (s.preco_a_vista_brl ? ' | R$' + s.preco_a_vista_brl : s.valor_brl ? ' | R$' + s.valor_brl : '') +
          (s.duracao_minutos ? ' | ' + s.duracao_minutos + 'min' : '') +
          ' | servico_id: ' + s.id
        ).join('\\n');
        servicosBlock = '\\n\\n## SERVIÇOS DISPONÍVEIS (use estes servico_id ao chamar cs_agendar — NÃO chame cs_consultar_servicos):\\n' + linhas;
      }
    }
  } catch(e) { /* fallback silencioso */ }
}

return [{
  json: {
    ...ctx,
    agent_instructions: (ctx.agent_instructions || '') + profBlock + servicosBlock,
    _profissionais_pre_carregados: profBlock !== '',
    _servicos_pre_carregados: servicosBlock !== ''
  }
}];`;

const enrichNode = data.nodes.find(n => n.name === "Enrich Agendador");
if (!enrichNode) { console.error("Enrich Agendador not found"); process.exit(1); }

enrichNode.parameters.jsCode = enrichCode;
console.log("✓ Updated Enrich Agendador to use fetch() (", enrichCode.length, "chars)");

fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("✓ Saved.");

// Push
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
const text = await putRes.text();
if (!putRes.ok) { console.error("PUT failed:", text.substring(0, 200)); process.exit(1); }
console.log("✓ Pushed to n8n:", putRes.status, new Date().toISOString());
