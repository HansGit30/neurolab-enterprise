import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { METRIC_LABEL } from "../lib/format";
import type { Metric } from "../types";

export const SERIES_COLORS = ["#4fd1e8", "#f5b84a", "#a78bfa", "#5fd6a0", "#f2657a", "#7aa2ff"];
const axis = { stroke: "#56668a", fontSize: 12, tickLine: false, axisLine: { stroke: "#1f2f4d" } };
const tooltip = {
  contentStyle: { background: "#0f1a2e", border: "1px solid #1f2f4d", borderRadius: 8, fontSize: 13 },
  labelStyle: { color: "#b4c1da" },
};

/** Convierte filas (epoch, metric_name, value) en series por época. */
export function pivot(metrics: Metric[], names: string[]) {
  const by = new Map<number, Record<string, number>>();
  for (const m of metrics) {
    if (!names.includes(m.metric_name)) continue;
    const row = by.get(m.epoch) ?? { epoch: m.epoch };
    row[m.metric_name] = m.metric_value;
    by.set(m.epoch, row);
  }
  return [...by.values()].sort((a, b) => a.epoch - b.epoch);
}

export function MetricChart({ metrics, names, height = 260 }: { metrics: Metric[]; names: string[]; height?: number }) {
  const present = names.filter((n) => metrics.some((m) => m.metric_name === n));
  const data = pivot(metrics, present);
  if (!data.length) return <div className="muted small" style={{ height, display: "grid", placeItems: "center" }}>Esperando la primera época…</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid stroke="#172540" vertical={false} />
        <XAxis dataKey="epoch" {...axis} />
        <YAxis {...axis} width={56} tickFormatter={(v) => Number(v).toFixed(2)} domain={["auto", "auto"]} />
        <Tooltip {...tooltip} formatter={(v, n) => [Number(v).toFixed(4), METRIC_LABEL[String(n)] ?? String(n)]} labelFormatter={(l) => `Época ${l}`} />
        <Legend formatter={(v) => <span style={{ color: "#b4c1da", fontSize: 12.5 }}>{METRIC_LABEL[v] ?? v}</span>} />
        {present.map((n, i) => (
          <Line key={n} type="monotone" dataKey={n} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2}
            dot={false} isAnimationActive={false} strokeDasharray={n.startsWith("val_") ? "5 4" : undefined} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CompareChart({ series, height = 300 }: { series: { name: string; points: { epoch: number; value: number }[] }[]; height?: number }) {
  const epochs = new Map<number, Record<string, number>>();
  series.forEach((s) => s.points.forEach((p) => {
    const row = epochs.get(p.epoch) ?? { epoch: p.epoch };
    row[s.name] = p.value;
    epochs.set(p.epoch, row);
  }));
  const data = [...epochs.values()].sort((a, b) => a.epoch - b.epoch);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid stroke="#172540" vertical={false} />
        <XAxis dataKey="epoch" {...axis} />
        <YAxis {...axis} width={56} tickFormatter={(v) => Number(v).toFixed(2)} />
        <Tooltip {...tooltip} formatter={(v) => Number(v).toFixed(4)} labelFormatter={(l) => `Época ${l}`} />
        <Legend formatter={(v) => <span style={{ color: "#b4c1da", fontSize: 12.5 }}>{v}</span>} />
        {series.map((s, i) => (
          <Line key={s.name} type="monotone" dataKey={s.name} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ActivityBars({ data, height = 140 }: { data: { date: string; count: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
        <CartesianGrid stroke="#172540" vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={(d) => d.slice(8)} interval={1} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip {...tooltip} cursor={{ fill: "rgba(79,209,232,0.06)" }} formatter={(v) => [v, "Entrenamientos"]} />
        <Bar dataKey="count" fill="#4fd1e8" radius={[3, 3, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PointsScatter({ points, classes, height = 260 }: { points: number[][]; classes?: number; height?: number }) {
  const groups = new Map<number, { x: number; y: number }[]>();
  const regression = !classes;
  for (const [x, y, t] of points) {
    const k = regression ? 0 : Math.round(t);
    const arr = groups.get(k) ?? [];
    arr.push(regression ? { x, y: t } : { x, y });
    groups.set(k, arr);
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="#172540" />
        <XAxis type="number" dataKey="x" {...axis} tickFormatter={(v) => Number(v).toFixed(1)} />
        <YAxis type="number" dataKey="y" {...axis} tickFormatter={(v) => Number(v).toFixed(1)} />
        <ZAxis range={[18, 18]} />
        <Tooltip {...tooltip} formatter={(v) => Number(v).toFixed(3)} />
        {[...groups.entries()].map(([k, pts], i) => (
          <Scatter key={k} name={regression ? "y" : `Clase ${k}`} data={pts} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.75} isAnimationActive={false} />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
