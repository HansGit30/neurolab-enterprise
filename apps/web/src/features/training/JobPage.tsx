import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Download, RotateCcw, Square, Terminal } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MetricChart, PointsScatter } from "../../components/charts";
import NetworkLive from "../../components/NetworkLive";
import { useCrumbs } from "../../components/Layout";
import { Alert, Badge, ErrorBox, JobBadge, Loading, Panel, Progress } from "../../components/ui";
import { useJobStream } from "../../hooks/useJobStream";
import { api, download } from "../../lib/api";
import { FAMILY_LABEL, fmtDate, fmtDuration, fmtNum } from "../../lib/format";
import type { Project, TrainingJob } from "../../types";

export default function JobPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api<TrainingJob>(`/training-jobs/${id}`) });
  const project = useQuery({
    queryKey: ["project", job.data?.project_id],
    queryFn: () => api<Project>(`/projects/${job.data!.project_id}`),
    enabled: !!job.data,
  });
  const { snapshot, metrics, logs, state, netEpoch } = useJobStream(id, job.data);
  useCrumbs([{ label: "Proyectos", to: "/projects" }, { label: job.data?.project_name ?? "…", to: `/projects/${job.data?.project_id}?tab=training` },
    { label: `Entrenamiento ${id?.slice(0, 8)}` }]);

  const cancel = useMutation({
    mutationFn: () => api(`/training-jobs/${id}/cancel`, { method: "POST", body: { reason: "Cancelado desde la interfaz" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job", id] }),
  });
  const retry = useMutation({
    mutationFn: () => api<TrainingJob>(`/training-jobs/${id}/retry`, { method: "POST" }),
    onSuccess: (j) => nav(`/jobs/${j.id}`),
  });

  const consoleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = consoleRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  if (job.isLoading) return <Loading />;
  if (job.error || !job.data) return <ErrorBox error={job.error} />;
  const j = job.data;
  const s = snapshot ?? { status: j.status, progress: j.progress, current_epoch: j.current_epoch, total_epochs: j.total_epochs, error_message: j.error_message, cancel_requested: j.cancel_requested, result: j.result_json };
  const result = (s.result ?? j.result_json ?? {}) as Record<string, any>;
  const active = ["QUEUED", "PREPARING", "RUNNING"].includes(s.status);
  const role = project.data?.my_role;
  const canAct = role === "owner" || role === "engineer";
  const names = new Set(metrics.map((m) => m.metric_name));
  const last = (n: string) => [...metrics].reverse().find((m) => m.metric_name === n)?.metric_value;
  const isGan = j.architecture_family === "gan";

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row wrap" style={{ gap: 10 }}>
            <h1>{j.architecture_name}</h1>
            <JobBadge status={s.status} />
            <Badge tone={state === "live" ? "signal" : state === "reconnecting" ? "pulse" : "muted"} live={state === "live"}>
              {state === "live" ? "En vivo" : state === "reconnecting" ? "Reconectando…" : state === "connecting" ? "Conectando…" : "Canal cerrado"}
            </Badge>
          </div>
          <p>{j.dataset_name} · {j.architecture_family && FAMILY_LABEL[j.architecture_family]} · creado {fmtDate(j.created_at)}</p>
        </div>
        <div className="row wrap">
          {active && canAct && (
            <button className="btn danger" disabled={s.cancel_requested || cancel.isPending} onClick={() => cancel.mutate()}>
              <Square />{s.cancel_requested ? "Cancelación solicitada" : "Cancelar"}
            </button>
          )}
          {["FAILED", "CANCELLED"].includes(s.status) && canAct && (
            <button className="btn" onClick={() => retry.mutate()} disabled={retry.isPending}><RotateCcw />Reintentar</button>
          )}
          {role && role !== "reader" && (
            <button className="btn" onClick={() => download(`/training-jobs/${id}/export/metrics.csv`, "metricas.csv")}><Download />Métricas CSV</button>
          )}
        </div>
      </div>
      <ErrorBox error={cancel.error ?? retry.error} />

      <Panel>
        <div className="row between mb">
          <span className="small muted">Época <span className="num" style={{ color: "var(--ink)" }}>{s.current_epoch}</span> de <span className="num">{s.total_epochs}</span></span>
          <span className="num small">{s.progress.toFixed(0)} %</span>
        </div>
        <Progress value={s.progress} status={s.status} big />
        <div className="readouts mt">
          {isGan ? (
            <>
              <div className="readout"><span className="value num">{fmtNum(last("d_loss"), 3)}</span><span className="label">Pérdida discriminador</span></div>
              <div className="readout"><span className="value num">{fmtNum(last("g_loss"), 3)}</span><span className="label">Pérdida generador</span></div>
            </>
          ) : (
            <>
              <div className="readout"><span className="value num">{fmtNum(last("loss"), 4)}</span><span className="label">Pérdida (entrenamiento)</span></div>
              <div className="readout"><span className="value num">{fmtNum(last("val_loss"), 4)}</span><span className="label">Pérdida (validación)</span></div>
            </>
          )}
          {names.has("val_accuracy") ? (
            <div className="readout"><span className="value signal num">{fmtNum((last("val_accuracy") ?? 0) * 100, 1)} %</span><span className="label">Exactitud (validación)</span></div>
          ) : names.has("val_mae") ? (
            <div className="readout"><span className="value signal num">{fmtNum(last("val_mae"), 4)}</span><span className="label">MAE (validación)</span></div>
          ) : <div className="readout"><span className="value">—</span><span className="label">Métrica principal</span></div>}
          <div className="readout"><span className="value num" style={{ fontSize: 22 }}>{fmtDuration(j.started_at, active ? null : j.ended_at)}</span><span className="label">Duración</span></div>
        </div>
      </Panel>

      {s.status === "FAILED" && <div className="mt"><Alert tone="err"><strong>El entrenamiento falló.</strong> {s.error_message} Los detalles técnicos están en la consola (visibles para responsables e ingenieros).</Alert></div>}
      {s.status === "CANCELLED" && <div className="mt"><Alert tone="warn">Trabajo cancelado. {j.cancel_reason}</Alert></div>}
      {s.status === "QUEUED" && <div className="mt"><Alert tone="info">En cola. Si el worker estaba dormido (planes gratuitos) puede tardar 1–2 minutos en despertar y tomar el trabajo.</Alert></div>}

      <div className="mt">
        <Panel title="Red neuronal en vivo" icon={<BrainCircuit />}>
          <p className="small muted mb">
            Pesos y activaciones reales leídos del modelo de TensorFlow en cada época. Cada columna es una capa; cada círculo, una neurona con su
            activación para la muestra elegida. Las líneas son los pesos que la red está aprendiendo.
          </p>
          <NetworkLive jobId={j.id} liveEpoch={netEpoch} running={active} />
        </Panel>
      </div>

      <div className="grid split mt">
        <div className="stack" style={{ gap: 16 }}>
          <Panel title="Pérdida por época">
            <MetricChart metrics={metrics} names={isGan ? ["d_loss", "g_loss"] : ["loss", "val_loss"]} />
          </Panel>
          {!isGan && (names.has("accuracy") || names.has("mae")) && (
            <Panel title={names.has("accuracy") ? "Exactitud por época" : "Error absoluto medio por época"}>
              <MetricChart metrics={metrics} names={names.has("accuracy") ? ["accuracy", "val_accuracy"] : ["mae", "val_mae"]} height={220} />
            </Panel>
          )}
          {s.status === "COMPLETED" && <Evaluation result={result} isGan={isGan} />}
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <Panel title="Consola del worker" icon={<Terminal />}>
            <div className="console" ref={consoleRef} aria-live="polite">
              {logs.length === 0 && <div className="faint">Sin eventos todavía…</div>}
              {logs.map((l) => (
                <div key={l.id} className={l.level}>
                  <time>{new Date(l.created_at).toLocaleTimeString("es-PE")}</time>
                  {l.message}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Trazabilidad">
            <dl className="kv small">
              <dt>ID</dt><dd className="num xs">{j.id}</dd>
              <dt>Épocas</dt><dd className="num">{j.params_json.epochs}</dd>
              <dt>Batch size</dt><dd className="num">{j.params_json.batch_size}</dd>
              <dt>Optimizador</dt><dd>{j.params_json.optimizer} · lr {j.params_json.learning_rate}</dd>
              <dt>Semilla</dt><dd className="num">{j.params_json.seed}</dd>
              <dt>Early stopping</dt><dd>{j.params_json.early_stopping ? `sí · paciencia ${j.params_json.patience}` : "no"}</dd>
              <dt>Código</dt><dd className="num">v{j.code_version}</dd>
              <dt>Intentos</dt><dd className="num">{j.attempts}</dd>
              <dt>Inicio</dt><dd>{fmtDate(j.started_at)}</dd>
              <dt>Fin</dt><dd>{fmtDate(j.ended_at)}</dd>
            </dl>
            {s.status === "COMPLETED" && <Link to={`/projects/${j.project_id}?tab=models`} className="btn sm mt">Ver versión del modelo</Link>}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Evaluation({ result, isGan }: { result: Record<string, any>; isGan: boolean }) {
  if (isGan) {
    const pts = [
      ...(result.real ?? []).map((p: number[]) => [p[0], p[1], 0]),
      ...(result.samples ?? []).map((p: number[]) => [p[0], p[1], 1]),
    ];
    return (
      <Panel title="Evaluación final · muestras generadas vs reales">
        <p className="small muted mb">Brecha de distribución (media + desviación): <span className="num">{fmtNum(result.distribution_gap, 4)}</span>. Clase 0 = datos reales, clase 1 = generados.</p>
        {pts.length > 0 && result.real?.[0]?.length >= 2 && <PointsScatter points={pts} classes={2} height={260} />}
      </Panel>
    );
  }
  const test = (result.test ?? {}) as Record<string, number>;
  const cm = result.confusion_matrix as number[][] | undefined;
  const names = (result.class_names as string[]) ?? [];
  const max = cm ? Math.max(...cm.flat(), 1) : 1;
  return (
    <Panel title="Evaluación final (conjunto de prueba)">
      <div className="row wrap" style={{ gap: 24 }}>
        {Object.entries(test).map(([k, v]) => (
          <div key={k} className="readout"><span className="value num" style={{ fontSize: 22 }}>{k === "accuracy" ? `${(v * 100).toFixed(1)} %` : fmtNum(v, 4)}</span><span className="label">{k === "loss" ? "Pérdida" : k === "accuracy" ? "Exactitud" : k.toUpperCase()}</span></div>
        ))}
        {result.r2 !== undefined && <div className="readout"><span className="value num" style={{ fontSize: 22 }}>{fmtNum(result.r2, 3)}</span><span className="label">R²</span></div>}
        <div className="readout"><span className="value num" style={{ fontSize: 22 }}>{result.n_test}</span><span className="label">Muestras de prueba</span></div>
      </div>
      {cm && (
        <div className="mt">
          <div className="small muted mb">Matriz de confusión (filas: real · columnas: predicho)</div>
          <div className="table-wrap">
            <table className="table" style={{ width: "auto" }}>
              <thead><tr><th></th>{cm.map((_, i) => <th key={i} className="r">{names[i] ?? i}</th>)}</tr></thead>
              <tbody>
                {cm.map((row, i) => (
                  <tr key={i}>
                    <th style={{ borderBottom: 0 }}>{names[i] ?? i}</th>
                    {row.map((v, k) => (
                      <td key={k} className="r num" style={{ background: `rgba(${i === k ? "95,214,160" : "242,101,122"},${(v / max) * 0.45})` }}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="xs faint mt">Limitación: métricas sobre un único conjunto de prueba; para decisiones de producción valida con datos nuevos.</p>
    </Panel>
  );
}
