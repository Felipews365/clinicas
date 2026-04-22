import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));

// Find HTTP Request nodes (not tool ones)
const httpNodes = data.nodes.filter(n => n.type === "n8n-nodes-base.httpRequest");
httpNodes.slice(0, 2).forEach(n => {
  console.log("=== Node:", n.name, "===");
  console.log(JSON.stringify(n, null, 2).substring(0, 1500));
  console.log();
});

// Also show Enrich Agendador connections
const conns = data.connections;
Object.entries(conns).forEach(([from, targets]) => {
  const t = JSON.stringify(targets);
  if (t.includes("Enrich Agendador") || t.includes("agente_agendador")) {
    console.log(`${from} → ...`);
  }
});

// Show Enrich Agendador node
const enrich = data.nodes.find(n => n.name === "Enrich Agendador");
console.log("\nEnrich Agendador id:", enrich?.id, "pos:", enrich?.position);

// Show IF mensagem valida
const ifNode = data.nodes.find(n => n.name === "IF mensagem válida");
console.log("IF mensagem válida id:", ifNode?.id, "pos:", ifNode?.position);
console.log("Connections FROM IF mensagem válida:", JSON.stringify(conns["IF mensagem válida"]));
