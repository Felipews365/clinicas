import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Get last 5 executions
const list = await fetch(`${baseUrl}/executions?limit=5&workflowId=kCX2LfxJrdYWB0vk`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const { data: execs } = await list.json();
console.log("Last 5 executions:");
execs.forEach(e => console.log(` ${e.id} ${e.status} ${e.startedAt}`));

// Find the one that ran the agendador
for (const exec of execs) {
  const det = await fetch(`${baseUrl}/executions/${exec.id}?includeData=true`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const d = await det.json();
  const runData = d.data?.resultData?.runData || {};
  
  if (!runData["agente_agendador"]) continue;
  
  console.log(`\n=== Exec ${exec.id} (agendador ran) ===`);
  
  const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
  console.log("remoteJid:", mc?.remoteJid);
  console.log("clinica_id:", mc?.clinica_id || mc?.clinic_id);

  // Check buscar tool
  const buscarRuns = runData["agd_cs_buscar_agendamentos"];
  if (buscarRuns) {
    buscarRuns.forEach((run, i) => {
      console.log(`\nagd_cs_buscar_agendamentos#${i}:`);
      if (run.error) {
        console.log("  ERROR:", run.error.message?.substring(0, 200));
        console.log("  description:", run.error.description?.substring(0, 200));
      } else {
        const resp = run?.data?.ai_tool?.[0]?.[0]?.json?.response;
        console.log("  response:", String(resp).substring(0, 500));
      }
      // Show input params
      const inp = run?.data?.ai_tool?.[0]?.[0]?.json?.input;
      if (inp) console.log("  input:", JSON.stringify(inp).substring(0, 200));
    });
  } else {
    console.log("agd_cs_buscar_agendamentos: did NOT run");
  }

  // Agent output
  const agOut = runData["agente_agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
  console.log("\nAgent output:", agOut?.output?.substring(0, 300));
  
  break;
}
