import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));

// Check what connects TO agente_agendador
console.log("=== All nodes connecting to agente_agendador ===");
for (const [nodeName, nodeConns] of Object.entries(data.connections)) {
  for (const [connType, conns] of Object.entries(nodeConns)) {
    for (const connArr of conns) {
      for (const conn of connArr) {
        if (conn.node === "agente_agendador") {
          console.log(`  ${nodeName} [${connType}] -> agente_agendador`);
        }
      }
    }
  }
}

// Check agd_ tools connection
console.log("\n=== agd_ tools ai_tool connections ===");
const agdNodes = data.nodes.filter(n => n.name.startsWith("agd"));
for (const n of agdNodes) {
  const conn = data.connections[n.name];
  if (conn?.ai_tool) {
    console.log(`  ${n.name} -> ${JSON.stringify(conn.ai_tool.map(c => c[0]?.node))}`);
  } else {
    console.log(`  ${n.name} -> (NO ai_tool connection)`);
  }
}

// Show agd_cs_buscar_agendamentos placeholders
const buscar = data.nodes.find(n => n.name === "agd_cs_buscar_agendamentos");
console.log("\n=== agd_cs_buscar_agendamentos ===");
console.log("jsonBody:", buscar?.parameters?.jsonBody);
console.log("placeholders:", JSON.stringify(buscar?.parameters?.placeholderDefinitions?.values?.map(p => ({ name: p.name, type: p.type }))));

// Show agd_cs_cancelar placeholders
const cancelar = data.nodes.find(n => n.name === "agd_cs_cancelar");
console.log("\n=== agd_cs_cancelar ===");
console.log("url:", cancelar?.parameters?.url);
console.log("jsonBody:", cancelar?.parameters?.jsonBody);
console.log("placeholders:", JSON.stringify(cancelar?.parameters?.placeholderDefinitions?.values?.map(p => ({ name: p.name, type: p.type }))));
