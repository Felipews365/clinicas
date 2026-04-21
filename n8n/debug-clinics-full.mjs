import { readFileSync } from 'fs';

// Lê o arquivo .env.local para pegar credenciais
const envContent = readFileSync('../web/.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
}

const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('URL:', supaUrl);

// Busca todos os campos de TODAS as clinics
const r = await fetch(`${supaUrl}/rest/v1/clinics?select=*&limit=5`, {
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
  }
});
const data = await r.json();

if (Array.isArray(data)) {
  for (const clinic of data) {
    console.log('\n=== Clinic:', clinic.name, '===');
    for (const [k, v] of Object.entries(clinic)) {
      const val = typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v)?.slice(0, 200);
      console.log(`  ${k}: ${val}`);
    }
  }
} else {
  console.log(JSON.stringify(data, null, 2));
}
