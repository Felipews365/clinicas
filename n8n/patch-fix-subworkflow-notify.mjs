/**
 * Corrige o sub-workflow "Notificar Profissional — Agendamentos":
 * 1. Busca Instância Clínica: clinics.instancia_evolution (null) → clinic_whatsapp_integrations.instance_name
 * 2. Monta Mensagem: referência instancia_evolution → instance_name
 * 3. Envia WhatsApp Profissional: apikey correta (igual ao workflow principal)
 */
const WF_ID = "gG29uDWAhyok73jj";
const N8N_URL = "https://n8n.vps7846.panel.icontainer.cloud/api/v1";
const N8N_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkODUwY2QwZi02YmZhLTRhNmQtYWI1YS01NTUyMWNmZDY4NTQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMWFkZDg2M2UtOTQ5OC00YmRlLWI5YzQtNDZlYzA0MDJmMTM5IiwiaWF0IjoxNzc1MzM1MzM2fQ.FhHzhSbzBHU9TchtkN-zD1W2tCwZQaz8zjtK7pmQXjs";
const EVO_KEY = "E24A6298-300E-4794-89C8-23783D858B12";

const getRes = await fetch(`${N8N_URL}/workflows/${WF_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_KEY },
});
if (!getRes.ok) throw new Error(`GET failed: ${getRes.status} ${await getRes.text()}`);
const wf = await getRes.json();

// Fix 1: Busca Instância Clínica → usar clinic_whatsapp_integrations
const busca = wf.nodes.find((n) => n.name === "Busca Instância Clínica");
if (!busca) throw new Error("Node 'Busca Instância Clínica' not found");
busca.parameters.url =
  "={{ 'https://xkwdwioawosthwjqijfb.supabase.co/rest/v1/clinic_whatsapp_integrations?select=instance_name&clinic_id=eq.' + $json.clinic_id }}";
console.log("Fixed: Busca Instância Clínica URL → clinic_whatsapp_integrations.instance_name");

// Fix 2: Monta Mensagem → instance_name
const monta = wf.nodes.find((n) => n.name === "Monta Mensagem");
if (!monta) throw new Error("Node 'Monta Mensagem' not found");
monta.parameters.jsCode = monta.parameters.jsCode.replace(/instancia_evolution/g, "instance_name");
console.log("Fixed: Monta Mensagem instancia_evolution → instance_name");

// Fix 3: Envia WhatsApp Profissional → apikey correta
const envia = wf.nodes.find((n) => n.name === "Envia WhatsApp Profissional");
if (!envia) throw new Error("Node 'Envia WhatsApp Profissional' not found");
const hdrs = envia.parameters.headerParameters?.parameters || [];
const apikeyHdr = hdrs.find((h) => h.name === "apikey");
if (!apikeyHdr) throw new Error("apikey header not found in Envia WhatsApp Profissional");
const oldKey = apikeyHdr.value;
apikeyHdr.value = EVO_KEY;
console.log(`Fixed: apikey ${oldKey} → ${EVO_KEY}`);

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: wf.settings?.executionOrder ?? "v1" },
  staticData: wf.staticData ?? null,
};

const putRes = await fetch(`${N8N_URL}/workflows/${WF_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_KEY, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await putRes.text();
if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status} ${text}`);
console.log("OK: sub-workflow atualizado");
