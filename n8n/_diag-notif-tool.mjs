import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const list = await fetch(`${baseUrl}/executions?limit=15&workflowId=kCX2LfxJrdYWB0vk`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const { data: execs } = await list.json();

for (const exec of execs) {
  const det = await fetch(`${baseUrl}/executions/${exec.id}?includeData=true`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const d = await det.json();
  const runData = d.data?.resultData?.runData || {};
  const notif = runData["agd_cs_notificar_profissional"];
  const agendar = runData["agd_cs_agendar"];
  const cancelar = runData["agd_cs_cancelar"];
  if (!notif && !agendar && !cancelar) continue;

  console.log(`\n=== Exec ${exec.id} ${exec.startedAt} ===`);
  if (agendar) {
    agendar.forEach((r, i) => {
      const resp = r?.data?.ai_tool?.[0]?.[0]?.json?.response;
      console.log(`agd_cs_agendar#${i} response:`, String(resp).substring(0, 400));
      if (r.error) console.log("  error:", r.error.message);
    });
  }
  if (cancelar) {
    cancelar.forEach((r, i) => {
      const resp = r?.data?.ai_tool?.[0]?.[0]?.json?.response;
      console.log(`agd_cs_cancelar#${i} response:`, String(resp).substring(0, 400));
      if (r.error) console.log("  error:", r.error.message);
    });
  }
  if (notif) {
    notif.forEach((r, i) => {
      const resp = r?.data?.ai_tool?.[0]?.[0]?.json?.response;
      console.log(`agd_cs_notificar_profissional#${i} response:`, String(resp).substring(0, 400));
      if (r.error) console.log("  error:", r.error.message);
    });
  } else {
    console.log("agd_cs_notificar_profissional: NOT CALLED");
  }
}
