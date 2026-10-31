import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useCrumbs } from "../../components/Layout";
import { Alert, Badge, ErrorBox, Field, Loading, Panel } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { GLOBAL_ROLE, fmtDate } from "../../lib/format";
import type { AdminUser, AuditEvent, GlobalRole } from "../../types";
import { AuditTable } from "../reports/HistoryTab";

type Settings = Record<string, Record<string, number | boolean | string>>;

const SETTING_LABEL: Record<string, string> = {
  max_epochs: "Épocas máximas por trabajo",
  max_batch_size: "Batch size máximo",
  max_concurrent_jobs_per_user: "Trabajos activos por usuario",
  max_upload_mb: "Tamaño máximo de CSV (MB)",
  job_timeout_seconds: "Duración máxima de un trabajo (s)",
  max_layers: "Capas máximas por arquitectura",
  max_units: "Unidades/neuronas máximas por capa",
  gan_training_enabled: "Habilitar entrenamiento GAN",
  rnn_training_enabled: "Habilitar entrenamiento RNN",
  cnn_training_enabled: "Habilitar entrenamiento CNN",
  audit_days: "Días de retención de auditoría",
  logs_days: "Días de retención de logs",
  default_role: "Rol asignado a nuevas cuentas",
};
const GROUP_LABEL: Record<string, string> = { limits: "Límites de recursos", features: "Familias habilitadas", retention: "Retención", signup: "Registro" };

export default function AdminPage() {
  useCrumbs([{ label: "Administración" }]);
  const { me } = useAuth();
  const [tab, setTab] = useState<"users" | "settings" | "audit" | "health">("users");
  if (me?.role !== "admin") return <Navigate to="/" replace />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Administración y seguridad</h1>
          <p>Usuarios y roles, límites de recursos, auditoría global y salud del sistema.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {([["users", "Usuarios y roles"], ["settings", "Configuración"], ["audit", "Auditoría"], ["health", "Salud del sistema"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "users" && <Users meId={me.id} />}
      {tab === "settings" && <SettingsPanel />}
      {tab === "audit" && <GlobalAudit />}
      {tab === "health" && <Health />}
    </>
  );
}

function Users({ meId }: { meId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-users"], queryFn: () => api<AdminUser[]>("/admin/users") });
  const m = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<AdminUser> }) => api(`/admin/users/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  if (q.isLoading) return <Loading />;
  return (
    <Panel title="Usuarios">
      <ErrorBox error={q.error ?? m.error} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Usuario</th><th>Rol global</th><th>Estado</th><th>Alta</th></tr></thead>
          <tbody>
            {q.data?.map((u) => (
              <tr key={u.id}>
                <td>{u.display_name}<div className="xs muted">{u.email}</div></td>
                <td>
                  <select className="input" style={{ height: 32, width: 220 }} value={u.role} disabled={u.id === meId}
                    onChange={(e) => m.mutate({ id: u.id, body: { role: e.target.value as GlobalRole } })} aria-label={`Rol de ${u.email}`}>
                    {(Object.keys(GLOBAL_ROLE) as GlobalRole[]).map((r) => <option key={r} value={r}>{GLOBAL_ROLE[r]}</option>)}
                  </select>
                </td>
                <td>
                  <button className="btn sm" disabled={u.id === meId}
                    onClick={() => m.mutate({ id: u.id, body: { status: u.status === "active" ? "disabled" : "active" } })}>
                    {u.status === "active" ? <Badge tone="ok">Activo</Badge> : <Badge tone="err">Deshabilitado</Badge>}
                  </button>
                </td>
                <td className="small muted">{fmtDate(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="xs faint mt">Administrador: todo. Responsable: crea proyectos. Ingeniero: configura y entrena. Revisor: compara y aprueba. Lector: solo lectura. Los permisos dentro de cada proyecto se asignan en su pestaña Contexto.</p>
    </Panel>
  );
}

function SettingsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-settings"], queryFn: () => api<Settings>("/admin/settings") });
  const [draft, setDraft] = useState<Settings | null>(null);
  useEffect(() => { if (q.data) setDraft(structuredClone(q.data)); }, [q.data]);
  const save = useMutation({
    mutationFn: async (key: string) => api(`/admin/settings/${key}`, { method: "PUT", body: { value: draft![key] } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["families"] });
    },
  });
  const retention = useMutation({ mutationFn: () => api<{ audit_deleted: number; logs_deleted: number }>("/admin/retention/run", { method: "POST" }) });
  if (q.isLoading || !draft) return <Loading />;
  return (
    <div className="grid g2">
      {Object.entries(draft).map(([group, values]) => (
        <Panel key={group} title={GROUP_LABEL[group] ?? group}>
          <div className="stack">
            {Object.entries(values).map(([k, v]) => (
              typeof v === "boolean" ? (
                <label key={k} className="check"><input type="checkbox" checked={v} onChange={(e) => setDraft({ ...draft, [group]: { ...values, [k]: e.target.checked } })} />{SETTING_LABEL[k] ?? k}</label>
              ) : k === "default_role" ? (
                <Field key={k} label={SETTING_LABEL[k]}>
                  <select className="input" value={String(v)} onChange={(e) => setDraft({ ...draft, [group]: { ...values, [k]: e.target.value } })}>
                    {(["project_owner", "engineer", "reviewer", "reader"] as GlobalRole[]).map((r) => <option key={r} value={r}>{GLOBAL_ROLE[r]}</option>)}
                  </select>
                </Field>
              ) : (
                <Field key={k} label={SETTING_LABEL[k] ?? k}>
                  <input className="input num" type="number" min={1} value={Number(v)} onChange={(e) => setDraft({ ...draft, [group]: { ...values, [k]: parseInt(e.target.value, 10) || 1 } })} />
                </Field>
              )
            ))}
            <div className="row">
              <button className="btn primary sm" onClick={() => save.mutate(group)} disabled={save.isPending}>Guardar</button>
              {group === "retention" && <button className="btn sm" onClick={() => retention.mutate()}>Aplicar retención ahora</button>}
            </div>
            {group === "retention" && retention.data && <Alert tone="ok">Eliminados: {retention.data.audit_deleted} eventos de auditoría y {retention.data.logs_deleted} logs.</Alert>}
          </div>
        </Panel>
      ))}
      <ErrorBox error={save.error ?? retention.error} />
      {save.isSuccess && <Alert tone="ok">Configuración guardada y auditada.</Alert>}
    </div>
  );
}

function GlobalAudit() {
  const [action, setAction] = useState("");
  const q = useQuery({ queryKey: ["admin-audit", action], queryFn: () => api<AuditEvent[]>(`/admin/audit-events${action ? `?action=${action}` : ""}`) });
  return (
    <Panel title="Auditoría global" actions={
      <select className="input" style={{ width: 220, height: 32 }} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filtrar acciones">
        <option value="">Todas las acciones</option>
        <option value="training">Entrenamientos</option>
        <option value="model">Modelos</option>
        <option value="project">Proyectos y permisos</option>
        <option value="export">Exportaciones</option>
        <option value="user">Usuarios</option>
        <option value="settings">Configuración</option>
      </select>}>
      {q.isLoading ? <Loading /> : <><ErrorBox error={q.error} /><AuditTable events={q.data ?? []} /></>}
    </Panel>
  );
}

function Health() {
  const q = useQuery({ queryKey: ["admin-health"], queryFn: () => api<any>("/admin/health"), refetchInterval: 10000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const h = q.data;
  const ok = (b: boolean) => <Badge tone={b ? "ok" : "err"}>{b ? "Operativo" : "Con problemas"}</Badge>;
  return (
    <div className="grid g2">
      <Panel title="API" actions={ok(h.api.ok)}><dl className="kv"><dt>Versión</dt><dd className="num">{h.api.version}</dd><dt>Entorno</dt><dd>{h.api.environment}</dd></dl></Panel>
      <Panel title="Base de datos" actions={ok(h.database.ok)}><dl className="kv"><dt>Motor</dt><dd>{h.database.dialect}</dd><dt>Latencia</dt><dd className="num">{h.database.latency_ms} ms</dd><dt>Usuarios</dt><dd className="num">{h.counts.users}</dd><dt>Filas de métricas</dt><dd className="num">{h.counts.metrics_rows}</dd></dl></Panel>
      <Panel title="Almacenamiento de objetos" actions={ok(h.storage.ok)}><dl className="kv"><dt>Backend</dt><dd>{h.storage.backend === "supabase" ? "Supabase Storage" : "Disco local (desarrollo)"}</dd></dl></Panel>
      <Panel title="Worker de entrenamiento" actions={<Badge tone="signal">{h.worker.mode === "embedded" ? "Embebido" : "Externo"}</Badge>}>
        <dl className="kv"><dt>ID</dt><dd className="num">{h.worker.id}</dd><dt>En cola</dt><dd className="num">{h.worker.queued}</dd><dt>Ejecutando</dt><dd className="num">{h.worker.running}</dd><dt>Último latido</dt><dd>{fmtDate(h.worker.last_heartbeat)}</dd></dl>
      </Panel>
    </div>
  );
}
