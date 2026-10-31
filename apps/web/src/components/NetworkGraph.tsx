import type { ValidationSummary } from "../types";

type Col = { label: string; sub: string; units: number; kind: "input" | "dense" | "conv" | "rnn" | "op" | "output" };

const KIND_COLOR: Record<Col["kind"], string> = {
  input: "#a78bfa", dense: "#4fd1e8", conv: "#5fd6a0", rnn: "#f5b84a", op: "#56668a", output: "#f5b84a",
};

function kindOf(type: string): Col["kind"] {
  if (type === "Dense") return "dense";
  if (type === "Conv2D") return "conv";
  if (["SimpleRNN", "LSTM", "GRU"].includes(type)) return "rnn";
  return "op";
}

/** Grafo de la arquitectura: columnas de neuronas (máx. 8 visibles por capa) con conexiones densas. */
export default function NetworkGraph({ inputShape, summary, height = 300, selected, onSelect }: {
  inputShape: number[];
  summary?: ValidationSummary | null;
  height?: number;
  selected?: number | null;
  onSelect?: (i: number) => void;
}) {
  const cols: Col[] = [{ label: "Entrada", sub: `(${inputShape.join("×")})`, units: inputShape.reduce((a, b) => a * b, 1), kind: "input" }];
  (summary?.layers ?? []).forEach((l, i, arr) => {
    const units = l.output_shape[l.output_shape.length - 1] ?? 1;
    cols.push({
      label: l.type,
      sub: `(${l.output_shape.join("×")})`,
      units: kindOf(l.type) === "op" ? 0 : units,
      kind: i === arr.length - 1 ? "output" : kindOf(l.type),
    });
  });
  const W = Math.max(520, cols.length * 110);
  const H = height;
  const top = 26, bottom = 48;
  const maxShow = 8;
  const pos = cols.map((c, ci) => {
    const x = 50 + (ci / Math.max(1, cols.length - 1)) * (W - 100);
    const n = c.kind === "op" ? 0 : Math.min(maxShow, c.units);
    const ys = Array.from({ length: n }, (_, i) => top + ((i + 0.5) / n) * (H - top - bottom));
    return { x, ys, c };
  });
  // capas "op" (Dropout, Flatten...) se dibujan como barra; las conexiones las saltan
  const real = pos.filter((p) => p.ys.length > 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Diagrama de la arquitectura" style={{ display: "block" }}>
      {real.slice(0, -1).map((a, i) => {
        const b = real[i + 1];
        return a.ys.flatMap((ya, ia) => b.ys.map((yb, ib) => (
          <line key={`${i}-${ia}-${ib}`} x1={a.x} y1={ya} x2={b.x} y2={yb} stroke="#4fd1e8" strokeOpacity={0.12} strokeWidth={1} />
        )));
      })}
      {pos.map((p, ci) => {
        const sel = selected !== undefined && selected !== null && selected === ci - 1;
        const clickable = onSelect && ci > 0;
        return (
          <g key={ci} onClick={clickable ? () => onSelect!(ci - 1) : undefined} style={{ cursor: clickable ? "pointer" : "default" }}>
            {sel && <rect x={p.x - 34} y={6} width={68} height={H - 12} rx={10} fill="rgba(79,209,232,0.08)" stroke="#4fd1e8" strokeOpacity={0.5} />}
            {p.ys.length === 0 ? (
              <rect x={p.x - 4} y={top} width={8} height={H - top - bottom} rx={4} fill="#1f2f4d" />
            ) : (
              p.ys.map((y, i) => (
                <circle key={i} cx={p.x} cy={y} r={7} fill="#0b1324" stroke={KIND_COLOR[p.c.kind]} strokeWidth={1.6} />
              ))
            )}
            {p.c.units > maxShow && p.c.kind !== "op" && (
              <text x={p.x} y={H - bottom + 14} textAnchor="middle" fontSize={10.5} fill="#56668a" fontFamily="IBM Plex Mono">+{p.c.units - maxShow}</text>
            )}
            <text x={p.x} y={H - 18} textAnchor="middle" fontSize={12} fill="#e2e9f6" fontFamily="IBM Plex Sans">{p.c.label}</text>
            <text x={p.x} y={H - 4} textAnchor="middle" fontSize={10.5} fill="#7d8db0" fontFamily="IBM Plex Mono">{p.c.sub}</text>
          </g>
        );
      })}
    </svg>
  );
}
