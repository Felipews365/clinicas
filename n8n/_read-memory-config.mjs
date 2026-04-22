import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));

// Memory agendador config
const memNode = data.nodes.find(n => n.name === "Memory agendador");
console.log("Memory agendador params:", JSON.stringify(memNode?.parameters, null, 2));

// Also check the Supabase MCP tool descriptor to understand n8n_chat_histories
