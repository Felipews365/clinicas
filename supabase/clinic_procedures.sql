-- Procedimentos / serviços oferecidos por cada clínica (painel + agente IA / n8n).
-- Executar no SQL Editor após existir public.clinics e public.rls_is_clinic_owner.

create table if not exists public.clinic_procedures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null,
  description text,
  duration_minutes int not null default 60,
  is_active boolean not null default true,
  sort_order int not null default 0,
  price_brl numeric(12, 2),
  preco_a_vista_brl numeric(12, 2),
  tem_desconto boolean not null default false,
  desconto_percentual numeric(5, 2),
  cartao_parcelas_max int,
  created_at timestamptz not null default now(),
  constraint clinic_procedures_duration_positive check (duration_minutes > 0),
  constraint clinic_procedures_price_non_negative check (price_brl is null or price_brl >= 0),
  constraint clinic_procedures_preco_avista_non_negative check (preco_a_vista_brl is null or preco_a_vista_brl >= 0),
  constraint clinic_procedures_desconto_pct check (
    desconto_percentual is null
    or (desconto_percentual >= 0 and desconto_percentual <= 100)
  ),
  constraint clinic_procedures_parcelas_cartao check (
    cartao_parcelas_max is null
    or (cartao_parcelas_max >= 1 and cartao_parcelas_max <= 24)
  ),
  constraint clinic_procedures_name_trim check (length(trim(name)) > 0),
  unique (clinic_id, name)
);

create index if not exists idx_clinic_procedures_clinic
  on public.clinic_procedures (clinic_id);

create index if not exists idx_clinic_procedures_clinic_active
  on public.clinic_procedures (clinic_id)
  where is_active = true;

comment on table public.clinic_procedures is
  'Catálogo de procedimentos da clínica; listagem para o agente via n8n_clinic_procedimentos.';

comment on column public.clinic_procedures.price_brl is 'Preço de referência em BRL (opcional).';
comment on column public.clinic_procedures.preco_a_vista_brl is 'Valor à vista em BRL (opcional).';
comment on column public.clinic_procedures.tem_desconto is 'Se há desconto negociado sobre o preço.';
comment on column public.clinic_procedures.desconto_percentual is 'Percentual de desconto (0–100) quando tem_desconto.';
comment on column public.clinic_procedures.cartao_parcelas_max is 'Máximo de parcelas no cartão (1–24).';

-- Instalações antigas
alter table public.clinic_procedures
  add column if not exists price_brl numeric(12, 2);
alter table public.clinic_procedures
  add column if not exists preco_a_vista_brl numeric(12, 2);
alter table public.clinic_procedures
  add column if not exists tem_desconto boolean not null default false;
alter table public.clinic_procedures
  add column if not exists desconto_percentual numeric(5, 2);
alter table public.clinic_procedures
  add column if not exists cartao_parcelas_max int;

do $$
begin
  alter table public.clinic_procedures
    add constraint clinic_procedures_price_non_negative check (price_brl is null or price_brl >= 0);
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.clinic_procedures
    add constraint clinic_procedures_preco_avista_non_negative check (preco_a_vista_brl is null or preco_a_vista_brl >= 0);
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.clinic_procedures
    add constraint clinic_procedures_desconto_pct check (
      desconto_percentual is null
      or (desconto_percentual >= 0 and desconto_percentual <= 100)
    );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.clinic_procedures
    add constraint clinic_procedures_parcelas_cartao check (
      cartao_parcelas_max is null
      or (cartao_parcelas_max >= 1 and cartao_parcelas_max <= 24)
    );
exception
  when duplicate_object then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.clinic_procedures enable row level security;

drop policy if exists "owners_manage_clinic_procedures" on public.clinic_procedures;
create policy "owners_manage_clinic_procedures" on public.clinic_procedures
  for all
  using (public.rls_is_clinic_owner(clinic_procedures.clinic_id))
  with check (public.rls_is_clinic_owner(clinic_procedures.clinic_id));

drop policy if exists "professionals_read_clinic_procedures" on public.clinic_procedures;
create policy "professionals_read_clinic_procedures" on public.clinic_procedures
  for select
  using (public.rls_professional_at_clinic(clinic_procedures.clinic_id));

-- DELETE explícito (o dono apaga linhas de vez; evita ambiguidade com “desativar”)
drop policy if exists "owners_delete_clinic_procedures" on public.clinic_procedures;
create policy "owners_delete_clinic_procedures" on public.clinic_procedures
  for delete
  using (public.rls_is_clinic_owner(clinic_procedures.clinic_id));

-- ---------------------------------------------------------------------------
-- n8n / PostgREST: lista procedimentos ativos da clínica (JSON).
-- service_role: sempre permitido. Utilizador: só dono da clínica.
-- ---------------------------------------------------------------------------
create or replace function public.n8n_clinic_procedimentos (p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if v_role is distinct from 'service_role'
     and not public.rls_is_clinic_owner(p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'nome', p.name,
          'descricao', p.description,
          'duracao_minutos', p.duration_minutes,
          'valor_brl', p.price_brl,
          'preco_a_vista_brl', p.preco_a_vista_brl,
          'tem_desconto', p.tem_desconto,
          'desconto_percentual', p.desconto_percentual,
          'cartao_parcelas_max', p.cartao_parcelas_max
        )
        order by p.sort_order asc, p.name asc
      )
      from public.clinic_procedures p
      where p.clinic_id = p_clinic_id
        and p.is_active = true
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.n8n_clinic_procedimentos (uuid) from public;
grant execute on function public.n8n_clinic_procedimentos (uuid) to authenticated;
grant execute on function public.n8n_clinic_procedimentos (uuid) to service_role;
