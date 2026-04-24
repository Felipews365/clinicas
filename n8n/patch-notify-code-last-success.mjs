/**
 * Atualiza "Code auto-notify profissional" para resolver WhatsApp via RPC
 * n8n_cs_profissional_whatsapp_mudanca_recente — tools LangChain (ai_tool) não
 * são legíveis com $('node').all() no Code (só branch main).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");

const newJsCode = `const item = { ...$input.first().json };

const ctx = $('Monta Contexto').first().json;
const inst = String($('Edit Fields1').first().json.instanceName || '').trim();
const nome = String(ctx.nome_cliente || 'Cliente').trim();
const tail = String(item.output || '').trim().slice(-400);
const out = String(item.output || '');

const looksLikeMutation =
  /(reagendad|agendad\\s+com\\s+sucesso|agendamento[^\\n]{0,120}sucesso|cancelad|cancelamento)/i.test(
    out,
  );

let notify = null;

if (looksLikeMutation && ctx.clinic_id) {
  const remoteJid = String(ctx.remoteJid || '');
  const SUPABASE_URL = 'https://xkwdwioawosthwjqijfb.supabase.co';
  const SUPABASE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhrd2R3aW9hd29zdGh3anFpamZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUyNzUzMywiZXhwIjoyMDkwMTAzNTMzfQ._CoWPqn1bDqNRJ-g6EzGnqE86YI_LW5T_N6At3CPal4';

  let rpc = null;
  try {
    rpc = await $helpers.httpRequest({
      method: 'POST',
      url: SUPABASE_URL.replace(/\\/+$/, '') + '/rest/v1/rpc/n8n_cs_profissional_whatsapp_mudanca_recente',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_clinic_id: ctx.clinic_id, p_telefone: remoteJid }),
    });
  } catch {
    rpc = null;
  }

  if (rpc && rpc.ok === true && rpc.profissional_whatsapp) {
    const num = String(rpc.profissional_whatsapp).replace(/\\D/g, '');
    if (num.length >= 12) {
      const prefix = /reagendad/i.test(out)
        ? '🔄 Reagendamento (IA): '
        : /cancel/i.test(out)
          ? '❌ Cancelamento (IA): '
          : '📅 Novo agendamento (IA): ';
      notify = {
        number: num,
        instanceName: inst,
        text: prefix + nome + (tail ? '\\n' + tail : '\\nVerifique o painel da clínica.'),
      };
    }
  }
}

return [{ json: { ...item, _evolution_notify: notify } }];`;

const wf = JSON.parse(fs.readFileSync(wfPath, "utf8"));
const n = wf.nodes.find((x) => x.name === "Code auto-notify profissional");
if (!n) throw new Error("Code auto-notify profissional not found");
n.parameters.jsCode = newJsCode;
fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2) + "\n");
console.log("OK:", wfPath);
