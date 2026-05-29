-- Remove a versão antiga (7 parâmetros) de n8n_cs_reagendar.
-- A coexistência com a versão de 8 parâmetros (p_mutacao_origem DEFAULT 'agente')
-- causava ambiguidade na resolução de overload via PostgREST quando o n8n chamava
-- a RPC com 7 parâmetros — Postgres não conseguia decidir qual usar e devolvia
-- erro, fazendo o agente WhatsApp improvisar "houve um problema ao reagendar".
DROP FUNCTION IF EXISTS public.n8n_cs_reagendar(
  uuid, date, time without time zone, uuid, uuid, date, time without time zone
);
