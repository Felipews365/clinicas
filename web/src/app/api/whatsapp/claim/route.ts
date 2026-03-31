import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Utilizador com acesso à clínica (dono ou clinic_members) assume a conversa WhatsApp.
 */
export async function POST(request: Request) {
  let body: { session_id?: string };
  try {
    body = (await request.json()) as { session_id?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const sessionId = body.session_id?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "session_id obrigatório" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { data: row, error: selErr } = await supabase
      .from("whatsapp_sessions")
      .select("id, clinic_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (selErr || !row) {
      return NextResponse.json(
        { error: selErr?.message ?? "Sessão não encontrada" },
        { status: 404 }
      );
    }

    const { data: hasAccess, error: accessErr } = await supabase.rpc(
      "rls_has_clinic_access",
      { p_clinic_id: row.clinic_id }
    );

    if (accessErr || !hasAccess) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const { error: upErr } = await supabase
      .from("whatsapp_sessions")
      .update({
        staff_handling: true,
        needs_human: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    revalidatePath("/painel", "layout");
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
