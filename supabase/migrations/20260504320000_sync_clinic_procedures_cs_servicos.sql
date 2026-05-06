-- Sincronização clinic_procedures (painel) → cs_servicos (agente n8n)
--
-- Problema: admin cria/edita procedimentos em clinic_procedures; o agente usa cs_servicos
-- (além de tentar clinic_procedures primeiro via RPC). Sem sync, cs_servicos ficava obsoleto.
--
-- Solução: trigger AFTER INSERT/UPDATE/DELETE em clinic_procedures sincroniza cs_servicos.
-- Hard-delete em clinic_procedures → soft-delete (ativo=false) em cs_servicos.

CREATE OR REPLACE FUNCTION public._trg_clinic_procedures_to_cs_servicos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cs_servicos (
      nome, descricao, duracao_minutos, ativo, clinic_id
    ) VALUES (
      NEW.name,
      NEW.description,
      NEW.duration_minutes,
      coalesce(NEW.is_active, true),
      NEW.clinic_id
    )
    ON CONFLICT DO NOTHING;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.cs_servicos
    SET
      nome             = NEW.name,
      descricao        = NEW.description,
      duracao_minutos  = NEW.duration_minutes,
      ativo            = coalesce(NEW.is_active, true)
    WHERE clinic_id = NEW.clinic_id
      AND nome = OLD.name;   -- match por nome (não há FK directa)

    -- Se nome mudou e não achou pelo nome antigo, tenta pelo novo (idempotência)
    IF NOT FOUND THEN
      INSERT INTO public.cs_servicos (nome, descricao, duracao_minutos, ativo, clinic_id)
      VALUES (NEW.name, NEW.description, NEW.duration_minutes, coalesce(NEW.is_active, true), NEW.clinic_id)
      ON CONFLICT DO NOTHING;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- Soft-delete: não apaga para não perder histórico em cs_agendamentos
    UPDATE public.cs_servicos
    SET ativo = false
    WHERE clinic_id = OLD.clinic_id
      AND nome = OLD.name;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_clinic_procedures_to_cs_servicos ON public.clinic_procedures;
CREATE TRIGGER trg_clinic_procedures_to_cs_servicos
  AFTER INSERT OR UPDATE OR DELETE
  ON public.clinic_procedures
  FOR EACH ROW EXECUTE FUNCTION public._trg_clinic_procedures_to_cs_servicos();

-- ---------------------------------------------------------------------------
-- Backfill: clinic_procedures activos → cs_servicos (registros existentes)
-- ---------------------------------------------------------------------------
INSERT INTO public.cs_servicos (nome, descricao, duracao_minutos, ativo, clinic_id)
SELECT
  cp.name,
  cp.description,
  cp.duration_minutes,
  coalesce(cp.is_active, true),
  cp.clinic_id
FROM public.clinic_procedures cp
WHERE cp.clinic_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Sincronizar procedimentos existentes que já têm correspondente pelo nome
UPDATE public.cs_servicos sv
SET
  descricao       = cp.description,
  duracao_minutos = cp.duration_minutes,
  ativo           = coalesce(cp.is_active, true)
FROM public.clinic_procedures cp
WHERE sv.clinic_id = cp.clinic_id
  AND sv.nome = cp.name
  AND (
    sv.descricao IS DISTINCT FROM cp.description
    OR sv.duracao_minutos IS DISTINCT FROM cp.duration_minutes
    OR sv.ativo IS DISTINCT FROM coalesce(cp.is_active, true)
  );
