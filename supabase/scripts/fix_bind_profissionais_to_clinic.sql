-- =============================================================================
-- Correção SaaS: amarrar cs_profissionais ao tenant (public.clinics.id)
-- Último exemplo aplicado (MCP): procs estavam em Consultório Demo 4c34c15d-15f6-4259-a13f-d2492729741b;
-- rebound para Clínica Saúde 5c8f7a44-c6b3-4835-889b-7e9f9b009125. Reexecutar é idempotente.
-- O painel e n8n_cs_consultar_vagas ignoram profissionais com clinic_id ≠ tenant.
--
-- Passo 1: execute supabase/scripts/diagnose_slots_saas.sql e confirme os IDs.
-- Passo 2: preencha v_clinic e (opcional) a lista de profissional_id abaixo.
-- Passo 3: reabra o dia no painel «Horários por Dr ou Dra.» para disparar
--          painel_cs_ensure_slots_grid (cria linhas em cs_horarios_disponiveis).
-- =============================================================================

do $$
declare
  v_clinic uuid := '5c8f7a44-c6b3-4835-889b-7e9f9b009125'::uuid;
  /* Outro tenant com o mesmo nome: 7619e1f6-1474-4181-85f7-d2a36b131c11 */
  v_updated int;
begin
  if v_clinic is null or not exists (select 1 from public.clinics c where c.id = v_clinic) then
    raise exception 'fix_bind: clinic_id inválido ou inexistente em public.clinics';
  end if;

  -- Modo A (recomendado, multi-tenant): listar explicitamente os profissionais
  update public.cs_profissionais p
  set
    clinic_id = v_clinic
  where
    p.id in (
      '68af775e-83d8-4ebb-afb6-4813002561e9'::uuid,
      'd979c0a9-8208-4759-99ec-c87e03dc5db7'::uuid
    )
    and (p.clinic_id is distinct from v_clinic);

  get diagnostics v_updated = row_count;
  raise notice 'fix_bind: profissionais atualizados (modo A, ids explícitos): %', v_updated;

  /* Descomente apenas se tiver UMA clínica no projeto e profissionais órfãos legados:
  if (select count(*) from public.clinics) = 1 then
    update public.cs_profissionais p
    set clinic_id = v_clinic
    where p.clinic_id is null
      and p.ativo = true;
    get diagnostics v_updated = row_count;
    raise notice 'fix_bind: órfãos ativos associados à única clínica: %', v_updated;
  end if;
  */
end $$;
