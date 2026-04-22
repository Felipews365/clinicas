import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));

const n = data.nodes.find(x => x.name === "agd_cs_consultar_vagas");
console.log(JSON.stringify(n, null, 2));
