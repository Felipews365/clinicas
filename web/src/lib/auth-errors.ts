/** Mensagens de erro de auth mais claras para o utilizador. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("unsupported provider") || m.includes("provider is not enabled")) {
    return (
      "O login com Google não está ativo neste projeto Supabase. No dashboard: Authentication → " +
      "Providers → ative Google e preencha Client ID e Client Secret (Google Cloud Console). " +
      "Em URL Configuration, inclua os URLs de redirect (ex.: …/auth/callback, …/login, …/login/admin)."
    );
  }
  if (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("network request failed")
  ) {
    return (
      "Não foi possível contactar o Supabase (rede). Confirme: (1) ficheiro web/.env.local com " +
      "NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY; " +
      "(2) reinicie o servidor após gravar o .env; " +
      "(3) projeto ativo no dashboard Supabase; (4) desative extensões que bloqueiem pedidos."
    );
  }
  return message;
}
