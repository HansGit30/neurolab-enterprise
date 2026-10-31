import { authHeaders } from "./supabase";

export const API_URL = ((import.meta.env.VITE_API_URL as string) || "http://localhost:8000").replace(/\/$/, "");
const BASE = `${API_URL}/api/v1`;

export class ApiError extends Error {
  status: number;
  details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Error ${res.status}`;
  let details: string[] = [];
  try {
    const body = await res.json();
    const d = body?.detail;
    if (typeof d === "string") message = d;
    else if (d?.message) {
      message = d.message;
      details = Array.isArray(d.errors) ? d.errors : [];
    }
  } catch {
    /* respuesta sin JSON */
  }
  if (res.status === 401) message = "Tu sesión expiró. Vuelve a iniciar sesión.";
  return new ApiError(res.status, message, details);
}

type Opts = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeaders()) };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: opts.method ?? "GET", headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "No se pudo contactar la API. Si está en Render free, puede tardar ~1 min en despertar.");
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Descarga autenticada (CSV, modelos .keras) sin exponer el token en la URL. */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export { BASE as API_BASE };
