import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useCrumbs } from "../../components/Layout";
import { Badge, ErrorBox, Loading } from "../../components/ui";
import { api } from "../../lib/api";
import { PROJECT_ROLE } from "../../lib/format";
import type { Project } from "../../types";
import ArchitecturesTab from "../architectures/ArchitecturesTab";
import DatasetsTab from "../datasets/DatasetsTab";
import ModelsTab from "../model-registry/ModelsTab";
import HistoryTab from "../reports/HistoryTab";
import TrainingTab from "../training/TrainingTab";
import ContextTab from "./ContextTab";

const TABS = [
  { key: "context", label: "Contexto" },
  { key: "architectures", label: "Arquitectura" },
  { key: "datasets", label: "Dataset" },
  { key: "training", label: "Entrenamientos" },
  { key: "models", label: "Modelos" },
  { key: "history", label: "Historial" },
] as const;

export function useProject(id: string | undefined) {
  return useQuery({ queryKey: ["project", id], queryFn: () => api<Project>(`/projects/${id}`), enabled: !!id });
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as (typeof TABS)[number]["key"]) || "context";
  const q = useProject(id);
  const p = q.data;
  useCrumbs([{ label: "Proyectos", to: "/projects" }, { label: p?.name ?? "…", to: `/projects/${id}` },
    { label: TABS.find((t) => t.key === tab)?.label ?? "" }]);

  if (q.isLoading) return <Loading />;
  if (q.error || !p) return <ErrorBox error={q.error ?? new Error("Proyecto no encontrado")} />;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row wrap" style={{ gap: 10 }}>
            <h1>{p.name}</h1>
            {p.status !== "active" && <Badge tone="muted">{p.status === "paused" ? "En pausa" : "Archivado"}</Badge>}
            {p.stats.active_jobs > 0 && <Badge tone="pulse" live>{p.stats.active_jobs} entrenando</Badge>}
          </div>
          <p>{p.description || "Sin descripción."} · Tu rol: <strong>{p.my_role ? PROJECT_ROLE[p.my_role] : "—"}</strong></p>
        </div>
        <Link to={`/projects/${p.id}/report`} className="btn"><FileText />Informe del proyecto</Link>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setParams({ tab: t.key })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "context" && <ContextTab project={p} />}
      {tab === "architectures" && <ArchitecturesTab project={p} />}
      {tab === "datasets" && <DatasetsTab project={p} />}
      {tab === "training" && <TrainingTab project={p} />}
      {tab === "models" && <ModelsTab project={p} />}
      {tab === "history" && <HistoryTab project={p} />}
    </>
  );
}
