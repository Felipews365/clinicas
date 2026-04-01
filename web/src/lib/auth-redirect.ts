/**
 * Redirecionamentos internos após auth — apenas paths relativos permitidos
 * (evita open redirect).
 */

const OAUTH_ALLOWED_PREFIXES = [
  "/painel",
  "/admin",
  "/cadastro",
  "/login",
  "/redefinir-senha",
] as const;

function isSafeRelativePath(raw: string): boolean {
  if (!raw.startsWith("/") || raw.startsWith("//")) return false;
  if (raw.includes("..")) return false;
  return true;
}

/** `next` na página de login do cliente: apenas painel (open-redirect seguro). */
export function safePostLoginNext(raw: string | null): string {
  const fallback = "/painel";
  if (!raw) return fallback;
  if (!isSafeRelativePath(raw)) return fallback;
  if (raw === "/painel" || raw.startsWith("/painel/")) return raw;
  return fallback;
}

/** `next` no login de administrador: apenas rotas `/admin/*`. */
export function safeAdminPostLoginNext(raw: string | null): string {
  const fallback = "/admin/dashboard";
  if (!raw) return fallback;
  if (!isSafeRelativePath(raw)) return fallback;
  if (raw === "/admin" || raw.startsWith("/admin/")) return raw;
  return fallback;
}

/** `auth/callback?next=` após OAuth ou magic link. */
export function safeOAuthCallbackNext(raw: string | null): string {
  const fallback = "/painel";
  if (!raw) return fallback;
  if (!isSafeRelativePath(raw)) return fallback;
  for (const p of OAUTH_ALLOWED_PREFIXES) {
    if (raw === p || raw.startsWith(`${p}/`)) return raw;
  }
  return fallback;
}
