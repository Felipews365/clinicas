import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Get the booking exec (likely 65628 or 65629 - long ones)
// Let's inspect the one that had the "sim" confirmation
const execs = [65630, 65629, 65628, 65626];
for (const execId of execs) {
  const det = await fetch(`${baseUrl}/executions/${execId}?includeData=true`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const d = await det.json();
  const runData = d.data?.resultData?.runData || {};
  const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
  const agOut = runData["agente_agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
  
  if (!mc) continue;
  console.log(`\n=== Exec ${execId} ===`);
  console.log("mensagem:", mc?.mensagem);
  if (agOut) console.log("agent output:", agOut.output?.substring(0, 200));
  
  // Check tool runs
  const TOOLS = ["agd_cs_buscar_agendamentos","agd_cs_consultar_vagas","agd_cs_agendar",
    "agd_cs_notificar_profissional"];
  TOOLS.forEach(name => {
    const runs = runData[name];
    if (!runs) return;
    runs.forEach((run, i) => {
      if (run.error) {
        console.log(`  ❌ ${name}: ${run.error.message?.substring(0,100)}`);
      } else {
        const out = run?.data?.main?.[0]?.[0]?.json;
        console.log(`  ✓ ${name}: ${JSON.stringify(out || 'no output').substring(0,150)}`);
      }
    });
  });
  
  // Check if agente_agendador ran
  if (runData["agente_agendador"]) {
    const err = runData["agente_agendador"]?.[0]?.error;
    if (err) console.log("  Agent error:", err.message?.substring(0,100));
  }
}
