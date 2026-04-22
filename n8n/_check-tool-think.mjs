import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));

const n = data.nodes.find(x => x.name === "Refletir agendador");
console.log("Refletir agendador:");
console.log(JSON.stringify(n, null, 2));

// Check Chat Model agendador
const cm = data.nodes.find(x => x.name === "Chat Model agendador");
console.log("\nChat Model agendador:");
console.log(JSON.stringify(cm?.parameters, null, 2));
