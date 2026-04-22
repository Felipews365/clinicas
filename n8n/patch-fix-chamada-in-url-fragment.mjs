/**
 * Fix v3: "Misconfigured placeholder 'chamada'" — headers approach failed.
 *
 * n8n v2.10.3 toolHttpRequest v1.1 validates placeholder usage ONLY in:
 *   - URL field (raw string)
 *   - jsonBody field (raw string)
 *   - query parameters
 *   (NOT in custom headers)
 *
 * Solution: embed '#{chamada}' as a string literal INSIDE the URL expression.
 *
 *   Before: ={{ 'https://...path' + clinicId }}
 *   After:  ={{ 'https://...path' + clinicId + '#{chamada}' }}
 *
 * n8n scans the raw expression string for {chamada} → FOUND → validation passes ✓
 * At runtime: expression produces "https://...path/CLINIC_ID#{chamada}".
 *   Then n8n substitutes {chamada} → LLM value (always "").
 *   Final URL: "https://...path/CLINIC_ID#"
 *   axios/node-fetch strips URL fragments before HTTP request → server never sees it ✓
 *
 * Also removes the X-Noop header from the previous (failed) attempt.
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
  const hasChamada = ph.some((p) => p.name === "chamada");
  if (!hasChamada) return;

  const rawUrl = node.parameters?.url || "";

  // Already patched?
  if (rawUrl.includes("#{chamada}")) {
    console.log(`✓ ${node.name}: URL already has #{chamada}.`);
  } else if (rawUrl.startsWith("={{") && rawUrl.endsWith("}}")) {
    // Full n8n expression — append + '#{chamada}' before closing }}
    const inner = rawUrl.slice(3, -2).trimEnd(); // strip ={{ and }}
    node.parameters.url = `={{ ${inner} + '#{chamada}' }}`;
    console.log(`✓ ${node.name}: appended + '#{chamada}' to URL expression.`);
    changed++;
  } else {
    // Template URL — append fragment directly
    node.parameters.url = rawUrl.replace(/[#].*$/, "") + "#{chamada}";
    console.log(`✓ ${node.name}: appended #{chamada} to URL template.`);
    changed++;
  }

  // Remove the X-Noop header (it didn't help — cleanup)
  const headers = node.parameters?.headerParameters?.parameters || [];
  const withoutNoop = headers.filter((h) => h.name !== "X-Noop");
  if (withoutNoop.length < headers.length) {
    node.parameters.headerParameters.parameters = withoutNoop;
    // If no more custom headers, disable sendHeaders (unless other headers exist)
    if (withoutNoop.length === 0) {
      node.parameters.sendHeaders = false;
      delete node.parameters.headerParameters;
    }
    console.log(`   (removed X-Noop header)`);
  }
});

if (changed === 0) {
  console.log("Nothing to change.");
} else {
  fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
  console.log(`\n✓ ${changed} node(s) updated.`);
}

// ---- Verify ----
console.log("\nVerification — chamada-placeholder tools:");
httpTools.forEach((n) => {
  const ph = n.parameters?.placeholderDefinitions?.values || [];
  if (!ph.some((p) => p.name === "chamada")) return;
  const url = n.parameters?.url || "";
  const inUrl = url.includes("{chamada}");
  const headers = n.parameters?.headerParameters?.parameters || [];
  const noop = headers.find((h) => h.name === "X-Noop");
  console.log(`  ${inUrl ? "✓" : "✗"} ${n.name}`);
  console.log(`      {chamada} in URL: ${inUrl}`);
  console.log(`      X-Noop header: ${noop ? "still present" : "removed"}`);
  console.log(`      URL tail: ...${url.slice(-50)}`);
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
