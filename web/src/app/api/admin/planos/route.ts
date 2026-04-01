import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/lib/system-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type PlanoInsert = {
  codigo: string;
  nome: string;
  preco_mensal?: number | null;
  preco_anual?: number | null;
  descricao?: string | null;
  features?: string[];
  limite_profissionais?: number;
  limite_agendamentos_mes?: number;
  tem_crm?: boolean;
  tem_agente_ia?: boolean;
  tem_whatsapp?: boolean;
  tem_relatorios?: boolean;
  ativo?: boolean;
  ordem?: number;
};

function parseNum(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

export async function GET() {
  const auth = await requireSystemAdmin();
  if (auth instanceof NextResponse) return auth;

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
    .from("planos")
    .select("*")
    .order("ordem", { ascending: true })
    .order("nome", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ planos: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireSystemAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const codigo =
    typeof body.codigo === "string" ? body.codigo.trim().toLowerCase() : "";
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  if (!codigo || !nome) {
    return NextResponse.json(
      { error: "VALIDATION", message: "codigo e nome são obrigatórios." },
      { status: 400 }
    );
  }

  const row: PlanoInsert = {
    codigo,
    nome,
    preco_mensal: parseNum(body.preco_mensal),
    preco_anual: parseNum(body.preco_anual),
    descricao:
      body.descricao == null || body.descricao === ""
        ? null
        : String(body.descricao),
    features: Array.isArray(body.features)
      ? body.features.map((x) => String(x))
      : [],
    limite_profissionais:
      typeof body.limite_profissionais === "number"
        ? body.limite_profissionais
        : -1,
    limite_agendamentos_mes:
      typeof body.limite_agendamentos_mes === "number"
        ? body.limite_agendamentos_mes
        : -1,
    tem_crm: body.tem_crm === true,
    tem_agente_ia: body.tem_agente_ia !== false,
    tem_whatsapp: body.tem_whatsapp !== false,
    tem_relatorios: body.tem_relatorios !== false,
    ativo: body.ativo !== false,
    ordem: typeof body.ordem === "number" ? body.ordem : 0,
  };

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

  const { data, error } = await admin.from("planos").insert(row).select().single();

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json(
        { error: "CONFLICT", message: "Já existe plano com este código." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ plano: data }, { status: 201 });
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
      { error: "VALIDATION", message: "id do plano é obrigatório." },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = {};

  if (typeof body.codigo === "string" && body.codigo.trim()) {
    patch.codigo = body.codigo.trim().toLowerCase();
  }
  if (typeof body.nome === "string" && body.nome.trim()) {
    patch.nome = body.nome.trim();
  }
  if ("preco_mensal" in body) patch.preco_mensal = parseNum(body.preco_mensal);
  if ("preco_anual" in body) patch.preco_anual = parseNum(body.preco_anual);
  if ("descricao" in body) {
    patch.descricao =
      body.descricao == null || body.descricao === ""
        ? null
        : String(body.descricao);
  }
  if (Array.isArray(body.features)) {
    patch.features = body.features.map((x) => String(x));
  }
  if (typeof body.limite_profissionais === "number") {
    patch.limite_profissionais = body.limite_profissionais;
  }
  if (typeof body.limite_agendamentos_mes === "number") {
    patch.limite_agendamentos_mes = body.limite_agendamentos_mes;
  }
  if (typeof body.tem_crm === "boolean") patch.tem_crm = body.tem_crm;
  if (typeof body.tem_agente_ia === "boolean") {
    patch.tem_agente_ia = body.tem_agente_ia;
  }
  if (typeof body.tem_whatsapp === "boolean") {
    patch.tem_whatsapp = body.tem_whatsapp;
  }
  if (typeof body.tem_relatorios === "boolean") {
    patch.tem_relatorios = body.tem_relatorios;
  }
  if (typeof body.ativo === "boolean") patch.ativo = body.ativo;
  if (typeof body.ordem === "number") patch.ordem = body.ordem;

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
    .from("planos")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ plano: data });
}
