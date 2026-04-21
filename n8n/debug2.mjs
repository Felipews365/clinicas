import { readFileSync } from 'fs';
const envContent = readFileSync('../web/.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
}
const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const r = await fetch(supaUrl + '/rest/v1/clinics?select=id,name,instancia_evolution,status_whatsapp,agent_instructions', {
  headers: { 'apikey': supaKey, 'Authorization': 'Bearer ' + supaKey }
});
const data = await r.json();

console.log('TODAS as clinics - instancia_evolution:');
for (const c of data) {
  console.log('  [' + c.name + '] instancia_evolution="' + c.instancia_evolution + '" | status_whatsapp="' + c.status_whatsapp + '"');
}

const clinicaSaude = data.find(c => c.agent_instructions);
if (clinicaSaude) {
  console.log('\n--- agent_instructions completo da Clinica com config ---');
  console.log('Nome:', clinicaSaude.name, '| ID:', clinicaSaude.id);
  try {
    const p = JSON.parse(clinicaSaude.agent_instructions);
    console.log(JSON.stringify(p, null, 2));
  } catch {
    console.log(clinicaSaude.agent_instructions);
  }
}
