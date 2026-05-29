/**
 * Corrige o node "If" do dispatch de resposta: detecta imagem na answer
 * apenas se houver URL terminada em .jpg/.jpeg/.png/.gif/.webp.
 * Antes: contains "https" → qualquer link disparava o sendMedia com media=null.
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");

const IMG_REGEX = "https?:\\/\\/[^\\s]+?\\.(jpg|jpeg|png|gif|webp)(\\?[^\\s]*)?";

function patchIf(node) {
  const cond = node?.parameters?.conditions?.conditions?.[0];
  if (!cond) return false;
  if (cond.operator?.type === "string" && cond.operator?.operation === "regex" && cond.rightValue === IMG_REGEX) return false;
  cond.operator = { type: "string", operation: "regex" };
  cond.rightValue = IMG_REGEX;
  return true;
}

function walk(nodes, label) {
  let n = 0;
  if (!Array.isArray(nodes)) return 0;
  for (const node of nodes) {
    if (node?.name === "If" && node?.type === "n8n-nodes-base.if") {
      if (patchIf(node)) { n++; console.log(`  ✓ ${label} If (${node.id})`); }
    }
  }
  return n;
}

const workflow = JSON.parse(readFileSync(wfPath, "utf8"));
let total = walk(workflow.nodes, "nodes");
if (workflow.activeVersion?.nodes) total += walk(workflow.activeVersion.nodes, "activeVersion");
writeFileSync(wfPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log(`If imagem: ${total} node(s) atualizados`);
