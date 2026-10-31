import { useQuery } from "@tanstack/react-query";
import { Download, FileText, History } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, ErrorBox, Loading, Panel } from "../../components/ui";
import { api, download } from "../../lib/api";
import { canExport, fmtDate } from "../../lib/format";
import type { AuditEvent, Project } from "../../types";

export const ACTION_LABEL: Record<string, string> = {
  "project.created": "Creó el proyecto",
  "project.updated": "Editó el proyecto",
  "project.member_set": "Asignó un rol",
  "project.member_removed": "Quitó un miembro",
  "architecture.created": "Guardó una arquitectura",
  "dataset.registered": "Registró un dataset demo",
  "dataset.uploaded": "Subió un dataset",
  "dataset.deleted": "Eliminó un dataset",
  "training.started": "Inició un entrenamiento",
  "training.cancel_requested": "Solicitó cancelar",
  "training.cancelled": "Entrenamiento cancelado",
  "training.completed": "Entrenamiento completado",
  "model.version_created": "Nueva versión de modelo",
  "model.status_changed": "Cambió estado de modelo",
  "model.downloaded": "Descargó un modelo",
  "export.jobs_csv": "Exportó historial CSV",
  "export.metrics_csv": "Exportó métricas CSV",
  "report.viewed": "Consultó el informe",
  "user.updated": "Actualizó un usuario",
  "settings.updated": "Cambió la configuración",
  "retention.executed": "Ejecutó la retención",
};

export default function HistoryTab({ project: p }: { project: Project }) {
  const auditAllowed = p.my_role === "owner" || p.my_role === "reviewer";
  const q = useQuery({ queryKey: ["audit", p.id], queryFn: () => api<AuditEvent[]>(`/projects/${p.id}/audit-events`), enabled: auditAllowed });
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Panel title="Reportes y exportación" icon={<FileText />}>
        <div className="row wrap">
          <Link className="btn" to={`/projects/${p.id}/report`}><FileText />Ficha e informe (PDF)</Link>
          {canExport(p.my_role) && (
            <button className="btn" onClick={() => download(`/projects/${p.id}/export/jobs.csv`, "historial.csv").catch(setErr)}><Download />Historial de entrenamientos CSV</button>
          )}
        </div>
        <ErrorBox error={err} />
      </Panel>
      <Panel title="Auditoría del proyecto" icon={<History />}>
        {!auditAllowed ? <Alert tone="info">La auditoría está disponible para responsables y revisores.</Alert> : q.isLoading ? <Loading /> : (
          <>
            <ErrorBox error={q.error} />
            <AuditTable events={q.data ?? []} />
          </>
        )}
      </Panel>
    </div>
  );
}

export function AuditTable({ events }: { events: AuditEvent[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Detalle</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="small muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(e.created_at)}</td>
              <td className="small">{e.actor_email ?? "sistema"}</td>
              <td className="small">{ACTION_LABEL[e.action] ?? e.action}</td>
              <td className="xs num muted" style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {Object.entries(e.metadata_json).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join("  ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
