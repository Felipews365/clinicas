-- Sincronização bidirecional patients ↔ cs_clientes
--
-- patients (painel)   → cs_clientes (agente n8n) : sempre que admin cria/edita paciente
-- cs_clientes (agente) → patients (painel)        : quando nome confirmado via WhatsApp
--
-- Loop guard: set_config('app.syncing_patients','true',true) na direção patients→cs,
-- verificado na outra direção para não cascatear infinitamente.
--
-- Normalização de telefone: armazenar só dígitos para matching entre +5511999 e 5511999.

-- ---------------------------------------------------------------------------
-- Função auxiliar: normaliza telefone para só dígitos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._phone_digits(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
$$;

-- ---------------------------------------------------------------------------
-- 1. patients → cs_clientes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trg_patients_to_cs_clientes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_digits text;
BEGIN
  -- Evita loop quando chamado da direção oposta
  IF current_setting('app.syncing_patients', true) = 'true' THEN
    RETURN NEW;
  END IF;

  v_phone_digits := public._phone_digits(NEW.phone);
  IF v_phone_digits = '' OR NEW.clinic_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.syncing_patients', 'true', true);

  INSERT INTO public.cs_clientes (clinic_id, telefone, nome)
  VALUES (NEW.clinic_id, v_phone_digits, coalesce(NEW.name, ''))
  ON CONFLICT (clinic_id, telefone)
  WHERE clinic_id IS NOT NULL
  DO UPDATE SET
    nome = CASE
      -- Não sobrescreve nome confirmado (não-vazio) no cs_clientes com nome vazio do painel
      WHEN excluded.nome <> '' AND (cs_clientes.nome IS NULL OR cs_clientes.nome = '') THEN excluded.nome
      WHEN excluded.nome <> '' THEN excluded.nome
      ELSE cs_clientes.nome
    END;

  PERFORM set_config('app.syncing_patients', 'false', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patients_to_cs_clientes ON public.patients;
CREATE TRIGGER trg_patients_to_cs_clientes
  AFTER INSERT OR UPDATE OF name, phone
  ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public._trg_patients_to_cs_clientes();

-- ---------------------------------------------------------------------------
-- 2. cs_clientes → patients (só quando nome não-vazio / confirmado)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trg_cs_clientes_to_patients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_digits text;
BEGIN
  -- Evita loop quando chamado da direção oposta
  IF current_setting('app.syncing_patients', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Só sincroniza quando nome está preenchido (confirmado pelo agente)
  IF NEW.nome IS NULL OR trim(NEW.nome) = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.clinic_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_phone_digits := public._phone_digits(NEW.telefone);
  IF v_phone_digits = '' THEN
    RETURN NEW;
  END IF;

  -- Reconstruir telefone com formato +55... para patients
  -- (patients armazena com + se o painel formatou assim; usamos dígitos como fallback)
  PERFORM set_config('app.syncing_patients', 'true', true);

  INSERT INTO public.patients (clinic_id, phone, name)
  VALUES (NEW.clinic_id, v_phone_digits, NEW.nome)
  ON CONFLICT (clinic_id, phone)
  DO UPDATE SET
    name = excluded.name
  WHERE patients.name IS DISTINCT FROM excluded.name;

  PERFORM set_config('app.syncing_patients', 'false', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cs_clientes_to_patients ON public.cs_clientes;
CREATE TRIGGER trg_cs_clientes_to_patients
  AFTER INSERT OR UPDATE OF nome
  ON public.cs_clientes
  FOR EACH ROW EXECUTE FUNCTION public._trg_cs_clientes_to_patients();

-- ---------------------------------------------------------------------------
-- 3. Backfill: patients → cs_clientes (registros existentes)
-- Usa DISTINCT ON para evitar duplicatas na source.
-- ---------------------------------------------------------------------------
INSERT INTO public.cs_clientes (clinic_id, telefone, nome)
SELECT DISTINCT ON (p.clinic_id, public._phone_digits(p.phone))
  p.clinic_id,
  public._phone_digits(p.phone),
  coalesce(p.name, '')
FROM public.patients p
WHERE p.clinic_id IS NOT NULL
  AND public._phone_digits(p.phone) <> ''
ORDER BY p.clinic_id, public._phone_digits(p.phone), p.name NULLS LAST
ON CONFLICT (clinic_id, telefone)
WHERE clinic_id IS NOT NULL
DO UPDATE SET
  nome = CASE
    WHEN excluded.nome <> '' AND (cs_clientes.nome IS NULL OR cs_clientes.nome = '')
      THEN excluded.nome
    ELSE cs_clientes.nome
  END;

-- ---------------------------------------------------------------------------
-- 4. Backfill: cs_clientes → patients (nomes confirmados não ainda em patients)
-- Usa DISTINCT ON para evitar duplicatas na source.
-- ---------------------------------------------------------------------------
INSERT INTO public.patients (clinic_id, phone, name)
SELECT DISTINCT ON (c.clinic_id, public._phone_digits(c.telefone))
  c.clinic_id,
  public._phone_digits(c.telefone),
  c.nome
FROM public.cs_clientes c
WHERE c.clinic_id IS NOT NULL
  AND c.nome IS NOT NULL
  AND trim(c.nome) <> ''
  AND public._phone_digits(c.telefone) <> ''
ORDER BY c.clinic_id, public._phone_digits(c.telefone), c.nome
ON CONFLICT (clinic_id, phone)
DO UPDATE SET
  name = excluded.name
WHERE patients.name IS DISTINCT FROM excluded.name;
