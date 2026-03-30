-- Configuração do Agente IA (JSON guardado pelo painel; n8n lê em consultas à clínica).
-- Executar no SQL Editor do Supabase (projeto já com tabela public.clinics).
-- Corrige: Could not find the 'agent_instructions' column of 'clinics' in the schema cache.

alter table public.clinics
  add column if not exists agent_instructions text;

comment on column public.clinics.agent_instructions is
  'JSON: identidade, triagem, procedimentos, tom, orientações, transferência, outros, lembrete SMS, etc.';

-- Se o erro persistir no painel após o Run: Supabase Dashboard → Project Settings → API
-- → «Reload schema» (ou aguardar alguns segundos para o PostgREST atualizar a cache).
