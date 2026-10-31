import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useState } from "react";
import { useCrumbs } from "../../components/Layout";
import { Empty, ErrorBox, Loading, Panel } from "../../components/ui";
import { api } from "../../lib/api";
import { JOB_STATUS } from "../../lib/format";
import type { JobStatus, TrainingJob } from "../../types";
import JobsTable from "./JobsTable";

export default function JobsPage() {
  useCrumbs([{ label: "Inicio", to: "/" }, { label: "Entrenamientos" }]);
  const [status, setStatus] = useState("");
  const q = useQuery({
    queryKey: ["jobs", "all", status],
    queryFn: () => api<TrainingJob[]>(`/training-jobs?limit=200${status ? `&status=${status}` : ""}`),
    refetchInterval: (query) => (query.state.data?.some((j) => ["QUEUED", "PREPARING", "RUNNING"].includes(j.status)) ? 3000 : 20000),
  });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Entrenamientos</h1>
          <p>Todos los trabajos de los proyectos a los que tienes acceso. La ejecución sigue en el worker aunque cambies de pantalla.</p>
        </div>
        <select className="input" style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          <option value="QUEUED,PREPARING,RUNNING">Activos</option>
          {(Object.keys(JOB_STATUS) as JobStatus[]).map((s) => <option key={s} value={s}>{JOB_STATUS[s].label}</option>)}
        </select>
      </div>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {q.data && (
        <Panel>
          {q.data.length ? <JobsTable jobs={q.data} showProject /> : <Empty icon={<Activity />} title="No hay entrenamientos con ese filtro" />}
        </Panel>
      )}
    </>
  );
}
