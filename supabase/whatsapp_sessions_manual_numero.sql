-- Extensão opcional: flags pedidas pelo fluxo WhatsApp completo
-- Execute no SQL Editor depois de whatsapp_sessions.sql

alter table public.whatsapp_sessions
  add column if not exists manual boolean not null default false,
  add column if not exists numero_cliente text;

comment on column public.whatsapp_sessions.manual is 'true quando o cliente pediu atendimento humano (n8n).';
comment on column public.whatsapp_sessions.numero_cliente is 'Número do cliente (E.164); espelho explícito de phone.';

update public.whatsapp_sessions
set numero_cliente = coalesce(numero_cliente, phone)
where numero_cliente is null;
