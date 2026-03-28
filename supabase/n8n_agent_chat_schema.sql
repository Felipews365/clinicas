-- Schema para o fluxo "Agente de Atendimento" (n8n + histórico + takeover humano)
-- NÃO substitui public.appointments (modelo clínica/profissional/paciente).
-- Executar no SQL Editor após schema.sql principal.

-- ---------------------------------------------------------------------------
-- Clientes do canal (WhatsApp/Evolution) — distinto de patients por simplicidade do agente
-- ---------------------------------------------------------------------------
create table if not exists public.chat_clients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id) on delete set null,
  name text not null default '',
  phone text not null,
  email text,
  created_at timestamptz not null default now(),
  unique (phone)
);

create index if not exists idx_chat_clients_clinic on public.chat_clients (clinic_id);

-- ---------------------------------------------------------------------------
-- Sessões (session_id = ex. wa_id ou chave estável por conversa)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  client_id uuid references public.chat_clients (id) on delete set null,
  human_takeover boolean not null default false,
  takeover_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_sessions_client on public.chat_sessions (client_id);

-- ---------------------------------------------------------------------------
-- Histórico de mensagens
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  client_id uuid references public.chat_clients (id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'human_agent')),
  content text not null,
  message_type text not null default 'text' check (message_type in ('text', 'image', 'audio')),
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_session_created on public.chat_messages (session_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Agendamentos "simples" do agente (paralelo ao modelo rico em public.appointments)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_simple_appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id) on delete set null,
  client_id uuid not null references public.chat_clients (id) on delete cascade,
  specialty text not null,
  appointment_date date not null,
  appointment_time time not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'rescheduled', 'completed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_simple_appts_client on public.chat_simple_appointments (client_id);

comment on table public.chat_clients is 'Clientes identificados pelo canal; n8n faz upsert por phone.';
comment on table public.chat_sessions is 'human_takeover + takeover_at: janela 60s no workflow.';
comment on table public.chat_messages is 'Histórico user/assistant/human_agent para contexto OpenAI.';
comment on table public.chat_simple_appointments is 'Agendamentos simplificados pelo agente; sincronizar com modelo principal se necessário.';
