import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Alert, ErrorBox, Field, Panel } from "../../components/ui";
import { api } from "../../lib/api";
import { PROJECT_ROLE, canManage, fmtDate } from "../../lib/format";
import type { Member, Project, ProjectRole } from "../../types";

export default function ContextTab({ project: p }: { project: Project }) {
  const steps = [
    { done: true, label: "Crear el proyecto y describir el problema", to: "?tab=context" },
    { done: p.stats.architectures > 0, label: "Elegir la familia de red (Feedforward, RNN, CNN o GAN)", to: "?tab=architectures" },
    { done: p.stats.architectures > 0, label: "Definir entradas, capas, unidades, activaciones y salida", to: `/projects/${p.id}/designer` },
    { done: p.stats.datasets > 0, label: "Seleccionar un dataset permitido", to: "?tab=datasets" },
    { done: p.stats.jobs > 0, label: "Validar y enviar el entrenamiento a la cola", to: "?tab=training" },
    { done: p.stats.jobs > 0, label: "Observar el progreso en tiempo real y consultar métricas", to: "?tab=training" },
    { done: p.stats.models > 0, label: "Evaluar, guardar versión, comparar y exportar informe", to: "?tab=models" },
  ];
  return (
    <div className="grid split">
      <div className="stack" style={{ gap: 16 }}>
        <ProjectForm project={p} />
        <Panel title="Flujo guiado">
          <ol className="stack tight" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {steps.map((s, i) => (
              <li key={i} className="row" style={{ alignItems: "flex-start" }}>
                <span className="num" style={{
                  width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", flex: "none", fontSize: 12,
                  border: `1px solid ${s.done ? "var(--ok)" : "var(--line)"}`, color: s.done ? "var(--ok)" : "var(--muted)",
                  background: s.done ? "var(--ok-dim)" : "transparent",
                }}>
                  {s.done ? <Check size={14} /> : i + 1}
                </span>
                <Link to={s.to} style={{ color: s.done ? "var(--ink-2)" : "var(--ink)", paddingTop: 2 }}>{s.label}</Link>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
      <Members project={p} />
    </div>
  );
}

function ProjectForm({ project: p }: { project: Project }) {
  const qc = useQueryClient();
  const editable = canManage(p.my_role);
  const [f, setF] = useState({
    name: p.name, description: p.description, problem_statement: p.problem_statement, documentation: p.documentation,
    tags: p.tags.join(", "), status: p.status,
  });
  const m = useMutation({
    mutationFn: () => api<Project>(`/projects/${p.id}`, {
      method: "PATCH", body: { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", p.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Panel title="Contexto del problema">
      <form className="stack" onSubmit={submit}>
        <div className="grid g2">
          <Field label="Nombre"><input className="input" disabled={!editable} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Estado">
            <select className="input" disabled={!editable} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Project["status"] })}>
              <option value="active">Activo</option>
              <option value="paused">En pausa</option>
              <option value="archived">Archivado</option>
            </select>
          </Field>
        </div>
        <Field label="Descripción"><input className="input" disabled={!editable} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Problema a resolver">
          <textarea className="input" disabled={!editable} value={f.problem_statement} onChange={(e) => setF({ ...f, problem_statement: e.target.value })} />
        </Field>
        <Field label="Documentación" hint="Supuestos, fuentes de datos, criterios de éxito, limitaciones conocidas.">
          <textarea className="input" style={{ minHeight: 130 }} disabled={!editable} value={f.documentation} onChange={(e) => setF({ ...f, documentation: e.target.value })} />
        </Field>
        <Field label="Etiquetas"><input className="input" disabled={!editable} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
        <ErrorBox error={m.error} />
        {m.isSuccess && <Alert tone="ok">Cambios guardados.</Alert>}
        {editable && <div className="row"><button className="btn primary" disabled={m.isPending}>Guardar cambios</button></div>}
        <p className="xs faint">Creado {fmtDate(p.created_at)} · Actualizado {fmtDate(p.updated_at)}</p>
      </form>
    </Panel>
  );
}

function Members({ project: p }: { project: Project }) {
  const qc = useQueryClient();
  const manage = canManage(p.my_role);
  const q = useQuery({ queryKey: ["members", p.id], queryFn: () => api<Member[]>(`/projects/${p.id}/members`) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("engineer");
  const add = useMutation({
    mutationFn: () => api<Member>(`/projects/${p.id}/members`, { method: "POST", body: { email, role } }),
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["members", p.id] });
    },
  });
  const remove = useMutation({
    mutationFn: (uid: string) => api(`/projects/${p.id}/members/${uid}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", p.id] }),
  });
  const changeRole = useMutation({
    mutationFn: (m: { email: string; role: ProjectRole }) => api(`/projects/${p.id}/members`, { method: "POST", body: m }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", p.id] }),
  });
  return (
    <Panel title="Miembros y permisos" icon={<Users />}>
      <div className="stack tight">
        {q.data?.map((m) => (
          <div key={m.user_id} className="row between inset" style={{ padding: "8px 12px" }}>
            <div style={{ minWidth: 0 }}>
              <div className="small">{m.display_name}</div>
              <div className="xs muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>
            </div>
            {manage && m.user_id !== p.owner_id ? (
              <div className="row" style={{ gap: 6 }}>
                <select className="input" style={{ height: 30, width: 150, fontSize: 13 }} value={m.role}
                  onChange={(e) => changeRole.mutate({ email: m.email, role: e.target.value as ProjectRole })} aria-label={`Rol de ${m.email}`}>
                  {(Object.keys(PROJECT_ROLE) as ProjectRole[]).map((r) => <option key={r} value={r}>{PROJECT_ROLE[r]}</option>)}
                </select>
                <button className="btn sm ghost" onClick={() => remove.mutate(m.user_id)}>Quitar</button>
              </div>
            ) : (
              <span className="xs muted">{PROJECT_ROLE[m.role]}</span>
            )}
          </div>
        ))}
      </div>
      {manage && (
        <form className="stack mt" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Field label="Agregar por correo" hint="La persona debe haberse registrado antes.">
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="row">
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} aria-label="Rol">
              {(Object.keys(PROJECT_ROLE) as ProjectRole[]).map((r) => <option key={r} value={r}>{PROJECT_ROLE[r]}</option>)}
            </select>
            <button className="btn" disabled={add.isPending}>Agregar</button>
          </div>
          <ErrorBox error={add.error ?? remove.error ?? changeRole.error} />
        </form>
      )}
    </Panel>
  );
}
