import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/env";

/**
 * Cliente com service_role: só em Route Handlers após validar system admin.
 * Nunca exponha SUPABASE_SERVICE_ROLE_KEY ao browser.
 */
export function createServiceRoleClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL em falta em .env.local");
  }
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY em falta no web/.env.local. No Supabase: Project Settings → API → " +
        "seção Project API keys → copie a secret «service_role» (não é a anon). Reinicie o npm run dev. " +
        "Nunca use NEXT_PUBLIC_ nesta chave nem commite no Git."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
