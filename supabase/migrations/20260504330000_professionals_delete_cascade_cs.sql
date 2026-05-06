-- Cascade DELETE professionals → cs_profissionais (soft-delete)
--
-- Problema: apagar um profissional no painel não desativava cs_profissionais,
-- deixando órfãos activos que apareciam no agente e na lista de slots.
--
-- Solução: estender o trigger trg_sync_professional_to_cs para tratar DELETE
-- fazendo soft-delete (ativo=false) em cs_profissionais.
-- Hard-delete não é feito para preservar histórico em cs_agendamentos.

CREATE OR REPLACE FUNCTION public.trg_sync_professional_to_cs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cs_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cs_profissionais (nome, especialidade, ativo, clinic_id, gender)
    VALUES (
      NEW.name,
      NEW.specialty,
      coalesce(NEW.is_active, true),
      NEW.clinic_id,
      NEW.gender
    )
    RETURNING id INTO v_cs_id;

    UPDATE public.professionals
    SET cs_profissional_id = v_cs_id
    WHERE id = NEW.id;

  ELSIF TG_OP = 'UPDATE' AND NEW.cs_profissional_id IS NOT NULL THEN
    UPDATE public.cs_profissionais
    SET
      nome        = NEW.name,
      especialidade = NEW.specialty,
      ativo       = coalesce(NEW.is_active, true),
      gender      = NEW.gender
    WHERE id = NEW.cs_profissional_id;

  ELSIF TG_OP = 'DELETE' AND OLD.cs_profissional_id IS NOT NULL THEN
    -- Soft-delete: preserva histórico de cs_agendamentos
    UPDATE public.cs_profissionais
    SET ativo = false
    WHERE id = OLD.cs_profissional_id;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

-- Recriar trigger incluindo DELETE
DROP TRIGGER IF EXISTS trg_sync_professional_to_cs ON public.professionals;
CREATE TRIGGER trg_sync_professional_to_cs
  AFTER INSERT OR UPDATE OR DELETE
  ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_professional_to_cs();
