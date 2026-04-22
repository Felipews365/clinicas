import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Get recent executions
const r = await fetch(`${baseUrl}/executions?workflowId=kCX2LfxJrdYWB0vk&limit=20&includeData=false`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const j = await r.json();
const execs = (j.data || []).filter(e => {
  const d = (new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000;
  return d > 1;
});

// Check a few to find the webhook apikey
for (const exec of execs.slice(0, 5)) {
  const det = await fetch(`${baseUrl}/executions/${exec.id}?includeData=true`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const d = await det.json();
  const runData = d.data?.resultData?.runData || {};
  const webhook = runData["Webhook"]?.[0]?.data?.main?.[0]?.[0]?.json;
  if (webhook) {
    const evoApiKey = webhook.body?.apikey || webhook.headers?.apikey;
    if (evoApiKey) {
      console.log(`Exec ${exec.id}: Evolution apikey = ${evoApiKey}`);
      break;
    }
  }
}
