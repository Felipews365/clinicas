// Simula o que o código do Enrich Agendador vai fazer — testa a chamada Supabase
const SUPABASE_URL = "https://xkwdwioawosthwjqijfb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhrd2R3aW9hd29zdGh3anFpamZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUyNzUzMywiZXhwIjoyMDkwMTAzNTMzfQ._CoWPqn1bDqNRJ-g6EzGnqE86YI_LW5T_N6At3CPal4";

// Use a real clinic_id from previous executions
const CLINIC_ID = "d4d9d88e-0b8f-4ff6-9bb8-7e38b92f4ff3"; // from previous exec data

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json'
};

console.log("Testing professionals fetch...");
const profResp = await fetch(
  `${SUPABASE_URL}/rest/v1/cs_profissionais?select=id,nome,especialidade&ativo=eq.true&order=nome.asc&clinic_id=eq.${CLINIC_ID}`,
  { headers }
);
console.log("Status:", profResp.status);
const profs = await profResp.json();
console.log("Professionals:", JSON.stringify(profs).substring(0, 300));

if (Array.isArray(profs) && profs.length > 0) {
  const linhas = profs.map(p =>
    "  - " + p.nome + (p.especialidade ? " (" + p.especialidade + ")" : "") +
    " | profissional_id: " + p.id
  ).join("\n");
  console.log("\n✓ Formatted professionals block:\n## PROFISSIONAIS DISPONÍVEIS:\n" + linhas);
}

console.log("\nTesting services fetch...");
const svcResp = await fetch(
  `${SUPABASE_URL}/rest/v1/rpc/n8n_clinic_procedimentos`,
  {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_clinic_id: CLINIC_ID })
  }
);
console.log("Status:", svcResp.status);
const svcs = await svcResp.json();
console.log("Services:", JSON.stringify(svcs).substring(0, 300));
