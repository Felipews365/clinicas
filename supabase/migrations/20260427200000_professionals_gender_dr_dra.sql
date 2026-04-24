-- Dr. (M) / Dra. (F) nas notificações WhatsApp ao profissional.

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS gender text;

DO $$
BEGIN
  ALTER TABLE public.professionals
    ADD CONSTRAINT professionals_gender_chk
    CHECK (gender IS NULL OR gender IN ('M', 'F'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE public.cs_profissionais
  ADD COLUMN IF NOT EXISTS gender text;

DO $$
BEGIN
  ALTER TABLE public.cs_profissionais
    ADD CONSTRAINT cs_profissionais_gender_chk
    CHECK (gender IS NULL OR gender IN ('M', 'F'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN public.professionals.gender IS 'M = Dr., F = Dra. em mensagens ao profissional; NULL = Dr.';
COMMENT ON COLUMN public.cs_profissionais.gender IS 'Espelhado do painel (professionals.gender).';

-- Sincroniza nome do painel → cs (inclui gender)
CREATE OR REPLACE FUNCTION public.trg_sync_professional_to_cs ()
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
      nome = NEW.name,
      especialidade = NEW.specialty,
      ativo = coalesce(NEW.is_active, true),
      gender = NEW.gender
    WHERE id = NEW.cs_profissional_id;
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.cs_profissionais p
SET gender = pr.gender
FROM public.professionals pr
WHERE pr.cs_profissional_id = p.id
  AND pr.gender IS NOT NULL
  AND (p.gender IS DISTINCT FROM pr.gender);

-- Lista cs no painel: inclui gender no embed do profissional
CREATE OR REPLACE FUNCTION public.painel_list_cs_agendamentos (p_clinic_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz text;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT c.timezone INTO tz FROM public.clinics c WHERE c.id = p_clinic_id;
  tz := coalesce(nullif(trim(tz), ''), 'America/Sao_Paulo');

  RETURN coalesce(
    (
      SELECT jsonb_agg(obj ORDER BY sort_ts)
      FROM (
        SELECT
          jsonb_build_object(
            'id', 'cs:' || a.id::text,
            'starts_at', to_jsonb(((a.data_agendamento + a.horario)::timestamp AT TIME ZONE tz)),
            'ends_at', to_jsonb(
              ((a.data_agendamento + a.horario)::timestamp AT TIME ZONE tz)
              + make_interval(mins => coalesce(s.duracao_minutos, 60))
            ),
            'service_name', nullif(trim(coalesce(a.nome_procedimento, s.nome)), ''),
            'status', CASE a.status
              WHEN 'cancelado' THEN 'cancelled'
              WHEN 'concluido' THEN 'completed'
              ELSE 'scheduled'
            END,
            'source', CASE
              WHEN coalesce(a.painel_confirmado, false) THEN 'painel'
              ELSE 'whatsapp'
            END,
            'notes', nullif(trim(a.observacoes), ''),
            'patients', jsonb_build_object(
              'name', nullif(trim(coalesce(a.nome_cliente, c.nome)), ''),
              'phone', c.telefone
            ),
            'professionals', jsonb_build_object(
              'id', pr_panel.id,
              'name', coalesce(nullif(trim(a.nome_profissional), ''), p.nome),
              'specialty', coalesce(pr_panel.specialty, p.especialidade),
              'panel_color', pr_panel.panel_color,
              'avatar_path', pr_panel.avatar_path,
              'avatar_emoji', pr_panel.avatar_emoji,
              'gender', coalesce(pr_panel.gender, p.gender)
            )
          ) AS obj,
          ((a.data_agendamento + a.horario)::timestamp AT TIME ZONE tz) AS sort_ts
        FROM public.cs_agendamentos a
        INNER JOIN public.cs_profissionais p
          ON p.id = a.profissional_id
          AND p.clinic_id = p_clinic_id
        INNER JOIN public.cs_clientes c ON c.id = a.cliente_id
        LEFT JOIN public.cs_servicos s ON s.id = a.servico_id
        LEFT JOIN public.professionals pr_panel
          ON pr_panel.clinic_id = p_clinic_id
          AND (pr_panel.cs_profissional_id = p.id OR pr_panel.id = p.id)
        WHERE a.clinic_id = p_clinic_id
      ) sub
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.painel_list_cs_agendamentos (uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_list_cs_agendamentos (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_list_cs_agendamentos (uuid) TO service_role;

-- Cancelamento painel: devolve género para o texto WhatsApp
CREATE OR REPLACE FUNCTION public.painel_cancel_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_slot uuid;
  v_whatsapp text;
  v_prof_nome text;
  v_prof_genero text;
BEGIN
  IF NOT public.rls_has_clinic_access (p_clinic_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT
    a.id,
    a.profissional_id,
    a.data_agendamento,
    a.horario,
    a.status,
    coalesce(nullif(trim(a.nome_cliente), ''), '') AS nome_cliente,
    coalesce(nullif(trim(a.nome_procedimento), ''), '') AS nome_procedimento
  INTO v
  FROM public.cs_agendamentos a
  INNER JOIN public.cs_profissionais p ON p.id = a.profissional_id
  WHERE
    a.id = p_cs_agendamento_id
    AND p.clinic_id = p_clinic_id
    AND coalesce(a.clinic_id, p.clinic_id) = p_clinic_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v.status = 'cancelado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_cancelled');
  END IF;

  SELECT h.id INTO v_slot
  FROM public.cs_horarios_disponiveis h
  WHERE
    h.profissional_id = v.profissional_id
    AND h.data = v.data_agendamento
    AND h.horario = v.horario
  FOR UPDATE OF h;

  IF FOUND THEN
    UPDATE public.cs_horarios_disponiveis
    SET disponivel = true
    WHERE id = v_slot;
  END IF;

  UPDATE public.cs_agendamentos
  SET
    status = 'cancelado',
    motivo_cancelamento = coalesce(motivo_cancelamento, 'Cancelado pelo painel'),
    atualizado_em = now()
  WHERE id = v.id;

  SELECT prof.name, prof.whatsapp, prof.gender
  INTO v_prof_nome, v_whatsapp, v_prof_genero
  FROM public.professionals prof
  WHERE
    prof.cs_profissional_id = v.profissional_id
    AND prof.clinic_id = p_clinic_id;

  IF coalesce(trim(v_prof_nome), '') = '' THEN
    SELECT p.nome, p.gender INTO v_prof_nome, v_prof_genero
    FROM public.cs_profissionais p
    WHERE p.id = v.profissional_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profissional_whatsapp', v_whatsapp,
    'profissional_nome', nullif(trim(v_prof_nome), ''),
    'profissional_genero', CASE
      WHEN v_prof_genero IN ('M', 'F') THEN v_prof_genero
      ELSE NULL
    END,
    'nome_cliente', nullif(trim(v.nome_cliente), ''),
    'nome_procedimento', nullif(trim(v.nome_procedimento), ''),
    'data_agendamento', v.data_agendamento,
    'horario', to_char(v.horario, 'HH24:MI')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cancel_cs_agendamento (uuid, uuid) TO service_role;
