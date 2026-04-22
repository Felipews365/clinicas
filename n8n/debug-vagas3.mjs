import { readFileSync } from 'fs';

const envContent = readFileSync('../web/.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
}

const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const CLINIC_ID = '5c8f7a44-c6b3-4835-889b-7e9f9b009125';

// Chamada CORRETA: n8n_cs_consultar_vagas recebe APENAS p_clinic_id
const r1 = await fetch(`${supaUrl}/rest/v1/rpc/n8n_cs_consultar_vagas`, {
  method: 'POST',
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_clinic_id: CLINIC_ID }),
});
console.log('=== n8n_cs_consultar_vagas (1 param) ===');
console.log('Status:', r1.status);
const vagas = await r1.json();
console.log(JSON.stringify(vagas, null, 2).slice(0, 3000));

// painel_cs_slots_dia para comparar
const r2 = await fetch(`${supaUrl}/rest/v1/rpc/painel_cs_slots_dia`, {
  method: 'POST',
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_clinic_id: CLINIC_ID, p_data: '2026-04-22' }),
});
console.log('\n=== painel_cs_slots_dia (para 22/04) ===');
console.log('Status:', r2.status);
const slots = await r2.json();
const slotsArr = Array.isArray(slots) ? slots : (slots && typeof slots === 'object' && !slots.code ? [slots] : slots);
if (Array.isArray(slotsArr)) {
  const disp = slotsArr.filter(s => s.disponivel);
  const ocup = slotsArr.filter(s => !s.disponivel);
  console.log(`Total slots: ${slotsArr.length}, Disponíveis: ${disp.length}, Ocupados/Bloqueados: ${ocup.length}`);
  console.log('Amostra disponíveis:', JSON.stringify(disp.slice(0, 3), null, 2));
  console.log('Amostra ocupados:', JSON.stringify(ocup.slice(0, 3), null, 2));
} else {
  console.log(JSON.stringify(slots, null, 2).slice(0, 1000));
}
