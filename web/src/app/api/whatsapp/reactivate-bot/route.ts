import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let body: { phone?: string };
  try {
    body = (await request.json()) as { phone?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const phone = body.phone?.trim();
  if (!phone) {
    return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Obtém clinic_id do utilizador autenticado
    const { data: member } = await supabase
      .from("clinic_members")
      .select("clinic_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: owner } = member?.clinic_id
      ? { data: null }
      : await supabase
          .from("clinics")
          .select("id")
          .eq("owner_id", user.id)
          .maybeSingle();

    const clinicId = member?.clinic_id ?? owner?.id;
    if (!clinicId) {
      return NextResponse.json({ error: "Clínica não encontrada" }, { status: 403 });
    }

    // Reactiva bot em cs_clientes (telefone pode ter @s.whatsapp.net ou não)
    await supabase
      .from("cs_clientes")
      .update({ bot_ativo: true })
      .eq("clinic_id", clinicId)
      .or(`telefone.eq.${phone},telefone.eq.${phone}@s.whatsapp.net`);

    // Limpa flags da sessão whatsapp
    await supabase
      .from("whatsapp_sessions")
      .update({ needs_human: false, staff_handling: false, updated_at: new Date().toISOString() })
      .eq("clinic_id", clinicId)
      .eq("phone", phone);

    revalidatePath("/painel", "layout");
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
