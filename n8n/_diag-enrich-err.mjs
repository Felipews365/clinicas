import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const r = await fetch(`${baseUrl}/executions?workflowId=kCX2LfxJrdYWB0vk&limit=20&includeData=false`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const j = await r.json();

console.log("Recent executions:");
(j.data || []).slice(0, 10).forEach(e => {
  const d = (new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000;
  console.log(` ${e.id} ${e.status} ${d.toFixed(1)}s ${e.startedAt}`);
});

// Find any exec where Enrich Agendador ran (duration > 5s = agendador)
const longExecs = (j.data || []).filter(e => {
  const d = (new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000;
  return d > 5;
});
if (!longExecs.length) { console.log("\nNo long executions yet. Send a scheduling message first."); process.exit(0); }

// Use the latest long exec
const exec = longExecs[0];
console.log("\nInspecting exec", exec.id, exec.status, exec.startedAt);

const det = await fetch(`${baseUrl}/executions/${exec.id}?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

// Enrich Agendador output
const enrichOut = runData["Enrich Agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
if (!enrichOut) {
  console.log("Enrich Agendador did not run (message didn't reach agendador)");
} else {
  console.log("\n=== Enrich Agendador output ===");
  console.log("_profissionais_pre_carregados:", enrichOut._profissionais_pre_carregados);
  console.log("_err_prof:", enrichOut._err_prof);
  console.log("_err_svc:", enrichOut._err_svc);
  console.log("_clinic_id_used:", enrichOut._clinic_id_used);
  const instr = enrichOut.agent_instructions || "";
  console.log("agent_instructions length:", instr.length);
  console.log("has PROFISSIONAIS:", instr.includes("PROFISSIONAIS"));
}

// agente_agendador error
const agErr = runData["agente_agendador"]?.[0]?.error;
if (agErr) console.log("\nagente_agendador error:", agErr.message?.substring(0, 200));
else console.log("\nagente_agendador: OK (no error)");
