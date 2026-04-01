import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/supabase/env";

/** Listagem pública de planos ativos (landing, marketing). */
export async function GET() {
  const { url, key } = getPublicSupabaseConfig();
  if (!url || !key) {
    return NextResponse.json(
      { error: "MISCONFIGURED", message: "Supabase URL/anon key em falta." },
      { status: 500 }
    );
  }

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await sb
    .from("planos")
    .select(
      "id, codigo, nome, preco_mensal, preco_anual, descricao, features, limite_profissionais, limite_agendamentos_mes, tem_crm, tem_agente_ia, tem_whatsapp, tem_relatorios, ordem"
    )
    .eq("ativo", true)
    .order("ordem", { ascending: true })
    .order("nome", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ planos: data ?? [] });
}
