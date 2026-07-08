import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/lib/system-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getUsdBrlRate } from "@/lib/admin/clinics-data";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireSystemAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id || !/^[0-9a-f-]{8,}$/i.test(id)) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }

  const url = new URL(req.url);
  const periodoRaw = url.searchParams.get("periodo");
  const periodo = periodoRaw === "total" ? "total" : "mes";

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

  const { data, error } = await admin.rpc("admin_ai_usage_breakdown", {
    p_clinic_id: id,
    p_periodo: periodo,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rate = getUsdBrlRate();
  type Row = {
    agent: string;
    model: string;
    chamadas: number | string;
    prompt_tokens: number | string;
    completion_tokens: number | string;
    tokens: number | string;
    cost_usd: number | string;
  };
  const rows = (data as Row[] | null) ?? [];
  const breakdown = rows.map((r) => {
    const usd = Number(r.cost_usd) || 0;
    return {
      agent: r.agent,
      model: r.model,
      chamadas: Number(r.chamadas) || 0,
      prompt_tokens: Number(r.prompt_tokens) || 0,
      completion_tokens: Number(r.completion_tokens) || 0,
      tokens: Number(r.tokens) || 0,
      cost_usd: usd,
      cost_brl: usd * rate,
    };
  });

  return NextResponse.json({
    ok: true,
    periodo,
    usd_brl_rate: rate,
    breakdown,
  });
}
