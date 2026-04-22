import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));

const agent = data.nodes.find(n => n.name === "agente_agendador");
const sm = agent?.parameters?.options?.systemMessage || agent?.parameters?.systemMessage || "";
console.log("=== systemMessage ===\n" + sm.substring(0, 3000));
