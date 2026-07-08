import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/lib/system-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { computeTrialExpiryLocalDate, TRIAL_DURATION_DAYS } from "@/lib/trial";

function localYmdPlusDays(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function PATCH(req: Request) {
  const auth = await requireSystemAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json(
      { error: "VALIDATION", message: "id da clínica é obrigatório." },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = {};

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

  if (body.extend_days !== undefined) {
    const n = Number(body.extend_days);
    if (!Number.isFinite(n) || n <= 0 || n > 3650) {
      return NextResponse.json(
        { error: "VALIDATION", message: "extend_days inválido." },
        { status: 400 }
      );
    }
    patch.data_expiracao = localYmdPlusDays(Math.floor(n));
  }

  if (body.reset_trial === true) {
    patch.data_expiracao = computeTrialExpiryLocalDate();
  }

  if (typeof body.ativo === "boolean") patch.ativo = body.ativo;
  if (typeof body.inadimplente === "boolean") patch.inadimplente = body.inadimplente;

  if (typeof body.plan_id === "string" && body.plan_id.trim()) {
    patch.plan_id = body.plan_id.trim();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "EMPTY_PATCH" }, { status: 400 });
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    return NextResponse.json(
      {
        error: "MISCONFIGURED",
        message: e instanceof Error ? e.message : "Service role em falta.",
      },
      { status: 500 }
    );
  }

  const { data, error } = await admin
    .from("clinics")
    .update(patch)
    .eq("id", id)
    .select("id, data_expiracao, ativo, inadimplente, plan_id, tipo_plano")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, clinic: data, trial_days: TRIAL_DURATION_DAYS });
}
