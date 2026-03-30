/**
 * Redirecionamentos internos após auth — apenas paths relativos permitidos
 * (evita open redirect).
 */

const OAUTH_ALLOWED_PREFIXES = [
  "/painel",
  "/cadastro",
  "/redefinir-senha",
] as const;

/** `next` na página de login: só dashboard. */
export function safePostLoginNext(raw: string | null): string {
  const fallback = "/painel";
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("..")) return fallback;
  if (raw === "/painel" || raw.startsWith("/painel/")) return raw;
  return fallback;
}

/** `auth/callback?next=` após OAuth ou magic link. */
export function safeOAuthCallbackNext(raw: string | null): string {
  const fallback = "/painel";
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("..")) return fallback;
  for (const p of OAUTH_ALLOWED_PREFIXES) {
    if (raw === p || raw.startsWith(`${p}/`)) return raw;
  }
  return fallback;
}
