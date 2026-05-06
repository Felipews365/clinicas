-- Mirror de appointments (painel) → cs_agendamentos + bloqueio de slots
--
-- Problema resolvido:
--   1. Agendamentos criados no painel (tabela appointments) não bloqueavam
--      cs_horarios_disponiveis → agente WhatsApp podia oferecer o mesmo slot → dupla marcação.
--   2. Agente não encontrava agendamento do paciente em cs_agendamentos quando o paciente
--      perguntava via WhatsApp "qual é a minha consulta?".
--
-- Solução:
--   • Trigger em appointments (INSERT/UPDATE) replica para cs_agendamentos com flag
--     from_appointments_id e painel_confirmado=true.
--   • Ao criar/atualizar o mirror, bloqueia/liberta o slot em cs_horarios_disponiveis.
--   • painel_list_cs_agendamentos exclui linhas com from_appointments_id (já aparecem
--     directamente via appointments no painel — evita duplicados).
--   • painel_cs_slots_dia / painel_cs_ensure_slots_grid passam a checar também appointments
--     ao decidir se um slot está ocupado.

-- ---------------------------------------------------------------------------
-- 1. Coluna from_appointments_id em cs_agendamentos
-- ---------------------------------------------------------------------------
ALTER TABLE public.cs_agendamentos
  ADD COLUMN IF NOT EXISTS from_appointments_id uuid
    REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cs_agendamentos_from_appointments_id
  ON public.cs_agendamentos (from_appointments_id)
  WHERE from_appointments_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Trigger: appointments → cs_agendamentos + cs_horarios_disponiveis
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trg_appointments_to_cs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cs_prof_id    uuid;
  v_cs_client_id  uuid;
  v_existing_id   uuid;
  v_clinic_tz     text;
  v_data          date;
  v_horario       time;
  v_old_data      date;
  v_old_horario   time;
  v_old_cs_prof   uuid;
  v_cs_status     text;
  v_nome_cliente  text;
  v_nome_prof     text;
BEGIN
  -- Buscar cs_profissional_id do profissional do painel
  SELECT p.cs_profissional_id, p.name
  INTO v_cs_prof_id, v_nome_prof
  FROM public.professionals p
  WHERE p.id = NEW.professional_id
    AND p.clinic_id = NEW.clinic_id;

  -- Se profissional não está ligado ao sistema cs, só bloquear/liberar slot se possível
  -- (sem mirror completo)

  -- Timezone da clínica para extrair data/hora local
  SELECT coalesce(nullif(trim(c.timezone), ''), 'America/Sao_Paulo')
  INTO v_clinic_tz
  FROM public.clinics c
  WHERE c.id = NEW.clinic_id;

  v_data    := (NEW.starts_at AT TIME ZONE v_clinic_tz)::date;
  v_horario := (NEW.starts_at AT TIME ZONE v_clinic_tz)::time;

  -- Status equivalente no cs
  v_cs_status := CASE NEW.status
    WHEN 'cancelled'  THEN 'cancelado'
    WHEN 'completed'  THEN 'concluido'
    ELSE 'confirmado'
  END;

  -- Para UPDATE: calcular data/hora anteriores (para liberar slot antigo)
  IF TG_OP = 'UPDATE' THEN
    v_old_data    := (OLD.starts_at AT TIME ZONE v_clinic_tz)::date;
    v_old_horario := (OLD.starts_at AT TIME ZONE v_clinic_tz)::time;

    SELECT p.cs_profissional_id INTO v_old_cs_prof
    FROM public.professionals p
    WHERE p.id = OLD.professional_id AND p.clinic_id = OLD.clinic_id;
  END IF;

  -- -----------------------------------------------------------------------
  -- Bloquear / liberar slot
  -- -----------------------------------------------------------------------
  IF v_cs_prof_id IS NOT NULL THEN
    IF NEW.status = 'scheduled' THEN
      -- Bloquear slot novo
      INSERT INTO public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel, bloqueio_manual)
      VALUES (v_cs_prof_id, v_data, v_horario, false, false)
      ON CONFLICT (profissional_id, data, horario)
      DO UPDATE SET disponivel = false
      WHERE cs_horarios_disponiveis.disponivel = true
        AND cs_horarios_disponiveis.bloqueio_manual = false;

      -- Se reagendamento, liberar slot antigo (só se nenhum cs_agendamento activo nele)
      IF TG_OP = 'UPDATE'
        AND v_old_cs_prof IS NOT NULL
        AND (v_old_cs_prof <> v_cs_prof_id OR v_old_data <> v_data OR v_old_horario <> v_horario)
      THEN
        UPDATE public.cs_horarios_disponiveis
        SET disponivel = true
        WHERE profissional_id = v_old_cs_prof
          AND data = v_old_data
          AND date_trunc('minute', horario) = date_trunc('minute', v_old_horario)
          AND bloqueio_manual = false
          AND NOT EXISTS (
            SELECT 1 FROM public.cs_agendamentos a
            WHERE a.profissional_id = v_old_cs_prof
              AND a.data_agendamento = v_old_data
              AND date_trunc('minute', a.horario) = date_trunc('minute', v_old_horario)
              AND a.status NOT IN ('cancelado', 'concluido')
              AND (a.from_appointments_id IS NULL OR a.from_appointments_id <> NEW.id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.appointments ap
            WHERE ap.professional_id IN (
              SELECT id FROM public.professionals WHERE cs_profissional_id = v_old_cs_prof
            )
              AND ap.clinic_id = OLD.clinic_id
              AND ap.status = 'scheduled'
              AND (ap.starts_at AT TIME ZONE v_clinic_tz)::date = v_old_data
              AND date_trunc('minute', (ap.starts_at AT TIME ZONE v_clinic_tz)::time)
                  = date_trunc('minute', v_old_horario)
              AND ap.id <> NEW.id
          );
      END IF;

    ELSIF NEW.status IN ('cancelled', 'completed') THEN
      -- Liberar slot (só se nenhum outro agendamento activo nele)
      UPDATE public.cs_horarios_disponiveis
      SET disponivel = true
      WHERE profissional_id = v_cs_prof_id
        AND data = v_data
        AND date_trunc('minute', horario) = date_trunc('minute', v_horario)
        AND bloqueio_manual = false
        AND NOT EXISTS (
          SELECT 1 FROM public.cs_agendamentos a
          WHERE a.profissional_id = v_cs_prof_id
            AND a.data_agendamento = v_data
            AND date_trunc('minute', a.horario) = date_trunc('minute', v_horario)
            AND a.status NOT IN ('cancelado', 'concluido')
            AND (a.from_appointments_id IS NULL OR a.from_appointments_id <> NEW.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.appointments ap
          WHERE ap.professional_id IN (
            SELECT id FROM public.professionals WHERE cs_profissional_id = v_cs_prof_id
          )
            AND ap.clinic_id = NEW.clinic_id
            AND ap.status = 'scheduled'
            AND (ap.starts_at AT TIME ZONE v_clinic_tz)::date = v_data
            AND date_trunc('minute', (ap.starts_at AT TIME ZONE v_clinic_tz)::time)
                = date_trunc('minute', v_horario)
            AND ap.id <> NEW.id
        );
    END IF;
  END IF;

  -- -----------------------------------------------------------------------
  -- Criar / atualizar mirror em cs_agendamentos
  -- -----------------------------------------------------------------------
  -- Buscar cs_clientes via patients.phone
  SELECT cl.id, pat.name
  INTO v_cs_client_id, v_nome_cliente
  FROM public.patients pat
  JOIN public.cs_clientes cl
    ON cl.telefone = public._phone_digits(pat.phone)
   AND cl.clinic_id = pat.clinic_id
  WHERE pat.id = NEW.patient_id
    AND pat.clinic_id = NEW.clinic_id
  LIMIT 1;

  -- Se não achou via patients, tentar diretamente pelo telefone da patients
  IF v_cs_client_id IS NULL THEN
    SELECT cl.id INTO v_cs_client_id
    FROM public.patients pat
    JOIN public.cs_clientes cl
      ON public._phone_digits(cl.telefone) = public._phone_digits(pat.phone)
     AND cl.clinic_id = pat.clinic_id
    WHERE pat.id = NEW.patient_id
      AND pat.clinic_id = NEW.clinic_id
    LIMIT 1;
  END IF;

  -- Verificar se mirror já existe
  SELECT id INTO v_existing_id
  FROM public.cs_agendamentos
  WHERE from_appointments_id = NEW.id;

  IF v_existing_id IS NOT NULL THEN
    -- Atualizar mirror existente
    UPDATE public.cs_agendamentos
    SET
      data_agendamento  = v_data,
      horario           = v_horario,
      status            = v_cs_status,
      nome_procedimento = NEW.service_name,
      nome_cliente      = v_nome_cliente,
      profissional_id   = coalesce(v_cs_prof_id, profissional_id),
      nome_profissional = coalesce(v_nome_prof, nome_profissional),
      atualizado_em     = now(),
      mutacao_origem    = 'painel'
    WHERE id = v_existing_id;

  ELSIF TG_OP = 'INSERT' AND v_cs_prof_id IS NOT NULL AND v_cs_client_id IS NOT NULL THEN
    -- Criar mirror novo (só se temos ambos os IDs necessários)
    INSERT INTO public.cs_agendamentos (
      clinic_id,
      cliente_id,
      profissional_id,
      data_agendamento,
      horario,
      status,
      nome_cliente,
      nome_profissional,
      nome_procedimento,
      painel_confirmado,
      mutacao_origem,
      from_appointments_id
    ) VALUES (
      NEW.clinic_id,
      v_cs_client_id,
      v_cs_prof_id,
      v_data,
      v_horario,
      v_cs_status,
      v_nome_cliente,
      v_nome_prof,
      NEW.service_name,
      true,
      'painel',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_to_cs ON public.appointments;
CREATE TRIGGER trg_appointments_to_cs
  AFTER INSERT OR UPDATE OF status, starts_at, ends_at, professional_id
  ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public._trg_appointments_to_cs();

-- ---------------------------------------------------------------------------
-- 3. painel_list_cs_agendamentos: excluir mirrors (from_appointments_id NOT NULL)
--    para não duplicar no painel (já aparecem via appointments directamente).
-- ---------------------------------------------------------------------------
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
            'cs_mutacao_origem', to_jsonb(a.mutacao_origem),
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
          -- Excluir mirrors de appointments (já aparecem pelo select appointments no painel)
          AND a.from_appointments_id IS NULL
      ) sub
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.painel_list_cs_agendamentos (uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_list_cs_agendamentos (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_list_cs_agendamentos (uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Backfill: appointments activos → bloquear slots + criar mirrors
--    (executa a lógica do trigger para dados existentes)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_cs_prof_id   uuid;
  v_cs_client_id uuid;
  v_clinic_tz    text;
  v_data         date;
  v_horario      time;
  v_cs_status    text;
  v_nome_prof    text;
  v_nome_cliente text;
BEGIN
  FOR r IN
    SELECT a.*, p.name AS prof_name, p.cs_profissional_id,
           pat.name AS patient_name
    FROM public.appointments a
    JOIN public.professionals p ON p.id = a.professional_id AND p.clinic_id = a.clinic_id
    LEFT JOIN public.patients pat ON pat.id = a.patient_id AND pat.clinic_id = a.clinic_id
    WHERE p.cs_profissional_id IS NOT NULL
      -- Não re-processar os que já têm mirror
      AND NOT EXISTS (
        SELECT 1 FROM public.cs_agendamentos ca WHERE ca.from_appointments_id = a.id
      )
  LOOP
    SELECT coalesce(nullif(trim(c.timezone), ''), 'America/Sao_Paulo')
    INTO v_clinic_tz
    FROM public.clinics c WHERE c.id = r.clinic_id;

    v_data    := (r.starts_at AT TIME ZONE v_clinic_tz)::date;
    v_horario := (r.starts_at AT TIME ZONE v_clinic_tz)::time;
    v_cs_status := CASE r.status
      WHEN 'cancelled' THEN 'cancelado'
      WHEN 'completed' THEN 'concluido'
      ELSE 'confirmado'
    END;

    -- Bloquear slot se agendamento activo
    IF r.status = 'scheduled' THEN
      INSERT INTO public.cs_horarios_disponiveis (profissional_id, data, horario, disponivel, bloqueio_manual)
      VALUES (r.cs_profissional_id, v_data, v_horario, false, false)
      ON CONFLICT (profissional_id, data, horario)
      DO UPDATE SET disponivel = false
      WHERE cs_horarios_disponiveis.disponivel = true
        AND cs_horarios_disponiveis.bloqueio_manual = false;
    END IF;

    -- Buscar cs_clientes correspondente
    SELECT cl.id, r.patient_name
    INTO v_cs_client_id, v_nome_cliente
    FROM public.cs_clientes cl
    WHERE cl.clinic_id = r.clinic_id
      AND cl.telefone = public._phone_digits(
        (SELECT phone FROM public.patients WHERE id = r.patient_id LIMIT 1)
      )
    LIMIT 1;

    IF v_cs_client_id IS NOT NULL THEN
      INSERT INTO public.cs_agendamentos (
        clinic_id, cliente_id, profissional_id, data_agendamento, horario,
        status, nome_cliente, nome_profissional, nome_procedimento,
        painel_confirmado, mutacao_origem, from_appointments_id
      ) VALUES (
        r.clinic_id, v_cs_client_id, r.cs_profissional_id, v_data, v_horario,
        v_cs_status, r.patient_name, r.prof_name, r.service_name,
        true, 'painel', r.id
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;
