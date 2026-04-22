-- Trigger que sincroniza professionals (painel v2) → cs_profissionais (n8n/legado)
-- Garante que profissionais adicionados pelo painel apareçam na agenda e nas RPCs do agente.

-- Função do trigger
create or replace function public.trg_sync_professional_to_cs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cs_id uuid;
begin
  if TG_OP = 'INSERT' then
    -- Cria entrada em cs_profissionais
    insert into public.cs_profissionais (nome, especialidade, ativo, clinic_id)
    values (
      NEW.name,
      NEW.specialty,
      coalesce(NEW.is_active, true),
      NEW.clinic_id
    )
    returning id into v_cs_id;

    -- Liga de volta ao registro do painel
    update public.professionals
    set cs_profissional_id = v_cs_id
    where id = NEW.id;

  elsif TG_OP = 'UPDATE' and NEW.cs_profissional_id is not null then
    -- Atualiza cs_profissionais quando painel edita nome/especialidade/ativo
    update public.cs_profissionais
    set
      nome        = NEW.name,
      especialidade = NEW.specialty,
      ativo       = coalesce(NEW.is_active, true)
    where id = NEW.cs_profissional_id;

  end if;

  return NEW;
end;
$$;

-- Cria trigger
drop trigger if exists trg_sync_professional_to_cs on public.professionals;
create trigger trg_sync_professional_to_cs
  after insert or update on public.professionals
  for each row execute function public.trg_sync_professional_to_cs();

-- Backfill: cria entradas cs_profissionais para profissionais existentes sem link
do $$
declare
  r record;
  v_cs_id uuid;
begin
  for r in
    select id, name, specialty, is_active, clinic_id
    from public.professionals
    where cs_profissional_id is null
  loop
    insert into public.cs_profissionais (nome, especialidade, ativo, clinic_id)
    values (
      r.name,
      r.specialty,
      coalesce(r.is_active, true),
      r.clinic_id
    )
    returning id into v_cs_id;

    update public.professionals
    set cs_profissional_id = v_cs_id
    where id = r.id;
  end loop;
end;
$$;
