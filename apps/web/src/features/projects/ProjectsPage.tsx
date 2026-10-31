import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, FolderPlus, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useCrumbs } from "../../components/Layout";
import { Badge, Empty, ErrorBox, Field, Loading, Modal } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { PROJECT_ROLE, fmtDate } from "../../lib/format";
import type { Project } from "../../types";

const STATUS_LABEL: Record<string, string> = { active: "Activo", paused: "En pausa", archived: "Archivado" };

export default function ProjectsPage() {
  useCrumbs([{ label: "Inicio", to: "/" }, { label: "Proyectos" }]);
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const canCreate = me?.role === "admin" || me?.role === "project_owner";
  const list = useQuery({
    queryKey: ["projects", q, status],
    queryFn: () => api<Project[]>(`/projects?${new URLSearchParams({ ...(q && { q }), ...(status && { status }) })}`),
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Proyectos de IA</h1>
          <p>Cada proyecto agrupa el problema, sus datasets, arquitecturas, entrenamientos y versiones de modelo.</p>
        </div>
        {canCreate && (
          <button className="btn primary" onClick={() => setParams({ new: "1" })}><FolderPlus />Nuevo proyecto</button>
        )}
      </div>

      <div className="row wrap mb">
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 380 }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: 11, color: "var(--muted)" }} />
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Buscar por nombre o descripción" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Buscar proyectos" />
        </div>
        <select className="input" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="paused">En pausa</option>
          <option value="archived">Archivados</option>
        </select>
      </div>

      {list.isLoading && <Loading />}
      <ErrorBox error={list.error} />
      {list.data && list.data.length === 0 && (
        <div className="panel">
          <Empty icon={<FolderKanban />} title="No hay proyectos que mostrar"
            action={canCreate ? <button className="btn primary" onClick={() => setParams({ new: "1" })}>Crear el primero</button> : undefined}>
            {canCreate ? "Empieza describiendo el problema que quieres resolver." : "Pide a un responsable de proyecto que te agregue como miembro."}
          </Empty>
        </div>
      )}
      <div className="grid g3">
        {list.data?.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="panel" style={{ color: "inherit", display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="row between">
              <h3 style={{ fontSize: 18 }}>{p.name}</h3>
              {p.stats.active_jobs > 0 ? <Badge tone="pulse" live>{p.stats.active_jobs} en curso</Badge> :
                <Badge tone={p.status === "active" ? "ok" : "muted"}>{STATUS_LABEL[p.status]}</Badge>}
            </div>
            <p className="muted small" style={{ minHeight: 42 }}>{p.description || p.problem_statement || "Sin descripción."}</p>
            <div className="row wrap">{p.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
            <div className="row between xs muted" style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid var(--line-soft)" }}>
              <span className="num">{p.stats.architectures} arq · {p.stats.jobs} ent · {p.stats.models} modelos</span>
              <span>{p.my_role ? PROJECT_ROLE[p.my_role] : ""}</span>
            </div>
            <div className="xs faint">Actualizado {fmtDate(p.updated_at)}</div>
          </Link>
        ))}
      </div>
      {params.get("new") && canCreate && <NewProjectModal onClose={() => setParams({})} />}
    </>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", description: "", problem_statement: "", tags: "" });
  const m = useMutation({
    mutationFn: () => api<Project>("/projects", {
      method: "POST",
      body: { ...form, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean) },
    }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      nav(`/projects/${p.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Modal title="Nuevo proyecto" subtitle="Paso 1 del flujo: describe el problema que la red debe resolver." onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Nombre">
          <input className="input" required minLength={3} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Descripción breve">
          <input className="input" maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Problema a resolver" hint="¿Qué entra, qué debe predecir la red y cómo sabrás que funciona?">
          <textarea className="input" maxLength={4000} value={form.problem_statement} onChange={(e) => setForm({ ...form, problem_statement: e.target.value })} />
        </Field>
        <Field label="Etiquetas" hint="Separadas por comas, por ejemplo: clasificación, demo">
          <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        </Field>
        <ErrorBox error={m.error} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={m.isPending}>{m.isPending ? "Creando…" : "Crear proyecto"}</button>
        </div>
      </form>
    </Modal>
  );
}
