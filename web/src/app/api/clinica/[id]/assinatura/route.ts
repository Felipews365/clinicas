import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type AssinaturaFields = {
  tipo_plano: string;
  data_expiracao: string | null;
  inadimplente: boolean;
  ativo: boolean;
  numero_clinica: string | null;
};

async function canManageClinic(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string
): Promise<boolean> {
  const { data: clinic, error: cErr } = await supabase
    .from("clinics")
    .select("owner_id")
    .eq("id", clinicId)
    .maybeSingle();

  if (cErr || !clinic) return false;
  if (clinic.owner_id === userId) return true;

  const { data: member } = await supabase
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();

  const role = member?.role;
  return role === "owner" || role === "admin";
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

  const { data, error } = await supabase
    .from("clinics")
    .select("tipo_plano, data_expiracao, inadimplente, ativo, numero_clinica")
    .eq("id", clinicId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const canEdit = await canManageClinic(supabase, clinicId, user.id);

  const fields: AssinaturaFields = {
    tipo_plano: typeof data.tipo_plano === "string" ? data.tipo_plano : "teste",
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

  if (body.tipo_plano !== undefined) {
    const v = body.tipo_plano;
    if (v !== "teste" && v !== "mensal") {
      return NextResponse.json(
        { error: "VALIDATION", message: "tipo_plano deve ser teste ou mensal." },
        { status: 400 }
      );
    }
    patch.tipo_plano = v;
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
