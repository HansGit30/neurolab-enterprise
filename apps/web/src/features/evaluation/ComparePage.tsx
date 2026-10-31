import { useQueries, useQuery } from "@tanstack/react-query";
import { GitCompare } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CompareChart } from "../../components/charts";
import { useCrumbs } from "../../components/Layout";
import { Empty, ErrorBox, Field, JobBadge, Loading, Panel } from "../../components/ui";
import { api } from "../../lib/api";
import { METRIC_LABEL, fmtDate, fmtDuration, fmtNum } from "../../lib/format";
import type { Metric, TrainingJob } from "../../types";
import { useProject } from "../projects/ProjectDetailPage";

export default function ComparePage() {
  const { id } = useParams();
  const project = useProject(id);
  useCrumbs([{ label: "Proyectos", to: "/projects" }, { label: project.data?.name ?? "…", to: `/projects/${id}?tab=training` }, { label: "Comparar ejecuciones" }]);
  const jobs = useQuery({ queryKey: ["jobs", id], queryFn: () => api<TrainingJob[]>(`/training-jobs?project_id=${id}&limit=200`) });
  const done = jobs.data?.filter((j) => j.status === "COMPLETED") ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const sel = picked.length ? picked : done.slice(0, 3).map((j) => j.id);
  const [metric, setMetric] = useState("val_loss");

  const metricsQ = useQueries({
    queries: sel.map((jid) => ({ queryKey: ["metrics", jid], queryFn: () => api<Metric[]>(`/training-jobs/${jid}/metrics`), staleTime: 60_000 })),
  });
  const available = useMemo(() => {
    const s = new Set<string>();
    metricsQ.forEach((q) => q.data?.forEach((m) => s.add(m.metric_name)));
    return [...s];
  }, [metricsQ]);
  const series = sel.map((jid, i) => {
    const j = done.find((x) => x.id === jid);
    return {
      name: `${j?.architecture_name ?? jid.slice(0, 6)} · ${jid.slice(0, 4)}`,
      points: (metricsQ[i]?.data ?? []).filter((m) => m.metric_name === metric).map((m) => ({ epoch: m.epoch, value: m.metric_value })),
    };
  });

  const toggle = (jid: string) => {
    const base = picked.length ? picked : sel;
    setPicked(base.includes(jid) ? base.filter((x) => x !== jid) : [...base, jid].slice(-6));
  };

  if (jobs.isLoading) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Comparar ejecuciones</h1>
          <p>Superpone las curvas de varios entrenamientos completados para elegir la mejor configuración (hasta 6).</p>
        </div>
      </div>
      <ErrorBox error={jobs.error} />
      {done.length < 1 ? (
        <div className="panel"><Empty icon={<GitCompare />} title="Necesitas entrenamientos completados">Cuando termine al menos uno podrás comparar sus curvas aquí.</Empty></div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <Panel title="Curvas" actions={
            <Field label="">
              <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Métrica">
                {(available.length ? available : ["val_loss"]).map((m) => <option key={m} value={m}>{METRIC_LABEL[m] ?? m}</option>)}
              </select>
            </Field>}>
            <CompareChart series={series} />
          </Panel>
          <Panel title="Ejecuciones completadas">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th></th><th>Arquitectura</th><th>Dataset</th><th>Optimizador</th><th className="r">lr</th><th className="r">Épocas</th><th className="r">Pérdida test</th><th className="r">Exactitud / MAE</th><th>Duración</th><th>Fecha</th></tr></thead>
                <tbody>
                  {done.map((j) => {
                    const t = (j.result_json.test ?? {}) as Record<string, number>;
                    return (
                      <tr key={j.id}>
                        <td><input type="checkbox" checked={sel.includes(j.id)} onChange={() => toggle(j.id)} aria-label="Incluir en la comparación" /></td>
                        <td>{j.architecture_name} <JobBadge status={j.status} /></td>
                        <td className="small">{j.dataset_name}</td>
                        <td className="small">{j.params_json.optimizer}</td>
                        <td className="r num">{j.params_json.learning_rate}</td>
                        <td className="r num">{j.current_epoch}</td>
                        <td className="r num">{fmtNum(t.loss, 4)}</td>
                        <td className="r num">{t.accuracy !== undefined ? `${(t.accuracy * 100).toFixed(1)} %` : fmtNum(t.mae, 4)}</td>
                        <td className="small num">{fmtDuration(j.started_at, j.ended_at)}</td>
                        <td className="small muted">{fmtDate(j.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
