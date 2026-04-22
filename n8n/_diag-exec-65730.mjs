import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const execId = process.argv[2] || "65730";

const det = await fetch(`${baseUrl}/executions/${execId}?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
if (!d.data) {
  console.log("No data", JSON.stringify(d).slice(0, 500));
  process.exit(1);
}
const runData = d.data?.resultData?.runData || {};
const err = d.data?.resultData?.error;
console.log("=== Workflow error ===");
console.log(err?.message || "(none)");
console.log(err?.stack?.slice?.(0, 800) || "");

const agentErr = runData["agente_agendador"]?.[0]?.error;
console.log("\n=== agente_agendador error ===");
console.log(agentErr?.message || "(none)");
console.log(agentErr?.description?.slice?.(0, 600) || "");

for (const name of [
  "agd_cs_consultar_vagas",
  "agd_cs_reagendar",
  "agd_cs_agendar",
  "agd_cs_buscar_agendamentos",
  "agd_cs_cancelar",
  "agd_cs_notificar_profissional",
]) {
  const runs = runData[name];
  if (!runs) continue;
  runs.forEach((run, i) => {
    console.log(`\n--- ${name} #${i} ---`);
    if (run.error) {
      console.log("ERROR:", run.error.message);
      console.log(run.error.description?.slice?.(0, 400));
    }
    const j = run?.data?.ai_tool?.[0]?.[0]?.json;
    if (j?.response != null) console.log("response:", String(j.response).slice(0, 600));
  });
}
