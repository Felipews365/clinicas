-- Sessões WhatsApp: pedido de humano + assumir no painel
-- Execute no Supabase SQL Editor (após schema principal).

create table if not exists public.whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  phone text not null,
  needs_human boolean not null default false,
  staff_handling boolean not null default false,
  last_message_preview text,
  manual boolean not null default false,
  numero_cliente text,
  updated_at timestamptz not null default now(),
  unique (clinic_id, phone)
);

create index if not exists idx_whatsapp_sessions_clinic_needs
  on public.whatsapp_sessions (clinic_id)
  where needs_human = true and staff_handling = false;

alter table public.whatsapp_sessions enable row level security;

create policy "owners_read_whatsapp_sessions"
  on public.whatsapp_sessions for select
  using (
    exists (
      select 1 from public.clinics c
      where c.id = whatsapp_sessions.clinic_id and c.owner_id = auth.uid()
    )
  );

create policy "owners_update_whatsapp_sessions"
  on public.whatsapp_sessions for update
  using (
    exists (
      select 1 from public.clinics c
      where c.id = whatsapp_sessions.clinic_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.clinics c
      where c.id = whatsapp_sessions.clinic_id and c.owner_id = auth.uid()
    )
  );

create policy "owners_insert_whatsapp_sessions"
  on public.whatsapp_sessions for insert
  with check (
    exists (
      select 1 from public.clinics c
      where c.id = clinic_id and c.owner_id = auth.uid()
    )
  );

comment on table public.whatsapp_sessions is 'WhatsApp por telefone: needs_human (pediu humano), staff_handling (equipa assumiu no painel). n8n usa service_role para upsert.';
