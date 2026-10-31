import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Download } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Empty, ErrorBox, Field, Loading, Modal, ModelBadge, Panel } from "../../components/ui";
import { api, download } from "../../lib/api";
import { FAMILY_LABEL, MODEL_STATUS, canExport, canManage, canReview, fmtDate, fmtNum } from "../../lib/format";
import type { ModelStatus, ModelVersion, Project } from "../../types";

const NEXT: Record<ModelStatus, ModelStatus[]> = { draft: ["reviewed", "retired"], reviewed: ["approved", "retired"], approved: ["retired"], retired: [] };
const ACTION: Record<string, string> = { reviewed: "Marcar revisado", approved: "Aprobar", retired: "Retirar" };

export default function ModelsTab({ project: p }: { project: Project }) {
  const q = useQuery({ queryKey: ["models", p.id], queryFn: () => api<ModelVersion[]>(`/projects/${p.id}/models`) });
  const [act, setAct] = useState<{ m: ModelVersion; to: ModelStatus } | null>(null);
  const [err, setErr] = useState<unknown>(null);

  if (q.isLoading) return <Loading />;
  if (!q.data?.length)
    return <div className="panel"><Empty icon={<Boxes />} title="Sin versiones de modelo">Cada entrenamiento completado guarda automáticamente una versión inmutable en estado borrador.</Empty></div>;

  const allowed = (to: ModelStatus) => (to === "retired" ? canManage(p.my_role) : canReview(p.my_role));
  return (
    <>
      <ErrorBox error={q.error ?? err} />
      <Panel title="Registro de modelos" icon={<Boxes />}>
        <p className="small muted mb">Las versiones no se sobrescriben. Ciclo: borrador → revisado → aprobado → retirado. Quien entrenó un modelo no puede aprobarlo.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Versión</th><th>Estado</th><th>Arquitectura</th><th>Dataset</th><th>Métricas de prueba</th><th>Checksum</th><th>Fecha</th><th></th></tr></thead>
            <tbody>
              {q.data.map((m) => (
                <tr key={m.id}>
                  <td className="num"><strong>v{m.version}</strong></td>
                  <td><ModelBadge status={m.status} /></td>
                  <td>{m.architecture_name}<div className="xs muted">{m.architecture_family && FAMILY_LABEL[m.architecture_family]}</div></td>
                  <td className="small">{m.dataset_name}</td>
                  <td className="small num">{Object.entries(m.metrics_json).map(([k, v]) => `${k} ${fmtNum(v, 3)}`).join(" · ")}</td>
                  <td className="xs num muted" title={m.checksum}>{m.checksum.slice(0, 12)}…</td>
                  <td className="small muted">{fmtDate(m.created_at)}<div><Link to={`/jobs/${m.job_id}`} className="xs">ver entrenamiento</Link></div></td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                      {NEXT[m.status].filter(allowed).map((to) => (
                        <button key={to} className={`btn sm ${to === "retired" ? "ghost" : ""}`} onClick={() => setAct({ m, to })}>{ACTION[to]}</button>
                      ))}
                      {canExport(p.my_role) && m.status !== "retired" && (
                        <button className="btn sm ghost icon" aria-label={`Descargar v${m.version}`} title="Descargar .keras"
                          onClick={() => download(`/models/${m.id}/download`, `modelo_v${m.version}.keras`).catch(setErr)}><Download /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {act && <StatusModal projectId={p.id} m={act.m} to={act.to} onClose={() => setAct(null)} />}
    </>
  );
}

function StatusModal({ projectId, m, to, onClose }: { projectId: string; m: ModelVersion; to: ModelStatus; onClose: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const mut = useMutation({
    mutationFn: () => api(`/models/${m.id}/status`, { method: "POST", body: { status: to, notes } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["models", projectId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });
  return (
    <Modal title={`${ACTION[to]} v${m.version}`} subtitle={`${MODEL_STATUS[m.status].label} → ${MODEL_STATUS[to].label}. El cambio queda en la auditoría.`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
        <Field label="Observaciones" hint="Limitaciones detectadas, condiciones de uso, motivo del retiro…">
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorBox error={mut.error} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={mut.isPending}>{ACTION[to]}</button>
        </div>
      </form>
    </Modal>
  );
}
