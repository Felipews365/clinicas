import { readFileSync } from 'fs';

const envContent = readFileSync('../web/.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
}

const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Busca todas as clinics com instancia_evolution preenchida
const r = await fetch(`${supaUrl}/rest/v1/clinics?select=id,name,instancia_evolution,status_whatsapp,agent_instructions&instancia_evolution=not.is.null`, {
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
  }
});
const data = await r.json();

console.log('Clinics com instancia_evolution preenchida:');
for (const c of data) {
  console.log(`\n=== ${c.name} (${c.id}) ===`);
  console.log('  instancia_evolution:', c.instancia_evolution);
  console.log('  status_whatsapp:', c.status_whatsapp);
  const ai = c.agent_instructions;
  if (ai) {
    console.log('  agent_instructions (parcial):');
    try {
      const parsed = JSON.parse(ai);
      console.log('    nome_agente:', parsed.nome_agente);
      console.log('    saudacao_novo:', parsed.saudacao_novo);
      console.log('    identidade (100 chars):', (parsed.identidade || '').slice(0, 100));
    } catch {
      console.log('  (nao e JSON valido):', ai.slice(0, 200));
    }
  } else {
    console.log('  agent_instructions: NULL');
  }
}

// Tambem busca TODAS as clinics para ver agent_instructions
const r2 = await fetch(`${supaUrl}/rest/v1/clinics?select=id,name,agent_instructions`, {
  headers: {
    'apikey': supaKey,
    'Authorization': `Bearer ${supaKey}`,
  }
});
const all = await r2.json();
console.log('\n\nTodas as clinics e agent_instructions:');
for (const c of all) {
  const ai = c.agent_instructions;
  let aiSummary = 'NULL';
  if (ai) {
    try {
      const p = JSON.parse(ai);
      aiSummary = `nome_agente="${p.nome_agente || ''}", saudacao_novo="${(p.saudacao_novo || '').slice(0, 50)}"`;
    } catch {
      aiSummary = `(raw) ${ai.slice(0, 80)}`;
    }
  }
  console.log(`  ${c.name}: ${aiSummary}`);
}
