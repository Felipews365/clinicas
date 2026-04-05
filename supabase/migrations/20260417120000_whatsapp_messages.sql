-- Histórico de mensagens WhatsApp por sessão
-- direction: 'inbound' (cliente → clínica) | 'outbound' (clínica → cliente)

create table if not exists public.whatsapp_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.whatsapp_sessions(id) on delete cascade,
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  direction   text not null check (direction in ('inbound', 'outbound')),
  body        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists idx_whatsapp_messages_session
  on public.whatsapp_messages (session_id, created_at);

create index if not exists idx_whatsapp_messages_clinic
  on public.whatsapp_messages (clinic_id, created_at desc);

alter table public.whatsapp_messages enable row level security;

-- Leitura: dono + membros da clínica
create policy "clinic_read_whatsapp_messages"
  on public.whatsapp_messages for select
  using (public.rls_has_clinic_access(clinic_id));

-- Inserção via painel (outbound) ou n8n service_role (inbound)
create policy "clinic_insert_whatsapp_messages"
  on public.whatsapp_messages for insert
  with check (public.rls_has_clinic_access(clinic_id));

-- Realtime
alter publication supabase_realtime add table public.whatsapp_messages;

comment on table public.whatsapp_messages is
  'Histórico de mensagens WhatsApp por sessão. direction=inbound salvo pelo n8n; direction=outbound salvo ao enviar pelo painel.';
