import { NextResponse } from "next/server";
import { canManageClinic } from "@/lib/clinic-permissions";
import { createClient } from "@/lib/supabase/server";
import { computeTrialExpiryLocalDate } from "@/lib/trial";

type AssinaturaFields = {
  plan_id: string | null;
  tipo_plano: string;
  plan_tem_crm: boolean;
  data_expiracao: string | null;
  inadimplente: boolean;
  ativo: boolean;
  numero_clinica: string | null;
  crm_reengagement_message: string | null;
};

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

  const { data, error } = await supabase
    .from("clinics")
    .select(
      "plan_id, plan_tem_crm, tipo_plano, data_expiracao, inadimplente, ativo, numero_clinica, crm_reengagement_message"
    )
    .eq("id", clinicId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const canEdit = await canManageClinic(supabase, clinicId, user.id);

  const planId =
    data.plan_id == null || String(data.plan_id).trim() === ""
      ? null
      : String(data.plan_id);

  const fields: AssinaturaFields = {
    plan_id: planId,
    tipo_plano: typeof data.tipo_plano === "string" ? data.tipo_plano : "teste",
    plan_tem_crm:
      data.plan_tem_crm === true || String(data.plan_tem_crm) === "true",
    data_expiracao:
      data.data_expiracao == null
        ? null
        : typeof data.data_expiracao === "string"
          ? data.data_expiracao.slice(0, 10)
          : String(data.data_expiracao).slice(0, 10),
    inadimplente: !!data.inadimplente,
    ativo: data.ativo !== false,
    numero_clinica:
      data.numero_clinica == null || String(data.numero_clinica).trim() === ""
        ? null
        : String(data.numero_clinica).trim(),
    crm_reengagement_message:
      data.crm_reengagement_message == null ||
      String(data.crm_reengagement_message).trim() === ""
        ? null
        : String(data.crm_reengagement_message).trim(),
  };

  return NextResponse.json({ fields, canEdit });
}

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
      { error: "FORBIDDEN", message: "Apenas dono ou administrador pode alterar." },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.plan_id !== undefined) {
    const raw = body.plan_id;
    if (raw === null || raw === "") {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "plan_id é obrigatório; use o identificador do plano na lista.",
        },
        { status: 400 }
      );
    }
    const pid = String(raw).trim();
    const { data: pl, error: pe } = await supabase
      .from("planos")
      .select("id")
      .eq("id", pid)
      .eq("ativo", true)
      .maybeSingle();
    if (pe) {
      return NextResponse.json({ error: pe.message }, { status: 500 });
    }
    if (!pl) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Plano não encontrado ou inativo.",
        },
        { status: 400 }
      );
    }
    patch.plan_id = pid;
  } else if (body.tipo_plano !== undefined) {
    const codigo = String(body.tipo_plano).trim().toLowerCase();
    const { data: pl, error: pe } = await supabase
      .from("planos")
      .select("id")
      .eq("codigo", codigo)
      .eq("ativo", true)
      .maybeSingle();
    if (pe) {
      return NextResponse.json({ error: pe.message }, { status: 500 });
    }
    if (!pl) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message:
            "Código de plano desconhecido. Atualize o cliente ou escolha plan_id.",
        },
        { status: 400 }
      );
    }
    patch.plan_id = pl.id;
  }

  if (body.data_expiracao !== undefined) {
    const v = body.data_expiracao;
    if (v === null || v === "") {
      patch.data_expiracao = null;
    } else if (typeof v === "string") {
      const s = v.trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return NextResponse.json(
          { error: "VALIDATION", message: "data_expiracao use YYYY-MM-DD." },
          { status: 400 }
        );
      }
      patch.data_expiracao = s;
    } else {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }
  }

  if (body.inadimplente !== undefined) {
    if (typeof body.inadimplente !== "boolean") {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }
    patch.inadimplente = body.inadimplente;
  }

  if (body.ativo !== undefined) {
    if (typeof body.ativo !== "boolean") {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }
    patch.ativo = body.ativo;
  }

  if (body.numero_clinica !== undefined) {
    const v = body.numero_clinica;
    if (v === null || v === "") {
      patch.numero_clinica = null;
    } else if (typeof v === "string") {
      const t = v.trim();
      patch.numero_clinica = t.length ? t : null;
    } else {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }
  }

  if (
    patch.plan_id !== undefined &&
    body.data_expiracao === undefined &&
    typeof patch.plan_id === "string"
  ) {
    const { data: plCod, error: codErr } = await supabase
      .from("planos")
      .select("codigo")
      .eq("id", patch.plan_id)
      .maybeSingle();
    if (codErr) {
      return NextResponse.json({ error: codErr.message }, { status: 500 });
    }
    const cod = typeof plCod?.codigo === "string" ? plCod.codigo.trim().toLowerCase() : "";
    if (cod === "teste") {
      patch.data_expiracao = computeTrialExpiryLocalDate();
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "EMPTY_PATCH" }, { status: 400 });
  }

  const { error } = await supabase.from("clinics").update(patch).eq("id", clinicId);

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json(
        {
          error: "CONFLICT",
          message: "numero_clinica já usado por outra clínica.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
