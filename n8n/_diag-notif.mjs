import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const det = await fetch(`${baseUrl}/executions/65630?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

// Check agd_cs_agendar in detail
const agendar = runData["agd_cs_agendar"]?.[0];
console.log("=== agd_cs_agendar ===");
if (agendar?.error) {
  console.log("ERROR:", agendar.error.message);
} else {
  console.log("data keys:", Object.keys(agendar?.data || {}));
  // Try all possible output paths
  const allPaths = [
    agendar?.data?.main?.[0]?.[0]?.json,
    agendar?.data?.["ai_tool"]?.[0]?.[0]?.json,
    agendar?.outputItems?.[0],
  ];
  allPaths.forEach((p, i) => {
    if (p) console.log(`  path[${i}]:`, JSON.stringify(p).substring(0, 300));
  });
}

// Check agd_cs_notificar_profissional
const notif = runData["agd_cs_notificar_profissional"]?.[0];
console.log("\n=== agd_cs_notificar_profissional ===");
if (notif?.error) {
  console.log("ERROR:", notif.error.message, notif.error.description?.substring(0,200));
} else {
  console.log("data keys:", Object.keys(notif?.data || {}));
  const allPaths = [
    notif?.data?.main?.[0]?.[0]?.json,
    notif?.data?.["ai_tool"]?.[0]?.[0]?.json,
  ];
  allPaths.forEach((p, i) => {
    if (p) console.log(`  path[${i}]:`, JSON.stringify(p).substring(0, 300));
  });
}

// agent full output
const agOut = runData["agente_agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
console.log("\n=== agent output text ===");
console.log(agOut?.output?.substring(0, 500));
