import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Trash2, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { PointsScatter, SERIES_COLORS } from "../../components/charts";
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Panel } from "../../components/ui";
import { api } from "../../lib/api";
import { FAMILY_LABEL, TASK_LABEL, canEdit, canManage, fmtDate, fmtInt } from "../../lib/format";
import type { BuiltinDataset, Dataset, Project } from "../../types";

interface Preview {
  task: string;
  points?: number[][];
  sequences?: { label: number; values: number[] }[];
  images?: { label: number; pixels: number[][] }[];
}

export default function DatasetsTab({ project: p }: { project: Project }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["datasets", p.id], queryFn: () => api<Dataset[]>(`/projects/${p.id}/datasets`) });
  const [adding, setAdding] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = q.data?.find((d) => d.id === selId) ?? q.data?.[0];
  const del = useMutation({
    mutationFn: (id: string) => api(`/datasets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasets", p.id] });
      setSelId(null);
    },
  });
  const editable = canEdit(p.my_role);

  if (q.isLoading) return <Loading />;
  return (
    <>
      <ErrorBox error={q.error ?? del.error} />
      {!q.data?.length ? (
        <div className="panel">
          <Empty icon={<Database />} title="Sin datasets registrados"
            action={editable ? <button className="btn primary" onClick={() => setAdding(true)}>Agregar dataset</button> : undefined}>
            Usa un dataset demo sintético (sin datos personales) o sube un CSV tabular propio.
          </Empty>
        </div>
      ) : (
        <div className="grid split">
          <Panel title="Datasets del proyecto" actions={editable && <button className="btn sm primary" onClick={() => setAdding(true)}>Agregar</button>}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Nombre</th><th>Tarea</th><th>Forma</th><th className="r">Muestras</th><th></th></tr></thead>
                <tbody>
                  {q.data.map((d) => (
                    <tr key={d.id} onClick={() => setSelId(d.id)} style={{ cursor: "pointer", background: sel?.id === d.id ? "var(--signal-dim)" : undefined }}>
                      <td>
                        {d.name} <span className="muted num small">v{d.version}</span>
                        <div className="xs muted">{d.metadata_json.kind === "builtin" ? "Demo sintético" : d.metadata_json.original_filename}</div>
                      </td>
                      <td className="small">{TASK_LABEL[d.metadata_json.task]}</td>
                      <td className="num small">({d.metadata_json.input_shape.join("×")})</td>
                      <td className="r num">{fmtInt(d.metadata_json.n_samples)}</td>
                      <td className="r">
                        {canManage(p.my_role) && (
                          <button className="btn ghost icon sm" aria-label="Eliminar dataset"
                            onClick={(e) => { e.stopPropagation(); if (confirm(`¿Eliminar "${d.name}"? El archivo se borra; el registro queda para la trazabilidad.`)) del.mutate(d.id); }}>
                            <Trash2 />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          {sel && <DatasetDetail d={sel} />}
        </div>
      )}
      {adding && <AddDataset projectId={p.id} onClose={() => setAdding(false)} />}
    </>
  );
}

function DatasetDetail({ d }: { d: Dataset }) {
  const m = d.metadata_json;
  const pv = useQuery({ queryKey: ["preview", d.id], queryFn: () => api<Preview>(`/datasets/${d.id}/preview`) });
  return (
    <Panel title={`${d.name} · v${d.version}`}>
      {m.description && <p className="small muted mb">{m.description}</p>}
      <dl className="kv">
        <dt>Tarea</dt><dd>{TASK_LABEL[m.task]}</dd>
        <dt>Entrada</dt><dd className="num">({m.input_shape.join("×")})</dd>
        {m.n_classes && <><dt>Clases</dt><dd>{m.class_names.join(", ")}</dd></>}
        <dt>División</dt><dd className="num">{m.splits.train * 100}% / {m.splits.validation * 100}% / {m.splits.test * 100}%</dd>
        {m.recommended_family && <><dt>Familia sugerida</dt><dd>{FAMILY_LABEL[m.recommended_family]}</dd></>}
        {m.target && <><dt>Columna objetivo</dt><dd>{m.target}</dd></>}
        <dt>Registrado</dt><dd>{fmtDate(d.created_at)}</dd>
      </dl>
      <div className="mt">
        {pv.isLoading && <Loading label="Cargando vista previa…" />}
        <ErrorBox error={pv.error} />
        {pv.data?.points && <PointsScatter points={pv.data.points} classes={m.n_classes ?? undefined} height={240} />}
        {pv.data?.sequences && (
          <div className="grid g3">
            {pv.data.sequences.map((s, i) => (
              <div key={i} className="inset" style={{ padding: 6 }}>
                <div className="xs muted">{m.class_names[s.label]}</div>
                <ResponsiveContainer width="100%" height={50}>
                  <LineChart data={s.values.map((v, k) => ({ k, v }))}>
                    <Line dataKey="v" stroke={SERIES_COLORS[s.label]} dot={false} strokeWidth={1.6} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        )}
        {pv.data?.images && (
          <div className="row wrap" style={{ gap: 14 }}>
            {pv.data.images.map((im, i) => (
              <div key={i} className="stack tight" style={{ alignItems: "center" }}>
                <div className="pix" style={{ gridTemplateColumns: `repeat(${im.pixels[0].length}, 1fr)` }}>
                  {im.pixels.flat().map((v, k) => (
                    <span key={k} style={{ background: `rgba(79,209,232,${Math.max(0.04, Math.min(1, v))})` }} />
                  ))}
                </div>
                <span className="xs muted">{m.class_names[im.label]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function AddDataset({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const cat = useQuery({ queryKey: ["dataset-catalog"], queryFn: () => api<BuiltinDataset[]>("/catalog/datasets") });
  const [mode, setMode] = useState<"demo" | "csv">("demo");
  const [gen, setGen] = useState("moons");
  const [n, setN] = useState(1000);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const done = () => {
    qc.invalidateQueries({ queryKey: ["datasets", projectId] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    onClose();
  };
  const demo = useMutation({
    mutationFn: () => api(`/projects/${projectId}/datasets/builtin`, { method: "POST", body: { generator: gen, n_samples: n } }),
    onSuccess: done,
  });
  const upload = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append("file", file!);
      f.append("name", name);
      if (target) f.append("target", target);
      return api(`/projects/${projectId}/datasets/upload`, { method: "POST", form: f });
    },
    onSuccess: done,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "demo") demo.mutate();
    else upload.mutate();
  };
  return (
    <Modal title="Agregar dataset" onClose={onClose}>
      <div className="row mb" style={{ gap: 4 }}>
        <button className={`btn sm ${mode === "demo" ? "primary" : ""}`} onClick={() => setMode("demo")}>Demo sintético</button>
        <button className={`btn sm ${mode === "csv" ? "primary" : ""}`} onClick={() => setMode("csv")}><Upload />Subir CSV</button>
      </div>
      <form className="stack" onSubmit={submit}>
        {mode === "demo" ? (
          <>
            <div className="stack tight" style={{ maxHeight: 300, overflow: "auto" }}>
              {cat.data?.map((c) => (
                <label key={c.key} className={`family-card ${gen === c.key ? "sel" : ""}`} style={{ display: "block" }}>
                  <input type="radio" name="gen" value={c.key} checked={gen === c.key} onChange={() => setGen(c.key)} style={{ position: "absolute", opacity: 0 }} />
                  <div className="row between"><strong className="small">{c.label}</strong><Badge tone="signal">{FAMILY_LABEL[c.family]}</Badge></div>
                  <p className="xs muted mt-s">{c.description}</p>
                </label>
              ))}
            </div>
            <Field label="Número de muestras"><input className="input num" type="number" min={100} max={20000} value={n} onChange={(e) => setN(parseInt(e.target.value, 10))} /></Field>
          </>
        ) : (
          <>
            <Field label="Nombre del dataset"><input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Archivo CSV" hint="Columnas numéricas + una columna objetivo. Se valida tipo, tamaño y contenido; nunca se ejecuta.">
              <input className="input" type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ paddingTop: 7 }} />
            </Field>
            <Field label="Columna objetivo (opcional)" hint="Si la dejas vacía se usa la última columna.">
              <input className="input" value={target} onChange={(e) => setTarget(e.target.value)} />
            </Field>
          </>
        )}
        <ErrorBox error={demo.error ?? upload.error} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={demo.isPending || upload.isPending}>{mode === "demo" ? "Registrar dataset" : "Subir y validar"}</button>
        </div>
      </form>
    </Modal>
  );
}
