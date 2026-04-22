import { readFileSync } from 'fs';

const envContent = readFileSync('../web/.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
}

const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 1. Ver definição da RPC n8n_cs_consultar_vagas
const r1 = await fetch(`${supaUrl}/rest/v1/rpc/n8n_cs_consultar_vagas`, {
  method: 'POST',
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
  },
  // parâmetros de exemplo - pegar o profissional Dr. João Lucas
  body: JSON.stringify({
    p_clinic_id: '5c8f7a44-c6b3-4835-889b-7e9f9b009125',
    p_profissional_id: null,
    p_data_solicitada: '2026-04-22',
    p_servico_id: null,
  }),
});
console.log('Status vagas:', r1.status);
const vagas = await r1.json();
console.log('Vagas retornadas:', JSON.stringify(vagas, null, 2).slice(0, 2000));

// 2. Ver definição da função no banco
const r2 = await fetch(`${supaUrl}/rest/v1/rpc/execute_sql`, {
  method: 'POST',
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: "SELECT routine_name, routine_definition FROM information_schema.routines WHERE routine_name = 'n8n_cs_consultar_vagas'"
  }),
}).catch(() => null);
