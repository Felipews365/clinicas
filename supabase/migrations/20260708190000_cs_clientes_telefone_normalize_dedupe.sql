-- Clientes duplicados por telefone contaminado com JID (…@s.whatsapp.net).
--
-- Causa: cs_clientes tem UNIQUE (clinic_id, telefone) sobre a STRING crua. Em
-- algum momento o telefone foi gravado como JID completo
-- ("558196454656@s.whatsapp.net") em vez de só dígitos ("558196454656"),
-- criando um cliente duplicado ao lado do registo confirmado. O n8n
-- (Create Cliente / Get Cliente) já grava só dígitos hoje — isto é
-- contaminação legada + defesa contra recorrência.
--
-- Fix (tenant-safe, TODAS as clínicas):
--   1. Dedupe por (clinic_id, telefone normalizado): keeper = nome confirmado,
--      depois mais filhos, depois mais antigo. Repointa filhos e apaga losers.
--   2. Normaliza cs_clientes.telefone para só dígitos (tira @s.whatsapp.net).
--   3. Trigger BEFORE que mantém só dígitos em qualquer escrita futura.

-- ---------------------------------------------------------------------------
-- 1) Dedupe
-- ---------------------------------------------------------------------------
do $$
declare
  g record;
  keeper uuid;
  losers uuid[];
begin
  for g in
    select clinic_id, regexp_replace(coalesce(telefone, ''), '\D', '', 'g') as pn
    from public.cs_clientes
    where clinic_id is not null and coalesce(telefone, '') <> ''
    group by clinic_id, regexp_replace(coalesce(telefone, ''), '\D', '', 'g')
    having count(*) > 1
  loop
    -- keeper: nome confirmado primeiro; depois mais filhos; desempate mais antigo
    select id into keeper
    from public.cs_clientes c
    where c.clinic_id = g.clinic_id
      and regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') = g.pn
    order by
      (c.nome is not null and btrim(c.nome) <> '') desc,
      (
        (select count(*) from public.cs_agendamentos x where x.cliente_id = c.id)
      + (select count(*) from public.crm_interacoes x where x.cliente_id = c.id)
      + (select count(*) from public.crm_followup_tasks x where x.cliente_id = c.id)
      + (select count(*) from public.cs_lembretes_enviados x where x.cs_cliente_id = c.id)
      + (select count(*) from public.cs_cliente_tags x where x.cs_cliente_id = c.id)
      ) desc,
      c.created_at asc
    limit 1;

    select array_agg(id) into losers
    from public.cs_clientes c
    where c.clinic_id = g.clinic_id
      and regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') = g.pn
      and c.id <> keeper;

    if losers is null then
      continue;
    end if;

    -- repointar filhos dos losers -> keeper
    -- cs_agendamentos tem FK RESTRICT: obrigatório repointar antes de apagar
    update public.cs_agendamentos set cliente_id = keeper where cliente_id = any(losers);
    update public.crm_followup_tasks set cliente_id = keeper where cliente_id = any(losers);
    update public.crm_interacoes set cliente_id = keeper where cliente_id = any(losers);
    update public.cs_lembretes_enviados set cs_cliente_id = keeper where cs_cliente_id = any(losers);

    -- cs_cliente_tags tem UNIQUE (clinic_id, cs_cliente_id, tag_id): só migra as
    -- que não colidem com tags já do keeper; o resto cai no cascade do delete
    update public.cs_cliente_tags t
    set cs_cliente_id = keeper
    where t.cs_cliente_id = any(losers)
      and not exists (
        select 1 from public.cs_cliente_tags k
        where k.cs_cliente_id = keeper and k.tag_id = t.tag_id
      );

    delete from public.cs_clientes where id = any(losers);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Normalizar telefones remanescentes para só dígitos
-- ---------------------------------------------------------------------------
update public.cs_clientes
set telefone = regexp_replace(telefone, '\D', '', 'g')
where telefone ~ '\D'
  and regexp_replace(telefone, '\D', '', 'g') <> '';

-- ---------------------------------------------------------------------------
-- 3) Trigger BEFORE: mantém cs_clientes.telefone só com dígitos (tira JID)
--    Nome com prefixo 000 para correr antes dos outros BEFORE triggers.
-- ---------------------------------------------------------------------------
create or replace function public._trg_cs_clientes_normalize_telefone()
returns trigger
language plpgsql
as $$
begin
  if new.telefone is not null then
    new.telefone := regexp_replace(new.telefone, '\D', '', 'g');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cs_clientes_000_normalize_telefone on public.cs_clientes;
create trigger trg_cs_clientes_000_normalize_telefone
  before insert or update of telefone on public.cs_clientes
  for each row
  execute function public._trg_cs_clientes_normalize_telefone();
