/**
 * Versão debug do Enrich Agendador: captura erro em campo ao invés de silenciar.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const SUPABASE_URL = "https://xkwdwioawosthwjqijfb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhrd2R3aW9hd29zdGh3anFpamZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUyNzUzMywiZXhwIjoyMDkwMTAzNTMzfQ._CoWPqn1bDqNRJ-g6EzGnqE86YI_LW5T_N6At3CPal4";

const enrichCode = `const ctx = $input.first().json;
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
let _err_prof = null;
let _err_svc = null;

if (clinicId) {
  // --- Profissionais ---
  try {
    const url = SB_URL + '/rest/v1/cs_profissionais?select=id,nome,especialidade&ativo=eq.true&order=nome.asc&clinic_id=eq.' + clinicId;
    const resp = await fetch(url, { method: 'GET', headers: sbHeaders });
    const body = await resp.text();
    if (resp.ok) {
      const profs = JSON.parse(body);
      if (Array.isArray(profs) && profs.length > 0) {
        const linhas = profs.map(p =>
          '  - ' + (p.nome || '?') +
          (p.especialidade ? ' (' + p.especialidade + ')' : '') +
          ' | profissional_id: ' + p.id
        ).join('\\n');
        profBlock = '\\n\\n## PROFISSIONAIS DISPONÍVEIS (use estes profissional_id ao chamar cs_consultar_vagas — NÃO chame cs_consultar_profissionais):\\n' + linhas;
      } else {
        _err_prof = 'empty: ' + body.substring(0, 100);
      }
    } else {
      _err_prof = 'HTTP ' + resp.status + ': ' + body.substring(0, 100);
    }
  } catch(e) {
    _err_prof = e.constructor.name + ': ' + e.message;
  }
}

return [{
  json: {
    ...ctx,
    agent_instructions: (ctx.agent_instructions || '') + profBlock,
    _profissionais_pre_carregados: profBlock !== '',
    _err_prof,
    _err_svc,
    _clinic_id_used: clinicId
  }
}];`;

const enrichNode = data.nodes.find(n => n.name === "Enrich Agendador");
enrichNode.parameters.jsCode = enrichCode;

fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");

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
console.log("✓ Pushed debug version:", putRes.status, new Date().toISOString());
console.log("Agora manda uma mensagem e rode: node _diag-enrich-err.mjs");
