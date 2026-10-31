import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useParams } from "react-router-dom";
import { useCrumbs } from "../../components/Layout";
import { ErrorBox, JobBadge, Loading, ModelBadge, Panel } from "../../components/ui";
import { api } from "../../lib/api";
import { FAMILY_LABEL, TASK_LABEL, fmtDate, fmtDuration, fmtInt, fmtNum } from "../../lib/format";
import type { Family, ModelStatus, TrainingJob } from "../../types";
import { headlineMetric } from "../training/JobsTable";

interface Report {
  project: { id: string; name: string; description: string; problem_statement: string; status: string; tags: string[]; owner: string; created_at: string };
  architectures: { name: string; version: number; family: Family; justification: string; total_params: number; layers: { type: string; output_shape: number[]; params: number }[]; input_shape: number[] }[];
  datasets: { name: string; version: number; task: string; n_samples: number; deleted: boolean }[];
  jobs: TrainingJob[];
  models: { version: number; status: ModelStatus; checksum: string; metrics: Record<string, number>; created_at: string }[];
  generated_at: string;
  generated_by: string;
}

export default function ReportPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["report", id], queryFn: () => api<Report>(`/projects/${id}/report`) });
  useCrumbs([{ label: "Proyectos", to: "/projects" }, { label: q.data?.project.name ?? "…", to: `/projects/${id}` }, { label: "Informe" }]);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const r = q.data;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Informe · {r.project.name}</h1>
          <p>Generado {fmtDate(r.generated_at)} por {r.generated_by}. Responsable: {r.project.owner}.</p>
        </div>
        <button className="btn primary no-print" onClick={() => window.print()}><Printer />Exportar PDF</button>
      </div>

      <Panel title="Ficha del proyecto">
        <dl className="kv">
          <dt>Descripción</dt><dd>{r.project.description || "—"}</dd>
          <dt>Problema</dt><dd>{r.project.problem_statement || "—"}</dd>
          <dt>Estado</dt><dd>{r.project.status}</dd>
          <dt>Etiquetas</dt><dd>{r.project.tags.join(", ") || "—"}</dd>
          <dt>Creado</dt><dd>{fmtDate(r.project.created_at)}</dd>
        </dl>
      </Panel>

      <Panel title="Resumen de arquitecturas">
        {r.architectures.map((a) => (
          <div key={`${a.name}-${a.version}`} className="inset mb">
            <div className="row between"><strong>{a.name} v{a.version}</strong><span className="small muted">{FAMILY_LABEL[a.family]} · {fmtInt(a.total_params)} parámetros · entrada ({a.input_shape.join("×")})</span></div>
            <table className="table mt-s">
              <thead><tr><th>Capa</th><th>Salida</th><th className="r">Parámetros</th></tr></thead>
              <tbody>{a.layers.map((l, i) => <tr key={i}><td className="small">{l.type}</td><td className="num small">({l.output_shape.join("×")})</td><td className="r num small">{fmtInt(l.params)}</td></tr>)}</tbody>
            </table>
            {a.justification && <p className="small mt-s"><span className="muted">Justificación:</span> {a.justification}</p>}
          </div>
        ))}
        {!r.architectures.length && <p className="muted small">Sin arquitecturas.</p>}
      </Panel>

      <Panel title="Datasets">
        <table className="table">
          <thead><tr><th>Nombre</th><th>Tarea</th><th className="r">Muestras</th><th>Estado</th></tr></thead>
          <tbody>{r.datasets.map((d) => <tr key={`${d.name}-${d.version}`}><td>{d.name} v{d.version}</td><td className="small">{TASK_LABEL[d.task]}</td><td className="r num">{fmtInt(d.n_samples)}</td><td className="small">{d.deleted ? "Eliminado" : "Disponible"}</td></tr>)}</tbody>
        </table>
      </Panel>

      <Panel title="Historial de entrenamiento">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Estado</th><th>Arquitectura</th><th>Parámetros</th><th>Resultado</th><th>Duración</th></tr></thead>
            <tbody>
              {r.jobs.map((j) => (
                <tr key={j.id}>
                  <td className="small">{fmtDate(j.created_at)}</td>
                  <td><JobBadge status={j.status} /></td>
                  <td className="small">{j.architecture_name}</td>
                  <td className="small num">{j.params_json.epochs} ép · bs {j.params_json.batch_size} · {j.params_json.optimizer} · lr {j.params_json.learning_rate} · semilla {j.params_json.seed}</td>
                  <td className="small">{j.status === "FAILED" ? j.error_message : headlineMetric(j)}</td>
                  <td className="small num">{fmtDuration(j.started_at, j.ended_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Versiones de modelo">
        <table className="table">
          <thead><tr><th>Versión</th><th>Estado</th><th>Métricas</th><th>SHA-256</th><th>Fecha</th></tr></thead>
          <tbody>{r.models.map((m) => (
            <tr key={m.version}><td className="num">v{m.version}</td><td><ModelBadge status={m.status} /></td>
              <td className="small num">{Object.entries(m.metrics).map(([k, v]) => `${k} ${fmtNum(v, 4)}`).join(" · ")}</td>
              <td className="xs num" style={{ wordBreak: "break-all" }}>{m.checksum}</td><td className="small">{fmtDate(m.created_at)}</td></tr>
          ))}</tbody>
        </table>
      </Panel>
      <p className="xs faint">NeuroLab Enterprise · Semana 11 · Machine Learning y Deep Learning. Las métricas se calcularon sobre conjuntos de prueba separados con semilla registrada.</p>
    </div>
  );
}
