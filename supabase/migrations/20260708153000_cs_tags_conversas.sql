-- Tags de conversas (inbox WhatsApp) — só no painel, isoladas por clínica.
-- As tags NÃO sincronizam com o WhatsApp do celular (etiquetas nativas do
-- WhatsApp Business são fechadas e não expostas pela Evolution API).

-- Catálogo de tags por clínica
create table if not exists public.cs_tags (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  label text not null,
  color text not null default 'slate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cs_tags_clinic_label_uidx
  on public.cs_tags (clinic_id, lower(btrim(label)));
create index if not exists cs_tags_clinic_idx on public.cs_tags (clinic_id);

alter table public.cs_tags enable row level security;
drop policy if exists cs_tags_access on public.cs_tags;
create policy cs_tags_access on public.cs_tags
  for all to authenticated
  using (clinic_id is not null and rls_has_clinic_access(clinic_id))
  with check (clinic_id is not null and rls_has_clinic_access(clinic_id));

-- Atribuição de tags às conversas (por cliente)
create table if not exists public.cs_cliente_tags (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  cs_cliente_id uuid not null references public.cs_clientes(id) on delete cascade,
  tag_id uuid not null references public.cs_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (clinic_id, cs_cliente_id, tag_id)
);
create index if not exists cs_cliente_tags_clinic_cliente_idx
  on public.cs_cliente_tags (clinic_id, cs_cliente_id);
create index if not exists cs_cliente_tags_tag_idx on public.cs_cliente_tags (tag_id);

alter table public.cs_cliente_tags enable row level security;
drop policy if exists cs_cliente_tags_access on public.cs_cliente_tags;
create policy cs_cliente_tags_access on public.cs_cliente_tags
  for all to authenticated
  using (clinic_id is not null and rls_has_clinic_access(clinic_id))
  with check (clinic_id is not null and rls_has_clinic_access(clinic_id));
