-- Dedupe de avisos WhatsApp ao profissional disparados pelo webhook em cs_agendamentos
-- (funciona com o painel fechado). Só service_role escreve — via Next.js com SUPABASE_SERVICE_ROLE_KEY.

CREATE TABLE IF NOT EXISTS public.cs_prof_notify_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  cs_agendamento_id uuid NOT NULL REFERENCES public.cs_agendamentos (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN ('new', 'cancel', 'reschedule')
  ),
  sent_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cs_prof_notify_outbox IS
'Registo de envios para evitar duplicados (reintentos do webhook ou corrida com o painel).';

CREATE INDEX IF NOT EXISTS cs_prof_notify_outbox_dedupe_idx ON public.cs_prof_notify_outbox (
  cs_agendamento_id,
  kind,
  sent_at DESC
);

REVOKE ALL ON public.cs_prof_notify_outbox FROM PUBLIC;

REVOKE ALL ON public.cs_prof_notify_outbox FROM anon;

REVOKE ALL ON public.cs_prof_notify_outbox FROM authenticated;

GRANT SELECT, INSERT ON public.cs_prof_notify_outbox TO service_role;

ALTER TABLE public.cs_prof_notify_outbox ENABLE ROW LEVEL SECURITY;
