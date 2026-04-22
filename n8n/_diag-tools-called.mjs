import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const det = await fetch(`${baseUrl}/executions/65166?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

// Check ALL tool nodes
const TOOLS = ["agd_cs_buscar_agendamentos","agd_cs_consultar_vagas","agd_cs_agendar",
  "agd_cs_reagendar","agd_cs_cancelar","agd_cs_notificar_profissional","Refletir agendador",
  "agd_cs_consultar_profissionais","agd_cs_consultar_servicos"];

console.log("=== Tool runs in exec 65166 ===");
TOOLS.forEach(name => {
  const runs = runData[name];
  if (!runs) { console.log(`  [--]  ${name}: did NOT run`); return; }
  runs.forEach((run, i) => {
    if (run.error) {
      console.log(`  [ERR] ${name}#${i}: ${run.error.message?.substring(0, 150)}`);
      console.log(`        stack: ${run.error.stack?.substring(0, 200)}`);
    } else {
      const inp = run?.inputOverride ? JSON.stringify(run.inputOverride).substring(0, 100) : "n/a";
      const out = run?.data?.main?.[0]?.[0]?.json;
      console.log(`  [OK ] ${name}#${i}: in=${inp} out=${JSON.stringify(out).substring(0, 100)}`);
    }
  });
});

// Get agente_agendador full error incl description
const agErr = runData["agente_agendador"]?.[0]?.error;
console.log("\n=== agente_agendador FULL error ===");
console.log(JSON.stringify(agErr, null, 2).substring(0, 2000));
