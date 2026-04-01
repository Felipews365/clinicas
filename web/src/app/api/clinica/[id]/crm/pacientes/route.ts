import { NextResponse } from "next/server";
import { canManageClinic } from "@/lib/clinic-permissions";
import { CRM_PLAN_REQUIRED_RESPONSE, hasFullAccess } from "@/lib/crm-access";
import { isCrmFunilStatus } from "@/lib/crm-funil";
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

function isPlanRequiredError(err: { code?: string; message?: string }) {
  return (
    err.code === "P0001" ||
    (err.message?.toLowerCase().includes("plan_required") ?? false) ||
    (err.message?.toLowerCase().includes("crm requer plano") ?? false)
  );
}

export async function GET(
  _req: Request,
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
  if (ge) {
    return NextResponse.json({ error: ge }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (!hasFullAccess(row)) {
    return NextResponse.json(CRM_PLAN_REQUIRED_RESPONSE, { status: 403 });
  }

  const { data, error } = await supabase.rpc("painel_crm_list_pacientes", {
    p_clinic_id: clinicId,
  });

  if (error) {
    if (isPlanRequiredError(error)) {
      return NextResponse.json(CRM_PLAN_REQUIRED_RESPONSE, { status: 403 });
    }
    if (error.code === "42501" || error.message?.includes("forbidden")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const canEdit = await canManageClinic(supabase, clinicId, user.id);
  return NextResponse.json({ pacientes: data ?? [], canEdit });
}

const CRM_STATUS = new Set(["ativo", "inativo", "sumido"]);

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

  const allowed = await canManageClinic(supabase, clinicId, user.id);
  if (!allowed) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Apenas dono ou administrador pode editar." },
      { status: 403 }
    );
  }

  const { row, error: ge } = await fetchClinicGate(supabase, clinicId);
  if (ge) {
    return NextResponse.json({ error: ge }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
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
  if (typeof clienteId !== "string" || !clienteId.trim()) {
    return NextResponse.json({ error: "VALIDATION", message: "cliente_id obrigatório." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.notas !== undefined) {
    if (body.notas !== null && typeof body.notas !== "string") {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }
    patch.notas = body.notas;
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === "string")) {
      return NextResponse.json({ error: "VALIDATION", message: "tags deve ser string[]" }, { status: 400 });
    }
    patch.tags = body.tags;
  }

  if (body.status_relacionamento !== undefined) {
    const s = body.status_relacionamento;
    if (typeof s !== "string" || !CRM_STATUS.has(s)) {
      return NextResponse.json(
        { error: "VALIDATION", message: "status_relacionamento inválido." },
        { status: 400 }
      );
    }
    patch.status_relacionamento = s;
  }

  if (body.data_ultimo_contato !== undefined) {
    const v = body.data_ultimo_contato;
    if (v === null) {
      patch.data_ultimo_contato = null;
    } else if (typeof v === "string") {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
      }
      patch.data_ultimo_contato = d.toISOString();
    } else {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }
  }

  if (body.status_funil !== undefined) {
    const s = body.status_funil;
    if (typeof s !== "string" || !isCrmFunilStatus(s)) {
      return NextResponse.json(
        { error: "VALIDATION", message: "status_funil inválido." },
        { status: 400 }
      );
    }
    patch.status_funil = s;
  }

  if (body.origem !== undefined) {
    if (body.origem !== null && typeof body.origem !== "string") {
      return NextResponse.json({ error: "VALIDATION", message: "origem inválida." }, { status: 400 });
    }
    patch.origem = body.origem === null || body.origem === "" ? null : String(body.origem).trim();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "EMPTY_PATCH" }, { status: 400 });
  }

  const { error } = await supabase
    .from("cs_clientes")
    .update(patch)
    .eq("id", clienteId.trim())
    .eq("clinic_id", clinicId);

  if (error) {
    const msg = error.message?.toLowerCase() ?? "";
    if (msg.includes("crm_plan_required") || msg.includes("plano não permite")) {
      return NextResponse.json(CRM_PLAN_REQUIRED_RESPONSE, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
