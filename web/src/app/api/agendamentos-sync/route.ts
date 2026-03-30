import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

/**
 * Chamado pelo n8n após INSERT/UPDATE em agendamentos (ou sessões WhatsApp).
 * Protegido por segredo partilhado — nunca expor no browser.
 */
export async function POST(request: Request) {
  const secret = process.env.AGENDAMENTOS_SYNC_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "AGENDAMENTOS_SYNC_SECRET não definido em .env.local" },
      { status: 503 }
    );
  }

  const auth = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-agendamentos-sync-secret");
  const token =
    auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token !== secret && headerSecret !== secret) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

    revalidatePath("/painel", "layout");

  return NextResponse.json({
    ok: true,
    revalidated: true,
    at: new Date().toISOString(),
  });
}
