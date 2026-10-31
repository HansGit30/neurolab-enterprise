import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const AUTH_MODE: "supabase" | "dev" = (import.meta.env.VITE_AUTH_MODE as "supabase" | "dev") || "supabase";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  AUTH_MODE === "supabase" && url && anon
    ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;

export const DEV_USER_KEY = "neurolab.devUser";

export async function authHeaders(): Promise<Record<string, string>> {
  if (AUTH_MODE === "dev") {
    const email = localStorage.getItem(DEV_USER_KEY);
    return email ? { "X-Dev-User": email } : {};
  }
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
