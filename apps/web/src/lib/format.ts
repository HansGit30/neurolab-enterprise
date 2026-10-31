import type { JobStatus, ModelStatus, ProjectRole, GlobalRole, Family } from "../types";

export const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" }) : "—";

export const fmtShortDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }) : "—";

export const fmtNum = (n?: number | null, d = 4) => {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const v = Number(n);
  // valores muy pequeños (p. ej. pérdida 0.00003) no deben mostrarse como "0"
  if (v !== 0 && Math.abs(v) < 10 ** -d) return v.toExponential(1);
  return v.toLocaleString("es-PE", { maximumFractionDigits: d });
};

export const fmtInt = (n?: number | null) => (n === undefined || n === null ? "—" : n.toLocaleString("es-PE"));

export function fmtDuration(a?: string | null, b?: string | null) {
  if (!a) return "—";
  const ms = (b ? new Date(b) : new Date()).getTime() - new Date(a).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const JOB_STATUS: Record<JobStatus, { label: string; tone: string }> = {
  QUEUED: { label: "En cola", tone: "muted" },
  PREPARING: { label: "Preparando", tone: "pulse" },
  RUNNING: { label: "Ejecutando", tone: "signal" },
  COMPLETED: { label: "Completado", tone: "ok" },
  FAILED: { label: "Fallido", tone: "err" },
  CANCELLED: { label: "Cancelado", tone: "muted" },
};

export const MODEL_STATUS: Record<ModelStatus, { label: string; tone: string }> = {
  draft: { label: "Borrador", tone: "muted" },
  reviewed: { label: "Revisado", tone: "pulse" },
  approved: { label: "Aprobado", tone: "ok" },
  retired: { label: "Retirado", tone: "err" },
};

export const PROJECT_ROLE: Record<ProjectRole, string> = {
  owner: "Responsable",
  engineer: "Ingeniero/a de IA",
  reviewer: "Revisor/a",
  reader: "Lector/a",
};

export const GLOBAL_ROLE: Record<GlobalRole, string> = {
  admin: "Administrador/a",
  project_owner: "Responsable de proyecto",
  engineer: "Ingeniero/a de IA",
  reviewer: "Revisor/a",
  reader: "Lector/a",
};

export const FAMILY_LABEL: Record<Family, string> = {
  feedforward: "Feedforward",
  rnn: "Recurrente",
  cnn: "Convolucional",
  gan: "GAN",
};

export const TASK_LABEL: Record<string, string> = {
  binary: "Clasificación binaria",
  multiclass: "Clasificación multiclase",
  regression: "Regresión",
  generative: "Generativa",
};

export const METRIC_LABEL: Record<string, string> = {
  loss: "Pérdida (entrenamiento)",
  val_loss: "Pérdida (validación)",
  accuracy: "Exactitud (entrenamiento)",
  val_accuracy: "Exactitud (validación)",
  mae: "MAE (entrenamiento)",
  val_mae: "MAE (validación)",
  d_loss: "Pérdida discriminador",
  g_loss: "Pérdida generador",
  learning_rate: "Tasa de aprendizaje",
};

export const canEdit = (r?: ProjectRole | null) => r === "owner" || r === "engineer";
export const canManage = (r?: ProjectRole | null) => r === "owner";
export const canReview = (r?: ProjectRole | null) => r === "owner" || r === "reviewer";
export const canExport = (r?: ProjectRole | null) => r === "owner" || r === "engineer" || r === "reviewer";
