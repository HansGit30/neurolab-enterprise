import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { ApiError } from "../lib/api";
import { JOB_STATUS, MODEL_STATUS } from "../lib/format";
import type { JobStatus, ModelStatus } from "../types";

export function Badge({ tone = "muted", children, live = false }: { tone?: string; children: ReactNode; live?: boolean }) {
  return (
    <span className={`badge ${tone} ${live ? "live" : ""}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function JobBadge({ status }: { status: JobStatus }) {
  const s = JOB_STATUS[status];
  return <Badge tone={s.tone} live={status === "RUNNING" || status === "PREPARING"}>{s.label}</Badge>;
}

export function ModelBadge({ status }: { status: ModelStatus }) {
  const s = MODEL_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function Progress({ value, status, big }: { value: number; status?: JobStatus; big?: boolean }) {
  const cls = status === "COMPLETED" ? "done" : status === "FAILED" ? "fail" : "";
  return (
    <div className={`progress ${cls} ${big ? "big" : ""}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as Error;
  const details = error instanceof ApiError ? error.details : [];
  return (
    <div className="alert err" role="alert">
      <XCircle />
      <div>
        {e.message}
        {details.length > 0 && (
          <ul>
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "ok" | "err"; children: ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" || tone === "err" ? AlertTriangle : Info;
  return (
    <div className={`alert ${tone}`}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Cerrar">
            <X />
          </button>
        </div>
        {subtitle && <p className="muted small mb">{subtitle}</p>}
        <div className="mt">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

export function Panel({ title, icon, actions, children, className = "" }: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h3>{icon}{title}</h3>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
