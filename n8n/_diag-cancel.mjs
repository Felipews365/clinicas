import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

for (const execId of [65651, 65650]) {
  const det = await fetch(`${baseUrl}/executions/${execId}?includeData=true`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const d = await det.json();
  const runData = d.data?.resultData?.runData || {};
  
  const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
  if (!mc) continue;
  
  console.log(`\n=== Exec ${execId} ===`);
  console.log("mensagem:", mc.mensagem);
  console.log("nome_cliente:", mc.nome_cliente);
  console.log("remoteJid:", mc.remoteJid);

  // Check agd_cs_buscar_agendamentos  
  const buscarRuns = runData["agd_cs_buscar_agendamentos"];
  if (buscarRuns) {
    buscarRuns.forEach((run, i) => {
      console.log(`\nagd_cs_buscar_agendamentos#${i}:`);
      if (run.error) {
        console.log("  ERROR:", run.error.message?.substring(0, 150));
        console.log("  description:", run.error.description?.substring(0, 150));
      } else {
        const resp = run?.data?.ai_tool?.[0]?.[0]?.json?.response;
        console.log("  response:", String(resp).substring(0, 300));
      }
    });
  }

  // Agent error or output
  const agErr = runData["agente_agendador"]?.[0]?.error;
  const agOut = runData["agente_agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
  if (agErr) console.log("\nAgent ERROR:", agErr.message?.substring(0, 150));
  if (agOut) console.log("\nAgent output:", agOut.output?.substring(0, 300));

  // Check qualifica
  const qualOut = runData["agente_atende_qualifica"]?.[0]?.data?.main?.[0]?.[0]?.json;
  if (qualOut) console.log("\nQualifica output:", qualOut.output?.substring(0, 200));

  // Read buscar node config
  const data2 = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));
  const buscarNode = data2.nodes.find(n => n.name === "agd_cs_buscar_agendamentos");
  console.log("\nagd_cs_buscar_agendamentos config:");
  console.log("  url:", buscarNode?.parameters?.url);
  console.log("  placeholders:", JSON.stringify(buscarNode?.parameters?.placeholderDefinitions?.values?.map(p=>p.name)));
  console.log("  body:", buscarNode?.parameters?.jsonBody?.substring(0, 200));
}
