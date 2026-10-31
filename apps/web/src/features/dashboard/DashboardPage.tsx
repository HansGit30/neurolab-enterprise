import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bell, FolderPlus, Gauge } from "lucide-react";
import { Link } from "react-router-dom";
import { ActivityBars } from "../../components/charts";
import { useCrumbs } from "../../components/Layout";
import NeuralField from "../../components/NeuralField";
import { Alert, Empty, ErrorBox, Loading, Panel } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { JOB_STATUS } from "../../lib/format";
import type { Dashboard, JobStatus } from "../../types";
import JobsTable from "../training/JobsTable";

export default function DashboardPage() {
  useCrumbs([{ label: "Inicio" }]);
  const { me } = useAuth();
  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/dashboard"),
    refetchInterval: (query) => ((query.state.data?.active_jobs ?? 0) > 0 ? 4000 : 30000),
  });
  const d = q.data;
  const canCreate = me?.role === "admin" || me?.role === "project_owner";

  return (
    <>
      <div className="hero-strip">
        <NeuralField layers={[3, 6, 8, 8, 6, 4, 2]} density={0.7} />
        <div className="copy">
          <h1>Hola, {me?.display_name}.</h1>
          <p>
            {d && d.active_jobs > 0
              ? `Hay ${d.active_jobs} entrenamiento(s) en curso. Sus métricas llegan en vivo.`
              : "No hay entrenamientos en curso. Diseña una red o lanza un experimento nuevo."}
          </p>
          <div className="row wrap mt">
            {canCreate && (
              <Link to="/projects?new=1" className="btn primary"><FolderPlus />Nuevo proyecto</Link>
            )}
            <Link to="/fundamentals" className="btn">Repasar fundamentos</Link>
          </div>
        </div>
      </div>

      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {d && (
        <div className="stack" style={{ gap: 16 }}>
          <Panel>
            <div className="readouts">
              <div className="readout"><span className="value">{d.projects}</span><span className="label">Proyectos accesibles</span></div>
              <div className="readout"><span className={`value ${d.active_jobs ? "pulse" : ""}`}>{d.active_jobs}</span><span className="label">Entrenamientos activos</span></div>
              <div className="readout"><span className="value signal">{d.models}</span><span className="label">Versiones de modelo</span></div>
              <div className="readout"><span className="value">{d.approved_models}</span><span className="label">Modelos aprobados</span></div>
            </div>
          </Panel>

          <div className="grid split">
            <Panel title="Entrenamientos recientes" icon={<Activity />} actions={<Link to="/jobs" className="btn sm ghost">Ver todos</Link>}>
              {d.recent_jobs.length ? (
                <JobsTable jobs={d.recent_jobs} showProject compact />
              ) : (
                <Empty title="Todavía no hay entrenamientos">Crea un proyecto, registra un dataset demo y lanza tu primera red Feedforward.</Empty>
              )}
            </Panel>
            <div className="stack" style={{ gap: 16 }}>
              <Panel title="Actividad · últimos 14 días" icon={<Gauge />}>
                <ActivityBars data={d.daily_jobs} />
                <div className="row wrap mt-s">
                  {(Object.keys(JOB_STATUS) as JobStatus[]).map((s) => (
                    <span key={s} className="xs muted">
                      {JOB_STATUS[s].label}: <span className="num" style={{ color: "var(--ink)" }}>{d.jobs_by_status[s] ?? 0}</span>
                    </span>
                  ))}
                </div>
              </Panel>
              <Panel title="Alertas" icon={<Bell />}>
                {d.alerts.length ? (
                  <div className="stack tight">
                    {d.alerts.map((a, i) => (
                      <Alert key={i} tone={a.level === "error" ? "err" : "info"}>
                        {a.message}
                        {a.job_id && <> · <Link to={`/jobs/${a.job_id}`}>ver detalle</Link></>}
                      </Alert>
                    ))}
                  </div>
                ) : (
                  <p className="muted small"><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Sin alertas. Todo en orden.</p>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
