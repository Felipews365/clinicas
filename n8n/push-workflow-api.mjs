/**
 * PUT workflow no n8n (usa credenciais do .cursor/mcp.json).
 * Uso: node push-workflow-api.mjs <workflowId|null> <path-to-partial-json>
 * Se workflowId for "null", usa o id dentro do JSON (campo id opcional).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpPath = path.join(__dirname, "..", ".cursor", "mcp.json");
const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const widArg = process.argv[2];
const filePath = process.argv[3];
if (!filePath) {
  console.error("Usage: node push-workflow-api.mjs <workflowId> <json-path>");
  process.exit(1);
}

const partial = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
const workflowId = widArg && widArg !== "null" ? widArg : partial.id;
if (!workflowId) {
  console.error("Missing workflow id");
  process.exit(1);
}

const getRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
if (!getRes.ok) {
  console.error("GET failed", getRes.status, await getRes.text());
  process.exit(1);
}
const current = await getRes.json();

const body = {
  name: partial.name ?? current.name,
  nodes: partial.nodes ?? current.nodes,
  connections: partial.connections ?? current.connections,
  settings: {
    executionOrder: current.settings?.executionOrder ?? "v1",
  },
  staticData: current.staticData ?? undefined,
};

const putRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  method: "PUT",
  headers: {
    "X-N8N-API-KEY": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
const text = await putRes.text();
if (!putRes.ok) {
  console.error("PUT failed", putRes.status, text);
  process.exit(1);
}
console.log("OK", putRes.status, text.slice(0, 500));
