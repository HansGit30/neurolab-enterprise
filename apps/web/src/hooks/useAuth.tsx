import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AUTH_MODE, DEV_USER_KEY, supabase } from "../lib/supabase";
import type { Me } from "../types";

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<string>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    setError(null);
    const hasSession =
      AUTH_MODE === "dev" ? !!localStorage.getItem(DEV_USER_KEY) : !!(await supabase?.auth.getSession())?.data.session;
    if (!hasSession) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>("/me"));
    } catch (e) {
      setMe(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") refresh();
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  const signIn = async (email: string, password: string) => {
    if (AUTH_MODE === "dev") {
      localStorage.setItem(DEV_USER_KEY, email.trim().toLowerCase());
    } else {
      if (!supabase) throw new Error("Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos" : error.message);
    }
    await refresh();
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    if (!supabase) throw new Error("Supabase no está configurado");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName }, emailRedirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
    if (!data.session) return "Te enviamos un correo de confirmación. Ábrelo y luego inicia sesión.";
    await refresh();
    return "";
  };

  const signOut = async () => {
    if (AUTH_MODE === "dev") localStorage.removeItem(DEV_USER_KEY);
    else await supabase?.auth.signOut();
    qc.clear();
    setMe(null);
  };

  return <Ctx.Provider value={{ me, loading, error, signIn, signUp, signOut, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fuera de AuthProvider");
  return c;
}
