import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Check execs 65650 and 65651 - look for Evolution API node outputs
for (const execId of [65650, 65651]) {
  const det = await fetch(`${baseUrl}/executions/${execId}?includeData=true`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const d = await det.json();
  const runData = d.data?.resultData?.runData || {};
  
  console.log(`\n=== Exec ${execId} ===`);
  
  // Check all Evolution API nodes
  for (const nodeName of ["Evolution API", "Evolution API1"]) {
    const runs = runData[nodeName];
    if (runs) {
      runs.forEach((run, i) => {
        const inp = run?.data?.main?.[0]?.[0]?.json;
        if (inp) console.log(`${nodeName}#${i} output:`, JSON.stringify(inp).substring(0, 200));
        if (run.error) console.log(`${nodeName}#${i} error:`, run.error.message?.substring(0, 100));
      });
    }
  }
  
  // Also check memory state
  const mem = runData["Memory qualifica"];
  if (mem) {
    console.log("Memory qualifica ran:", mem.length, "time(s)");
  }
  
  // Check the Monta Contexto output 
  const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
  if (mc) {
    console.log("is_first_message:", mc.is_first_message);
    console.log("nome_cliente:", mc.nome_cliente);
    console.log("saudacao_retorno:", mc.saudacao_retorno);
  }
  
  // Print all node names that ran
  console.log("Nodes that ran:", Object.keys(runData).join(", "));
}
