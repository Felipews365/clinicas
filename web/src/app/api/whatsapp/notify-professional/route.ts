import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeProfessionalWhatsappBr } from "@/lib/br-whatsapp";
import { sendEvolutionClinicInstanceText } from "@/lib/whatsapp-evolution-send";

/** Aviso ao número do profissional (instância clinica-{clinic_id}), após acções no painel. */
export async function POST(req: Request) {
  let body: { clinic_id?: string; phone?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const clinicId = body.clinic_id?.trim();
  const phoneRaw = body.phone?.trim();
  const text = body.text?.trim();
  if (!clinicId || !phoneRaw || !text) {
    return NextResponse.json(
      { error: "clinic_id, phone e text são obrigatórios" },
      { status: 400 }
    );
  }

  const norm = normalizeProfessionalWhatsappBr(phoneRaw);
  if (!norm.ok) {
    return NextResponse.json({ error: norm.error }, { status: 400 });
  }
  if (!norm.digits) {
    return NextResponse.json({ error: "Número do profissional em falta" }, { status: 400 });
  }

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { data: hasAccess } = await authClient.rpc("rls_has_clinic_access", {
    p_clinic_id: clinicId,
  });
  if (!hasAccess) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const sent = await sendEvolutionClinicInstanceText(clinicId, norm.digits, text);
  if (!sent.ok) {
    const st = sent.status === 503 || sent.message.includes("não configurada") ? 503 : 502;
    return NextResponse.json({ error: sent.message }, { status: st });
  }

  return NextResponse.json({ ok: true });
}
