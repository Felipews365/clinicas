-- Lista profissionais ativos para o agente WhatsApp (n8n tool).
-- Chamada sem parâmetros, filtra por ativo = true.
-- Para múltiplas clínicas: adicione filtro por clinic_id usando a tabela clinics + p_telefone.

create or replace function public.n8n_cs_consultar_profissionais ()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'profissional_id', p.id,
        'nome',            p.nome,
        'especialidade',   p.especialidade
      )
      order by p.nome asc
    ),
    '[]'::jsonb
  )
  from public.cs_profissionais p
  where p.ativo = true;
$$;

-- Alias curto (o workflow n8n usa /rpc/cs_consultar_profissionais)
create or replace function public.cs_consultar_profissionais ()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.n8n_cs_consultar_profissionais();
$$;

-- Permissões
revoke all on function public.n8n_cs_consultar_profissionais () from public;
grant execute on function public.n8n_cs_consultar_profissionais () to service_role;
grant execute on function public.n8n_cs_consultar_profissionais () to authenticated;
grant execute on function public.n8n_cs_consultar_profissionais () to anon;

revoke all on function public.cs_consultar_profissionais () from public;
grant execute on function public.cs_consultar_profissionais () to service_role;
grant execute on function public.cs_consultar_profissionais () to authenticated;
grant execute on function public.cs_consultar_profissionais () to anon;
