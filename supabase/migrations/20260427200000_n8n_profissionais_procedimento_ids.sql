-- Inclui em n8n_cs_profissionais_para_agente a lista de clinic_procedure_id por profissional
-- (tabela professional_procedures). NULL = realiza todos os procedimentos ativos (igual ao painel).

create or replace function public.n8n_cs_profissionais_para_agente (p_clinic_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'nome', p.nome,
          'especialidade', p.especialidade,
          'procedimento_ids', (
            select case
              when exists (
                select 1
                from public.professional_procedures pp0
                where pp0.professional_id = pr.id
              ) then (
                select jsonb_agg(pp.clinic_procedure_id order by pp.clinic_procedure_id)
                from public.professional_procedures pp
                where pp.professional_id = pr.id
              )
              else null::jsonb
            end
          )
        )
        order by p.nome
      )
      from public.cs_profissionais p
      inner join public.professionals pr
        on pr.cs_profissional_id = p.id
        and pr.clinic_id = p_clinic_id
      where p.clinic_id = p_clinic_id
        and p.ativo = true
        and coalesce(pr.is_active, true) = true
    ),
    '[]'::jsonb
  );
$$;

revoke all on function public.n8n_cs_profissionais_para_agente (uuid) from public;
grant execute on function public.n8n_cs_profissionais_para_agente (uuid) to anon;
grant execute on function public.n8n_cs_profissionais_para_agente (uuid) to authenticated;
grant execute on function public.n8n_cs_profissionais_para_agente (uuid) to service_role;

comment on function public.n8n_cs_profissionais_para_agente (uuid) is
  'Profissionais ativos (cs + painel). procedimento_ids null = todos; senão só esses UUIDs (servico_id no agente).';
