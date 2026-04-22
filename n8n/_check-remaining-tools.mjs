import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));

const AGENDADOR_TOOLS = [
  "agd_cs_buscar_agendamentos","agd_cs_consultar_vagas","agd_cs_agendar",
  "agd_cs_reagendar","agd_cs_cancelar","agd_cs_notificar_profissional","Refletir agendador"
];

AGENDADOR_TOOLS.forEach(name => {
  const node = data.nodes.find(n => n.name === name);
  if (!node) { console.log(`${name}: NOT FOUND`); return; }
  const placeholders = node.parameters?.placeholderDefinitions?.values || [];
  const chamadaPlaceholder = placeholders.find(p => p.name === "chamada");
  console.log(`${name}:`);
  console.log(`  type: ${node.type}`);
  console.log(`  placeholders: ${JSON.stringify(placeholders.map(p => p.name))}`);
  if (chamadaPlaceholder) {
    console.log(`  ⚠️  HAS 'chamada' dummy placeholder!`);
    // Check if chamada is required (i.e., would fail with empty args)
    console.log(`  chamada required: ${chamadaPlaceholder.required !== false}`);
  }
  console.log();
});
