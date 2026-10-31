import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCompare, Play } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Empty, ErrorBox, Field, Loading, Modal, Panel } from "../../components/ui";
import { api } from "../../lib/api";
import { FAMILY_LABEL, TASK_LABEL, canEdit } from "../../lib/format";
import type { Architecture, Dataset, Project, TrainingJob, TrainingParams } from "../../types";
import JobsTable from "./JobsTable";

export default function TrainingTab({ project: p }: { project: Project }) {
  const q = useQuery({
    queryKey: ["jobs", p.id],
    queryFn: () => api<TrainingJob[]>(`/training-jobs?project_id=${p.id}&limit=200`),
    refetchInterval: (query) => (query.state.data?.some((j) => ["QUEUED", "PREPARING", "RUNNING"].includes(j.status)) ? 3000 : false),
  });
  const [open, setOpen] = useState(false);
  const editable = canEdit(p.my_role) && p.status === "active";
  if (q.isLoading) return <Loading />;
  return (
    <>
      <ErrorBox error={q.error} />
      <Panel title="Entrenamientos"
        actions={<>
          {(q.data?.length ?? 0) > 1 && <Link to={`/projects/${p.id}/compare`} className="btn sm"><GitCompare />Comparar</Link>}
          {editable && <button className="btn sm primary" onClick={() => setOpen(true)}><Play />Nuevo entrenamiento</button>}
        </>}>
        {q.data?.length ? <JobsTable jobs={q.data} /> : (
          <Empty title="Sin entrenamientos todavía"
            action={editable ? <button className="btn primary" onClick={() => setOpen(true)}><Play />Configurar el primero</button> : undefined}>
            Necesitas al menos una arquitectura y un dataset compatibles.
          </Empty>
        )}
      </Panel>
      {open && <NewJobModal project={p} onClose={() => setOpen(false)} />}
    </>
  );
}

const DEFAULTS: TrainingParams = { epochs: 40, batch_size: 32, optimizer: "adam", learning_rate: 0.01, seed: 42, early_stopping: false, patience: 10 };

export function NewJobModal({ project: p, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const archs = useQuery({ queryKey: ["architectures", p.id], queryFn: () => api<Architecture[]>(`/projects/${p.id}/architectures`) });
  const sets = useQuery({ queryKey: ["datasets", p.id], queryFn: () => api<Dataset[]>(`/projects/${p.id}/datasets`) });
  const [archId, setArchId] = useState("");
  const [dsId, setDsId] = useState("");
  const [params, setParams] = useState<TrainingParams>(DEFAULTS);
  const arch = archs.data?.find((a) => a.id === (archId || archs.data?.[0]?.id));
  const ds = sets.data?.find((d) => d.id === (dsId || sets.data?.[0]?.id));

  // Pre-chequeo en cliente (informativo; el backend vuelve a validar todo)
  const hint = useMemo(() => {
    if (!arch || !ds) return null;
    const a = arch.config_json.input_shape.join("×"), d = ds.metadata_json.input_shape.join("×");
    if (a !== d) return `La arquitectura espera (${a}) pero el dataset entrega (${d}).`;
    return null;
  }, [arch, ds]);

  const m = useMutation({
    mutationFn: () => api<TrainingJob>(`/projects/${p.id}/training-jobs`, {
      method: "POST", body: { architecture_id: arch!.id, dataset_id: ds!.id, params },
    }),
    onSuccess: (j) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      nav(`/jobs/${j.id}`);
    },
  });
  const set = <K extends keyof TrainingParams>(k: K, v: TrainingParams[K]) => setParams({ ...params, [k]: v });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };

  if (archs.isLoading || sets.isLoading) return <Modal title="Nuevo entrenamiento" onClose={onClose}><Loading /></Modal>;
  const missing = !archs.data?.length ? "arquitectura" : !sets.data?.length ? "dataset" : null;

  return (
    <Modal title="Nuevo entrenamiento" subtitle="El trabajo entra en la cola; un worker Python lo ejecuta con TensorFlow/Keras." onClose={onClose}>
      {missing ? (
        <Alert tone="warn">Primero registra al menos un {missing} en este proyecto.</Alert>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="Arquitectura">
            <select className="input" value={arch?.id} onChange={(e) => setArchId(e.target.value)}>
              {archs.data!.map((a) => <option key={a.id} value={a.id}>{a.name} v{a.version} · {FAMILY_LABEL[a.family]} · ({a.config_json.input_shape.join("×")})</option>)}
            </select>
          </Field>
          <Field label="Dataset">
            <select className="input" value={ds?.id} onChange={(e) => setDsId(e.target.value)}>
              {sets.data!.map((d) => <option key={d.id} value={d.id}>{d.name} v{d.version} · {TASK_LABEL[d.metadata_json.task]} · ({d.metadata_json.input_shape.join("×")})</option>)}
            </select>
          </Field>
          {hint && <Alert tone="warn">{hint}</Alert>}
          <div className="grid g2">
            <Field label="Épocas"><input className="input num" type="number" min={1} max={1000} value={params.epochs} onChange={(e) => set("epochs", parseInt(e.target.value, 10))} /></Field>
            <Field label="Tamaño de lote (batch size)"><input className="input num" type="number" min={1} max={4096} value={params.batch_size} onChange={(e) => set("batch_size", parseInt(e.target.value, 10))} /></Field>
            <Field label="Optimizador">
              <select className="input" value={params.optimizer} onChange={(e) => set("optimizer", e.target.value as TrainingParams["optimizer"])}>
                <option value="adam">Adam</option><option value="adamw">AdamW</option><option value="rmsprop">RMSprop</option><option value="sgd">SGD</option>
              </select>
            </Field>
            <Field label="Tasa de aprendizaje"><input className="input num" type="number" step="any" min={0.00001} max={1} value={params.learning_rate} onChange={(e) => set("learning_rate", parseFloat(e.target.value))} /></Field>
            <Field label="Semilla" hint="Misma semilla + misma configuración = resultado reproducible"><input className="input num" type="number" min={0} value={params.seed} onChange={(e) => set("seed", parseInt(e.target.value, 10))} /></Field>
            <Field label="Paciencia (early stopping)"><input className="input num" type="number" min={1} max={100} disabled={!params.early_stopping} value={params.patience} onChange={(e) => set("patience", parseInt(e.target.value, 10))} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={params.early_stopping} onChange={(e) => set("early_stopping", e.target.checked)} />Detener antes si la pérdida de validación deja de mejorar</label>
          <ErrorBox error={m.error} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
            <button className="btn primary" disabled={m.isPending}><Play />{m.isPending ? "Encolando…" : "Iniciar entrenamiento"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
