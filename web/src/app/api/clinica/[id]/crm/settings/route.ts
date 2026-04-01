import { NextResponse } from "next/server";
import { canManageClinic } from "@/lib/clinic-permissions";
import { CRM_PLAN_REQUIRED_RESPONSE, hasFullAccess } from "@/lib/crm-access";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
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
      { error: "FORBIDDEN", message: "Apenas dono ou administrador pode alterar." },
      { status: 403 }
    );
  }

  const { data: clin, error: ce } = await supabase
    .from("clinics")
    .select("tipo_plano, data_expiracao, ativo, inadimplente, plan_tem_crm")
    .eq("id", clinicId)
    .maybeSingle();

  if (ce) return NextResponse.json({ error: ce.message }, { status: 500 });
  if (!clin) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const gate = {
    tipo_plano: typeof clin.tipo_plano === "string" ? clin.tipo_plano : "teste",
    data_expiracao:
      clin.data_expiracao == null
        ? null
        : typeof clin.data_expiracao === "string"
          ? clin.data_expiracao.slice(0, 10)
          : String(clin.data_expiracao).slice(0, 10),
    ativo: clin.ativo !== false,
    inadimplente: !!clin.inadimplente,
    plan_tem_crm:
      clin.plan_tem_crm === true || String(clin.plan_tem_crm) === "true",
  };
  if (!hasFullAccess(gate)) {
    return NextResponse.json(CRM_PLAN_REQUIRED_RESPONSE, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  if (body.crm_reengagement_message === undefined) {
    return NextResponse.json({ error: "EMPTY_PATCH" }, { status: 400 });
  }

  const v = body.crm_reengagement_message;
  const message =
    v === null || v === ""
      ? null
      : typeof v === "string"
        ? v.trim() || null
        : null;

  const { error } = await supabase
    .from("clinics")
    .update({ crm_reengagement_message: message })
    .eq("id", clinicId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
