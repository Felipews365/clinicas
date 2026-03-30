-- Ligação opcional painel ↔ cs_profissionais (n8n). Necessária para JOIN em painel_list_cs_agendamentos.
alter table public.professionals
  add column if not exists cs_profissional_id uuid
  references public.cs_profissionais (id) on delete set null;

create index if not exists idx_professionals_cs_profissional_id
  on public.professionals (cs_profissional_id)
  where cs_profissional_id is not null;

comment on column public.professionals.cs_profissional_id is
  'Opcional: liga o profissional do painel ao registo em cs_profissionais usado pelo agente WhatsApp/n8n.';
