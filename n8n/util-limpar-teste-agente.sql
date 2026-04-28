-- Util: repetir teste como "cliente novo" — apaga memória LangChain e zera nome em cs_clientes.
--
-- Painel web: a inbox WhatsApp chama a RPC public.painel_limpar_sessao_agente (migração
-- 20260430120000_painel_limpar_sessao_agente.sql) com checkbox para incluir ou não o nome.
--
-- No Set manual, defina:
--   clinic_id   (UUID)
--   remote_jid  (ex.: 5581999999999@s.whatsapp.net)
--   telefone    (dígitos ou JID; mesma normalização que n8n_cs_salvar_nome)
--
-- ── Nó 1: Postgres executeQuery — histórico do agente ─────────────────────
-- session_id no n8n (expression): {{ $json.clinic_id + ':' + $json.remote_jid }}

DELETE FROM public.n8n_chat_histories
WHERE session_id = '{{ $json.clinic_id }}:{{ $json.remote_jid }}';

-- ── Nó 2: Postgres executeQuery — nome em cadastro ────────────────────────
-- Duplique a expressão de dígitos nos dois sítios ou use um nó Code antes que devolva telefone_digits.

UPDATE public.cs_clientes c
SET
  nome       = '',
  updated_at = now()
WHERE c.clinic_id = '{{ $json.clinic_id }}'::uuid
  AND (
    c.telefone = regexp_replace(trim('{{ $json.telefone }}'), '\D', '', 'g')
    OR (
      length(regexp_replace(trim('{{ $json.telefone }}'), '\D', '', 'g')) > 11
      AND regexp_replace(c.telefone, '\D', '', 'g')
        = substring(
            regexp_replace(trim('{{ $json.telefone }}'), '\D', '', 'g')
            FROM 3
          )
    )
  );
