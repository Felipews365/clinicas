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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id: clinicId, taskId } = await params;
  if (!clinicId?.trim() || !taskId?.trim()) {
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
      { error: "FORBIDDEN", message: "Apenas dono ou administrador pode editar." },
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

  if (body.concluir !== true) {
    return NextResponse.json({ error: "VALIDATION", message: "Envie { concluir: true }." }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("crm_followup_tasks")
    .select("id")
    .eq("id", taskId.trim())
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const { error } = await supabase
    .from("crm_followup_tasks")
    .update({ concluido_em: new Date().toISOString() })
    .eq("id", taskId.trim())
    .eq("clinic_id", clinicId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
