import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lê o .env do root do projeto
function parseEnv(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const vars = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      vars[key] = val;
    }
    return vars;
  } catch { return {}; }
}

const env1 = parseEnv(join(__dirname, '../.env'));
const env2 = parseEnv(join(__dirname, '../web/.env.local'));
const env = { ...env1, ...env2 };

const supaUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;

console.log('URL:', supaUrl);
console.log('Key found:', !!supaKey);

// Busca todas as clinics
const r = await fetch(`${supaUrl}/rest/v1/clinics?select=id,name,agent_instructions&limit=5`, {
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
  }
});
console.log('Status:', r.status);
const data = await r.json();
console.log('\nClinics:', JSON.stringify(data, null, 2).slice(0, 5000));
