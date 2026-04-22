import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));

// Show all connections that point to agente_agendador as ai_tool
Object.entries(data.connections).forEach(([from, targets]) => {
  const all = Object.values(targets).flat(2);
  if (all.some(t => t.node === "agente_agendador" && t.type === "ai_tool")) {
    console.log(`Tool connected to agente_agendador: "${from}"`);
  }
});
