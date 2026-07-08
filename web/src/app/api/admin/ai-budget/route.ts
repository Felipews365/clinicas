import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/lib/system-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getUsdBrlRate } from "@/lib/admin/clinics-data";

type StatusRow = {
  budget_usd: number | string;
  spent_total_usd: number | string;
  spent_mes_atual_usd: number | string;
  remaining_usd: number | string;
  pct_used: number | string;
  updated_at: string | null;
};

function shape(row: StatusRow | null, rate: number) {
  const budget = Number(row?.budget_usd ?? 0) || 0;
  const total = Number(row?.spent_total_usd ?? 0) || 0;
  const mes = Number(row?.spent_mes_atual_usd ?? 0) || 0;
  const remaining = Number(row?.remaining_usd ?? Math.max(budget - total, 0)) || 0;
  const pct = Number(row?.pct_used ?? 0) || 0;
  return {
    budget_usd: budget,
    budget_brl: budget * rate,
    spent_total_usd: total,
    spent_total_brl: total * rate,
    spent_mes_atual_usd: mes,
    spent_mes_atual_brl: mes * rate,
    remaining_usd: remaining,
    remaining_brl: remaining * rate,
    pct_used: pct,
    updated_at: row?.updated_at ?? null,
    usd_brl_rate: rate,
  };
}

export async function GET() {
  const auth = await requireSystemAdmin();
  if (auth instanceof NextResponse) return auth;

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    return NextResponse.json(
      { error: "MISCONFIGURED", message: e instanceof Error ? e.message : "Service role em falta." },
      { status: 500 }
    );
  }

  const { data, error } = await admin.rpc("admin_ai_budget_status");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = Array.isArray(data) ? (data[0] as StatusRow) : null;
  return NextResponse.json({ ok: true, status: shape(row, getUsdBrlRate()) });
}

export async function PUT(req: Request) {
  const auth = await requireSystemAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const raw = body.budget_usd;
  const budget = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(budget) || budget < 0 || budget > 1_000_000) {
    return NextResponse.json(
      { error: "VALIDATION", message: "Orçamento inválido (use número >= 0)." },
      { status: 400 }
    );
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    return NextResponse.json(
      { error: "MISCONFIGURED", message: e instanceof Error ? e.message : "Service role em falta." },
      { status: 500 }
    );
  }

  const { error: setErr } = await admin.rpc("admin_set_ai_budget", {
    p_budget_usd: budget,
  });
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

  const { data, error } = await admin.rpc("admin_ai_budget_status");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = Array.isArray(data) ? (data[0] as StatusRow) : null;
  return NextResponse.json({ ok: true, status: shape(row, getUsdBrlRate()) });
}
