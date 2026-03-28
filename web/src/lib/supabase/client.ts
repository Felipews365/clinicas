import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/supabase/env";

export function createClient(): SupabaseClient | null {
  const { url, key } = getPublicSupabaseConfig();
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
