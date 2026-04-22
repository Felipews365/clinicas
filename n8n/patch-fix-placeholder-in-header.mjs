/**
 * Fix v2: "Misconfigured placeholder 'chamada'" 
 *
 * n8n v2.10.3 validates that every defined placeholder appears somewhere in the
 * request (URL, headers, or body). Our dummy {chamada} placeholder isn't in any
 * of those → n8n rejects the tool before the agent even starts.
 *
 * Fix: move {chamada} into a custom header "X-Noop" that the server ignores.
 * n8n sees the placeholder is "used" (in headers), validation passes.
 * At runtime: LLM sends {"chamada":""} → n8n substitutes X-Noop: "" → server ignores it.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const httpTools = data.nodes.filter(
  (n) => n.type === "@n8n/n8n-nodes-langchain.toolHttpRequest"
);

let changed = 0;
httpTools.forEach((node) => {
  const ph = node.parameters?.placeholderDefinitions?.values || [];
  const chamadaPh = ph.find((p) => p.name === "chamada");
  if (!chamadaPh) return; // not a dummy-placeholder node

  // Check if {chamada} already appears in URL, body, or any existing header value
  const urlStr = String(node.parameters?.url || "");
  const bodyStr = String(node.parameters?.jsonBody || "");
  const existingHeaders = node.parameters?.headerParameters?.parameters || [];
  const alreadyInHeader = existingHeaders.some((h) => String(h.value || "").includes("{chamada}"));
  const alreadyInUrl = urlStr.includes("{chamada}");
  const alreadyInBody = bodyStr.includes("{chamada}");

  if (alreadyInHeader || alreadyInUrl || alreadyInBody) {
    console.log(`✓ ${node.name}: {chamada} already referenced somewhere.`);
    return;
  }

  // Add X-Noop header with {chamada}
  node.parameters.sendHeaders = true;
  if (!node.parameters.headerParameters) {
    node.parameters.headerParameters = { parameters: [] };
  }
  if (!node.parameters.headerParameters.parameters) {
    node.parameters.headerParameters.parameters = [];
  }

  // Don't duplicate if already exists
  const existsNoop = node.parameters.headerParameters.parameters.some(
    (h) => h.name === "X-Noop"
  );
  if (!existsNoop) {
    node.parameters.headerParameters.parameters.push({ name: "X-Noop", value: "{chamada}" });
  }

  console.log(`✓ ${node.name}: added header X-Noop: {chamada}`);
  changed++;
});

if (changed === 0) {
  console.log("Nothing to change.");
  process.exit(0);
}

fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log(`\n✓ ${changed} node(s) updated.`);

// ---- Verify ----
console.log("\nVerification:");
httpTools.forEach((n) => {
  const ph = n.parameters?.placeholderDefinitions?.values || [];
  const hasChamada = ph.some((p) => p.name === "chamada");
  if (!hasChamada) return;
  const hdrs = n.parameters?.headerParameters?.parameters || [];
  const noopHdr = hdrs.find((h) => h.name === "X-Noop");
  console.log(`  ${n.name}: X-Noop header = "${noopHdr?.value || "(missing!)"}", sendHeaders=${n.parameters.sendHeaders}`);
});

// ---- Push to n8n ----
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const workflowId = data.id;

console.log(`\nPushing workflow ${workflowId} to n8n...`);
const getRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
if (!getRes.ok) { console.error("GET failed", getRes.status); process.exit(1); }
const current = await getRes.json();

const putRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: data.name ?? current.name,
    nodes: data.nodes,
    connections: data.connections,
    settings: { executionOrder: current.settings?.executionOrder ?? "v1" },
    staticData: current.staticData ?? undefined,
  }),
});
const text = await putRes.text();
if (!putRes.ok) { console.error("PUT failed", putRes.status, text.substring(0,300)); process.exit(1); }
console.log("✓ Pushed to n8n:", putRes.status, text.slice(0, 120));
