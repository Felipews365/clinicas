import { NextResponse } from "next/server";
import { CRM_PLAN_REQUIRED_RESPONSE, hasFullAccess } from "@/lib/crm-access";
import { createClient } from "@/lib/supabase/server";

async function fetchClinicGate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string
) {
  const { data, error } = await supabase
    .from("clinics")
    .select("tipo_plano, data_expiracao, ativo, inadimplente, plan_tem_crm")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) return { error: error.message as string, row: null };
  if (!data) return { error: null as string | null, row: null };
  const row = {
    tipo_plano: typeof data.tipo_plano === "string" ? data.tipo_plano : "teste",
    data_expiracao:
      data.data_expiracao == null
        ? null
        : typeof data.data_expiracao === "string"
          ? data.data_expiracao.slice(0, 10)
          : String(data.data_expiracao).slice(0, 10),
    ativo: data.ativo !== false,
    inadimplente: !!data.inadimplente,
    plan_tem_crm:
      data.plan_tem_crm === true || String(data.plan_tem_crm) === "true",
  };
  return { error: null as string | null, row };
}

function isPlanRequired(err: { message?: string }) {
  const m = err.message?.toLowerCase() ?? "";
  return m.includes("plan_required") || m.includes("crm requer");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; clienteId: string }> }
) {
  const { id: clinicId, clienteId } = await params;
  if (!clinicId?.trim() || !clienteId?.trim()) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { row, error: ge } = await fetchClinicGate(supabase, clinicId);
  if (ge) return NextResponse.json({ error: ge }, { status: 500 });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!hasFullAccess(row)) {
    return NextResponse.json(CRM_PLAN_REQUIRED_RESPONSE, { status: 403 });
  }

  const cid = clienteId.trim();

  const [agRes, intRes, pendRes] = await Promise.all([
    supabase.rpc("painel_crm_paciente_agendamentos", {
      p_clinic_id: clinicId,
      p_cliente_id: cid,
    }),
    supabase.rpc("painel_crm_paciente_interacoes", {
      p_clinic_id: clinicId,
      p_cliente_id: cid,
    }),
    supabase
      .from("crm_followup_tasks")
      .select("id, titulo, due_date, concluido_em, created_at")
      .eq("clinic_id", clinicId)
      .eq("cliente_id", cid)
      .is("concluido_em", null)
      .order("due_date", { ascending: true }),
  ]);

  if (agRes.error) {
    if (isPlanRequired(agRes.error))
      return NextResponse.json(CRM_PLAN_REQUIRED_RESPONSE, { status: 403 });
    if (agRes.error.message?.includes("not_found") || agRes.error.code === "P0002") {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ error: agRes.error.message }, { status: 500 });
  }
  if (intRes.error) {
    return NextResponse.json({ error: intRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    agendamentos: agRes.data ?? [],
    interacoes: intRes.data ?? [],
    tarefas_pendentes: pendRes.data ?? [],
  });
}
