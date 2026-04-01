import { NextResponse } from "next/server";
import { canManageClinic } from "@/lib/clinic-permissions";
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

export async function POST(
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

  if (!(await canManageClinic(supabase, clinicId, user.id))) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Apenas dono ou administrador pode registar interações." },
      { status: 403 }
    );
  }

  const { row, error: ge } = await fetchClinicGate(supabase, clinicId);
  if (ge) return NextResponse.json({ error: ge }, { status: 500 });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!hasFullAccess(row)) {
    return NextResponse.json(CRM_PLAN_REQUIRED_RESPONSE, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const clienteId = body.cliente_id;
  const tipo = typeof body.tipo === "string" ? body.tipo.trim() || "nota" : "nota";
  const resumo = body.resumo;
  if (typeof clienteId !== "string" || !clienteId.trim()) {
    return NextResponse.json({ error: "VALIDATION", message: "cliente_id obrigatório." }, { status: 400 });
  }
  if (typeof resumo !== "string" || !resumo.trim()) {
    return NextResponse.json({ error: "VALIDATION", message: "resumo obrigatório." }, { status: 400 });
  }

  const { count } = await supabase
    .from("cs_clientes")
    .select("*", { count: "exact", head: true })
    .eq("id", clienteId.trim())
    .eq("clinic_id", clinicId);
  if (!count) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("crm_interacoes")
    .insert({
      clinic_id: clinicId,
      cliente_id: clienteId.trim(),
      tipo,
      resumo: resumo.trim(),
    })
    .select("id, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, interacao: data });
}
