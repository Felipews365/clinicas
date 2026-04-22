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

// Comparar quantas vagas cada overload retorna para a mesma data
// 0-param (sem filtro tenant)
const r0 = await fetch(`${supaUrl}/rest/v1/rpc/n8n_cs_consultar_vagas`, {
  method: 'POST',
  headers: { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const v0 = await r0.json();
console.log(`0-param: ${Array.isArray(v0) ? v0.length : 'ERRO'} vagas (sem filtro tenant, primeiras datas: ${Array.isArray(v0) ? [...new Set(v0.map(x=>x.data))].slice(0,3).join(', ') : 'N/A'})`);

// 2-param com p_data específica
const r2 = await fetch(`${supaUrl}/rest/v1/rpc/n8n_cs_consultar_vagas`, {
  method: 'POST',
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'params=single-object',
  },
  body: JSON.stringify({ p_clinic_id: CLINIC_ID, p_data: '2026-04-22' }),
});
const v2 = await r2.json();
if (Array.isArray(v2)) {
  console.log(`\n2-param (clinic+data 22/04): ${v2.length} vagas`);
  const byProf = {};
  for (const s of v2) {
    byProf[s.profissional] = (byProf[s.profissional] || []).concat(s.horario);
  }
  for (const [prof, horas] of Object.entries(byProf)) {
    console.log(`  ${prof}: ${horas.join(', ')}`);
  }
} else {
  console.log('2-param ERRO:', JSON.stringify(v2));
}

// Verificar qual é a definição atual de n8n_cs_consultar_vagas no banco
// via pg_catalog (sem execute_sql)
const rDef = await fetch(`${supaUrl}/rest/v1/rpc/n8n_cs_consultar_vagas`, {
  method: 'POST',
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'params=single-object',
  },
  body: JSON.stringify({ p_clinic_id: CLINIC_ID, p_data: null }),
});
const vNull = await rDef.json();
console.log(`\n2-param com p_data=null: ${Array.isArray(vNull) ? vNull.length + ' vagas' : JSON.stringify(vNull).slice(0,100)}`);
