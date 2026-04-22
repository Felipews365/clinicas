import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const wfId = "kCX2LfxJrdYWB0vk";

const res = await fetch(`${baseUrl}/executions?workflowId=${wfId}&limit=5&includeData=false`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const j = await res.json();
// Get most recent execution with duration > 2s
const exec = (j.data || []).find(e => (new Date(e.stoppedAt) - new Date(e.startedAt)) > 2000);
if (!exec) { console.log("No long execution found"); process.exit(0); }

console.log(`Exec ${exec.id} (${exec.status}) at ${exec.startedAt}`);
const det = await fetch(`${baseUrl}/executions/${exec.id}?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

// Check Enrich Agendador output
const enrichOut = runData["Enrich Agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
const enrichErr = runData["Enrich Agendador"]?.[0]?.error;
if (enrichErr) {
  console.log("\nEnrich Agendador ERROR:", enrichErr.message);
} else if (enrichOut) {
  const instr = enrichOut.agent_instructions || "";
  console.log("\nEnrich Agendador OK:");
  console.log("  has PROFISSIONAIS:", instr.includes("PROFISSIONAIS DISPONÍVEIS"));
  console.log("  has profissional_id:", instr.includes("profissional_id:"));
  console.log("  has SERVIÇOS:", instr.includes("SERVIÇOS DISPONÍVEIS"));
  // Show profissionais section
  const profMatch = instr.match(/## PROFISSIONAIS[^\n]*\n((?:[^\n]+\n?){0,10})/);
  if (profMatch) console.log("  Profissionais:\n" + profMatch[0].substring(0, 300));
  else console.log("  [No PROFISSIONAIS section found]");
  console.log("  agent_instructions length:", instr.length);
} else {
  console.log("\nEnrich Agendador: no data found (node didn't run?)");
}

// agente_agendador error
const agErr = runData["agente_agendador"]?.[0]?.error;
console.log("\nagente_agendador error:", agErr?.message?.substring(0, 200));

// Tool runs
const toolNames = ["agd_cs_consultar_profissionais","agd_cs_consultar_vagas",
  "agd_cs_consultar_servicos","agd_cs_agendar","agd_cs_buscar_agendamentos"];
toolNames.forEach(name => {
  const runs = runData[name];
  if (!runs) return;
  runs.forEach((run, i) => {
    if (run.error) console.log(`\nTOOL ERROR [${name}]#${i}: ${run.error.message?.substring(0,100)}`);
    else {
      const out = run?.data?.main?.[0]?.[0]?.json;
      console.log(`\nTOOL OK [${name}]#${i}: ${JSON.stringify(out).substring(0,100)}`);
    }
  });
});

// mensagem
const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
console.log("\nmensagem:", JSON.stringify(mc?.mensagem));
console.log("nodes ran:", Object.keys(runData).join(", ").substring(0, 200));
