import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "../lib/api";
import { authHeaders } from "../lib/supabase";
import type { JobLog, JobStatus, Metric, TrainingJob } from "../types";

export type StreamState = "connecting" | "live" | "reconnecting" | "closed";

interface Snapshot {
  status: JobStatus;
  progress: number;
  current_epoch: number;
  total_epochs: number;
  error_message: string | null;
  cancel_requested: boolean;
  result: Record<string, unknown> | null;
}

const TERMINAL: JobStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

/**
 * Canal de eventos en tiempo real (SSE sobre fetch, para poder enviar el token en la cabecera).
 * - Al montar: carga estado/métricas/logs desde REST (fuente de verdad).
 * - Luego abre el stream y aplica deltas.
 * - Si se corta: reintenta con backoff enviando Last-Event-ID y re-sincroniza por REST.
 */
export function useJobStream(jobId: string | undefined, initial?: TrainingJob) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [state, setState] = useState<StreamState>("connecting");
  const [netEpoch, setNetEpoch] = useState<number | null>(null);
  const lastId = useRef<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let ctrl: AbortController | null = null;
    let attempt = 0;

    const sync = async () => {
      const [job, ms, ls] = await Promise.all([
        api<TrainingJob>(`/training-jobs/${jobId}`),
        api<Metric[]>(`/training-jobs/${jobId}/metrics`),
        api<JobLog[]>(`/training-jobs/${jobId}/logs`),
      ]);
      setMetrics(ms);
      setLogs(ls);
      setSnapshot({
        status: job.status, progress: job.progress, current_epoch: job.current_epoch, total_epochs: job.total_epochs,
        error_message: job.error_message, cancel_requested: job.cancel_requested, result: job.result_json,
      });
      const lm = ms.length ? ms[ms.length - 1].id : 0;
      const ll = ls.length ? ls[ls.length - 1].id : 0;
      lastId.current = `m${lm}.l${ll}`;
      return job;
    };

    const connect = async () => {
      while (!stopped) {
        try {
          const job = await sync();
          if (TERMINAL.includes(job.status)) {
            setState("closed");
            return;
          }
          ctrl = new AbortController();
          const headers: Record<string, string> = { ...(await authHeaders()), Accept: "text/event-stream" };
          if (lastId.current) headers["Last-Event-ID"] = lastId.current;
          const res = await fetch(`${API_BASE}/training-jobs/${jobId}/events`, { headers, signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
          setState("live");
          attempt = 0;
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
              const raw = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              let event = "message";
              let data = "";
              for (const line of raw.split("\n")) {
                if (line.startsWith("event: ")) event = line.slice(7);
                else if (line.startsWith("data: ")) data += line.slice(6);
                else if (line.startsWith("id: ")) lastId.current = line.slice(4);
              }
              if (!data) continue;
              const payload = JSON.parse(data);
              if (event === "metrics") {
                setMetrics((prev) => {
                  const seen = new Set(prev.map((m) => m.id));
                  return [...prev, ...(payload as Metric[]).filter((m) => !seen.has(m.id))];
                });
              } else if (event === "logs") {
                setLogs((prev) => {
                  const seen = new Set(prev.map((l) => l.id));
                  return [...prev, ...(payload as JobLog[]).filter((l) => !seen.has(l.id))].slice(-400);
                });
              } else if (event === "network") {
                setNetEpoch((payload as { epoch: number }).epoch);
              } else if (event === "snapshot") {
                setSnapshot(payload as Snapshot);
              } else if (event === "end") {
                stopped = true;
                setState("closed");
                await sync();
                qc.invalidateQueries({ queryKey: ["jobs"] });
                qc.invalidateQueries({ queryKey: ["models"] });
                qc.invalidateQueries({ queryKey: ["job", jobId] });
                return;
              }
            }
          }
          throw new Error("stream cerrado");
        } catch (e) {
          if (stopped || (e as Error).name === "AbortError") return;
          attempt++;
          setState("reconnecting");
          await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** Math.min(attempt, 4))));
        }
      }
    };

    if (initial) {
      setSnapshot({
        status: initial.status, progress: initial.progress, current_epoch: initial.current_epoch,
        total_epochs: initial.total_epochs, error_message: initial.error_message,
        cancel_requested: initial.cancel_requested, result: initial.result_json,
      });
    }
    connect();
    return () => {
      stopped = true;
      ctrl?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  return { snapshot, metrics, logs, state, netEpoch };
}
