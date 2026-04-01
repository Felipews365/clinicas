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
  return {
    error: null as string | null,
    row: {
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
    },
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clinicId } = await params;
  if (!clinicId?.trim()) {
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

  const sp = new URL(req.url).searchParams;
  const mesRef = sp.get("mes");
  const rpcArgs =
    mesRef && /^\d{4}-\d{2}-\d{2}$/.test(mesRef)
      ? { p_clinic_id: clinicId, p_mes_ref: mesRef }
      : { p_clinic_id: clinicId };

  const { data, error } = await supabase.rpc(
    "painel_crm_metricas",
    rpcArgs as { p_clinic_id: string; p_mes_ref?: string }
  );

  if (error) {
    const m = error.message?.toLowerCase() ?? "";
    if (m.includes("plan_required") || m.includes("crm requer")) {
      return NextResponse.json(CRM_PLAN_REQUIRED_RESPONSE, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ metricas: data });
}
