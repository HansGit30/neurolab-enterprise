import { useQuery } from "@tanstack/react-query";
import { Network, PencilRuler } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import NetworkGraph from "../../components/NetworkGraph";
import { Badge, Empty, ErrorBox, Loading, Panel } from "../../components/ui";
import { api } from "../../lib/api";
import { FAMILY_LABEL, canEdit, fmtDate, fmtInt } from "../../lib/format";
import type { Architecture, Project } from "../../types";
import { layerMeta } from "./presets";

export default function ArchitecturesTab({ project: p }: { project: Project }) {
  const q = useQuery({ queryKey: ["architectures", p.id], queryFn: () => api<Architecture[]>(`/projects/${p.id}/architectures`) });
  const [selId, setSelId] = useState<string | null>(null);
  const sel = q.data?.find((a) => a.id === selId) ?? q.data?.[0];
  const editable = canEdit(p.my_role);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data?.length)
    return (
      <div className="panel">
        <Empty icon={<Network />} title="Aún no hay arquitecturas"
          action={editable ? <Link className="btn primary" to={`/projects/${p.id}/designer`}><PencilRuler />Abrir el diseñador</Link> : undefined}>
          Define cuántas capas tendrá la red, cuántas neuronas por capa y qué función de activación usa cada una.
        </Empty>
      </div>
    );

  return (
    <div className="grid split">
      <Panel title="Arquitecturas guardadas" actions={editable && <Link className="btn sm primary" to={`/projects/${p.id}/designer`}><PencilRuler />Nueva</Link>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nombre</th><th>Familia</th><th className="r">Parámetros</th><th>Creada</th></tr></thead>
            <tbody>
              {q.data.map((a) => (
                <tr key={a.id} onClick={() => setSelId(a.id)} style={{ cursor: "pointer", background: sel?.id === a.id ? "var(--signal-dim)" : undefined }}>
                  <td>{a.name} <span className="muted num small">v{a.version}</span></td>
                  <td><Badge tone="signal">{FAMILY_LABEL[a.family]}</Badge></td>
                  <td className="r num">{fmtInt(a.summary_json.total_params)}</td>
                  <td className="small muted">{fmtDate(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {sel && (
        <Panel title={`${sel.name} · v${sel.version}`}
          actions={editable && <Link className="btn sm" to={`/projects/${p.id}/designer?from=${sel.id}`}>Crear nueva versión</Link>}>
          {sel.family !== "gan" && (
            <div className="inset" style={{ padding: 6 }}>
              <NetworkGraph inputShape={sel.config_json.input_shape} summary={sel.summary_json} height={240} />
            </div>
          )}
          <dl className="kv mt">
            <dt>Entrada</dt><dd className="num">({sel.config_json.input_shape.join("×")})</dd>
            <dt>Salida</dt><dd className="num">({sel.summary_json.output_shape?.join("×")})</dd>
            <dt>Parámetros</dt><dd className="num">{fmtInt(sel.summary_json.total_params)}</dd>
          </dl>
          <ol className="small mt" style={{ paddingLeft: 20, color: "var(--ink-2)" }}>
            {(sel.config_json.layers ?? [...(sel.config_json.generator?.layers ?? []), ...(sel.config_json.discriminator?.layers ?? [])]).map((l, i) => (
              <li key={i}>{l.type} <span className="muted">{layerMeta(l)}</span></li>
            ))}
          </ol>
          {sel.justification && (
            <div className="inset mt">
              <div className="xs muted">Justificación registrada</div>
              <p className="small mt-s">{sel.justification}</p>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
