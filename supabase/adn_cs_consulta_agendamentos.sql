-- RPC para o workflow n8n: insere em public."Agendamentos" (tabela simples Isa / nós nativos)
-- PostgREST: POST /rest/v1/rpc/adn_cs_consulta  + JSON body (service_role ou anon com grant)

alter table public."Agendamentos" add column if not exists remote_jid text;

create or replace function public.adn_cs_consulta (
  p_remote_id text,
  p_nome_cliente text,
  p_telefone_cliente text,
  p_data_agendamento date,
  p_horario time,
  p_tipo_servico text,
  p_observacoes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public."Agendamentos" (
    nome_cliente,
    telefone_cliente,
    remote_jid,
    data_agendamento,
    horario,
    tipo_servico,
    status,
    observacoes
  )
  values (
    trim(p_nome_cliente),
    trim(p_telefone_cliente),
    nullif(trim(p_remote_id), ''),
    p_data_agendamento,
    p_horario,
    trim(p_tipo_servico),
    'agendado',
    coalesce(nullif(trim(p_observacoes), ''), '')
  )
  returning id into v_id;

  return jsonb_build_object(
    'success', true,
    'id', v_id,
    'message', 'Agendamento criado com sucesso'
  );
end;
$$;

revoke all on function public.adn_cs_consulta (text, text, text, date, time, text, text) from public;
grant execute on function public.adn_cs_consulta (text, text, text, date, time, text, text) to service_role;
grant execute on function public.adn_cs_consulta (text, text, text, date, time, text, text) to authenticated;
grant execute on function public.adn_cs_consulta (text, text, text, date, time, text, text) to anon;

-- Exemplo body (HTTP Request / tool POST → /rest/v1/rpc/adn_cs_consulta):
-- {
--   "p_remote_id": "5581999990000@s.whatsapp.net",
--   "p_nome_cliente": "Maria Souza",
--   "p_telefone_cliente": "5581999990000",
--   "p_data_agendamento": "2026-03-28",
--   "p_horario": "10:00:00",
--   "p_tipo_servico": "Clareamento dental",
--   "p_observacoes": "Agendado via WhatsApp"
-- }
