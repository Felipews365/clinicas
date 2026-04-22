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

// 1. Chamar a versão 2-param explicitamente (p_clinic_id + p_data)
const r1 = await fetch(`${supaUrl}/rest/v1/rpc/n8n_cs_consultar_vagas`, {
  method: 'POST',
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'params=single-object',
  },
  body: JSON.stringify({ p_clinic_id: CLINIC_ID, p_data: '2026-04-22' }),
});
console.log('=== 2-param (p_clinic_id + p_data) ===');
console.log('Status:', r1.status);
const v1 = await r1.json();
console.log(JSON.stringify(v1, null, 2).slice(0, 2000));

// 2. Chamar versão 0-param
const r0 = await fetch(`${supaUrl}/rest/v1/rpc/n8n_cs_consultar_vagas`, {
  method: 'POST',
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({}),
});
console.log('\n=== 0-param ===');
console.log('Status:', r0.status);
const v0 = await r0.json();
console.log(JSON.stringify(v0, null, 2).slice(0, 1000));
