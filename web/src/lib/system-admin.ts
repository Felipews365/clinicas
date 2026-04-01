import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function normalizeList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** E-mails (minúsculos) autorizados como system admin. */
export function isSystemAdminUser(user: User | null): boolean {
  if (!user) return false;
  const emails = normalizeList(process.env.SYSTEM_ADMIN_EMAILS).map((e) =>
    e.toLowerCase()
  );
  const uids = normalizeList(process.env.SYSTEM_ADMIN_USER_IDS);
  const email = user.email?.toLowerCase();
  if (email && emails.includes(email)) return true;
  if (uids.includes(user.id)) return true;
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  if (meta?.is_system_admin === true) return true;
  return false;
}

/** Server Components: sessão atual ou null. */
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Para Route Handlers: devolve `{ user }` ou resposta 401/403.
 */
export async function requireSystemAdmin(): Promise<
  { user: User; supabase: Awaited<ReturnType<typeof createClient>> } | NextResponse
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!isSystemAdminUser(user)) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Acesso reservado a administrador da plataforma." },
      { status: 403 }
    );
  }
  return { user, supabase };
}
