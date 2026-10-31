import { Link } from "react-router-dom";
import { JobBadge, Progress } from "../../components/ui";
import { FAMILY_LABEL, fmtDate, fmtDuration, fmtNum } from "../../lib/format";
import type { TrainingJob } from "../../types";

export function headlineMetric(j: TrainingJob): string {
  const t = (j.result_json?.test ?? {}) as Record<string, number>;
  if (t.accuracy !== undefined) return `${(t.accuracy * 100).toFixed(1)} % exactitud`;
  if (t.mae !== undefined) return `MAE ${fmtNum(t.mae, 3)}`;
  if (j.result_json?.distribution_gap !== undefined) return `brecha ${fmtNum(j.result_json.distribution_gap as number, 3)}`;
  return "—";
}

export default function JobsTable({ jobs, showProject = false, compact = false }: { jobs: TrainingJob[]; showProject?: boolean; compact?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Estado</th>
            {showProject && <th>Proyecto</th>}
            <th>Arquitectura</th>
            {!compact && <th>Dataset</th>}
            <th>Progreso</th>
            <th>Resultado</th>
            {!compact && <th>Duración</th>}
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td><Link to={`/jobs/${j.id}`} aria-label="Ver entrenamiento"><JobBadge status={j.status} /></Link></td>
              {showProject && <td><Link to={`/projects/${j.project_id}`}>{j.project_name}</Link></td>}
              <td>
                <Link to={`/jobs/${j.id}`} style={{ color: "var(--ink)" }}>{j.architecture_name}</Link>
                <div className="xs muted">{j.architecture_family ? FAMILY_LABEL[j.architecture_family] : ""}</div>
              </td>
              {!compact && <td className="small">{j.dataset_name}</td>}
              <td style={{ minWidth: 120 }}>
                <Progress value={j.progress} status={j.status} />
                <div className="xs muted num mt-s">{j.current_epoch}/{j.total_epochs} épocas</div>
              </td>
              <td className="small">{j.status === "FAILED" ? <span style={{ color: "var(--err)" }}>{j.error_message?.slice(0, 60)}</span> : headlineMetric(j)}</td>
              {!compact && <td className="small num">{fmtDuration(j.started_at, j.ended_at)}</td>}
              <td className="small muted">{fmtDate(j.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
