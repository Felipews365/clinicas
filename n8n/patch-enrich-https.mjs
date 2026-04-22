/**
 * Fix: Enrich Agendador usa require('https') — o único jeito de fazer HTTP
 * em Code nodes do n8n (fetch e $helpers.httpRequest não estão disponíveis no sandbox).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const SUPABASE_URL = "https://xkwdwioawosthwjqijfb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhrd2R3aW9hd29zdGh3anFpamZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUyNzUzMywiZXhwIjoyMDkwMTAzNTMzfQ._CoWPqn1bDqNRJ-g6EzGnqE86YI_LW5T_N6At3CPal4";

const enrichCode = `// Pré-busca profissionais via require('https') — fetch não disponível em Code nodes do n8n.
const https = require('https');

function sbGet(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

function sbPost(urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const bodyStr = JSON.stringify(bodyObj);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) }
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

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
let _err_prof = null;
let _err_svc = null;

if (clinicId) {
  // --- Profissionais ---
  try {
    const url = SB_URL + '/rest/v1/cs_profissionais?select=id,nome,especialidade&ativo=eq.true&order=nome.asc&clinic_id=eq.' + clinicId;
    const r = await sbGet(url, sbHeaders);
    if (r.status === 200) {
      const profs = JSON.parse(r.body);
      if (Array.isArray(profs) && profs.length > 0) {
        const linhas = profs.map(p =>
          '  - ' + (p.nome || '?') +
          (p.especialidade ? ' (' + p.especialidade + ')' : '') +
          ' | profissional_id: ' + p.id
        ).join('\\n');
        profBlock = '\\n\\n## PROFISSIONAIS DISPONÍVEIS (use estes profissional_id ao chamar cs_consultar_vagas — NÃO chame cs_consultar_profissionais):\\n' + linhas;
      } else {
        _err_prof = 'empty array: ' + r.body.substring(0, 80);
      }
    } else {
      _err_prof = 'HTTP ' + r.status + ': ' + r.body.substring(0, 80);
    }
  } catch(e) {
    _err_prof = e.constructor.name + ': ' + e.message;
  }

  // --- Serviços ---
  try {
    const r2 = await sbPost(
      SB_URL + '/rest/v1/rpc/n8n_clinic_procedimentos',
      sbHeaders,
      { p_clinic_id: clinicId }
    );
    if (r2.status === 200) {
      const svcs = JSON.parse(r2.body);
      if (Array.isArray(svcs) && svcs.length > 0) {
        const linhas = svcs.slice(0, 20).map(s =>
          '  - ' + (s.nome || '?') +
          (s.preco_a_vista_brl ? ' | R$' + s.preco_a_vista_brl : '') +
          (s.duracao_minutos ? ' | ' + s.duracao_minutos + 'min' : '') +
          ' | servico_id: ' + s.id
        ).join('\\n');
        servicosBlock = '\\n\\n## SERVIÇOS DISPONÍVEIS (use estes servico_id ao chamar cs_agendar — NÃO chame cs_consultar_servicos):\\n' + linhas;
      } else {
        _err_svc = 'empty: ' + r2.body.substring(0, 80);
      }
    } else {
      _err_svc = 'HTTP ' + r2.status + ': ' + r2.body.substring(0, 80);
    }
  } catch(e) {
    _err_svc = e.constructor.name + ': ' + e.message;
  }
}

return [{
  json: {
    ...ctx,
    agent_instructions: (ctx.agent_instructions || '') + profBlock + servicosBlock,
    _profissionais_pre_carregados: profBlock !== '',
    _servicos_pre_carregados: servicosBlock !== '',
    _err_prof,
    _err_svc
  }
}];`;

const enrichNode = data.nodes.find(n => n.name === "Enrich Agendador");
if (!enrichNode) { console.error("Enrich Agendador not found"); process.exit(1); }

enrichNode.parameters.jsCode = enrichCode;
console.log("✓ Updated Enrich Agendador to use require('https')");

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
console.log("✓ Pushed to n8n:", putRes.status, new Date().toISOString());
