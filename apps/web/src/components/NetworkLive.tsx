import { useQuery } from "@tanstack/react-query";
import { Pause, Play, Radio, Waves, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

/* Datos reales enviados por el worker (ver services/api/app/ml/snapshot.py) */
export interface NetLayer {
  name: string;
  type: string;
  activation: string | null;
  units: number;
  shown: number[];
  bias: number[] | null;
  shape?: number[];
}
export interface NetSnapshot {
  epoch: number;
  layers: NetLayer[];
  links: { w: number[][]; aggregated: boolean }[];
  probes: { label: string; target: number; prediction: number[]; acts: number[][] }[];
  task?: string;
  class_names?: string[];
  stats: { max_abs_w: number };
}

const ACT_LABEL: Record<string, string> = {
  relu: "ReLU", sigmoid: "Sigmoid", tanh: "Tanh", softmax: "Softmax", linear: "Lineal",
  elu: "ELU", selu: "SELU", gelu: "GELU", leaky_relu: "Leaky ReLU", swish: "Swish", silu: "Swish",
};
const TYPE_LABEL: Record<string, string> = {
  Input: "Entrada", Dense: "Dense", Conv2D: "Filtros Conv2D", SimpleRNN: "SimpleRNN", LSTM: "LSTM", GRU: "GRU",
};
const POS = "79,209,232";   // señal excitadora (peso × señal > 0)
const NEG = "245,140,90";   // señal inhibidora (peso × señal < 0)

type Node = { x: number; y: number; li: number; ni: number; unit: number };
type Geo = { nodes: Node[][]; W: number; H: number; colX: number[]; headerH: number; headerW: number };
type Particle = { li: number; a: number; b: number; t: number; speed: number; pos: boolean; size: number };
/** Una señal concreta que viaja en la propagación: de la neurona a (capa li) a la b (capa li+1). */
type Signal = { a: number; b: number; c: number; mag: number; delay: number };

/* Línea de tiempo de una pasada hacia adelante (ms, a velocidad 1×) */
const INTRO = 900, STEP = 1700, HOLD = 2600, FADE = 700;

function geometry(s: NetSnapshot, width: number): Geo {
  const maxShown = Math.max(...s.layers.map((l) => l.shown.length));
  const headerH = 74;
  const H = Math.max(420, Math.min(860, maxShown * 24 + headerH + 40));
  const padX = Math.max(70, width * 0.06);
  const n = s.layers.length;
  const colX = s.layers.map((_, i) => padX + (n === 1 ? 0 : (i / (n - 1)) * (width - padX * 2)));
  const nodes = s.layers.map((l, li) => {
    const k = l.shown.length;
    const top = headerH + 26, bottom = H - 26;
    const gap = Math.min(30, (bottom - top) / Math.max(1, k));
    const start = (top + bottom) / 2 - (gap * (k - 1)) / 2;
    return l.shown.map((unit, ni) => ({ x: colX[li], y: start + ni * gap, li, ni, unit }));
  });
  return { nodes, W: width, H, colX, headerH, headerW: 156 };
}

/** Normaliza activaciones por capa a [-1, 1] para el brillo. */
function normActs(acts: number[][]): number[][] {
  return acts.map((row) => {
    const m = Math.max(1e-6, ...row.map((v) => Math.abs(v)));
    return row.map((v) => v / m);
  });
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => (v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2);

function bezierPoint(A: Node, B: Node, t: number) {
  const mx = (A.x + B.x) / 2, u = 1 - t;
  return {
    x: u * u * u * A.x + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * B.x,
    y: u * u * u * A.y + 3 * u * u * t * A.y + 3 * u * t * t * B.y + t * t * t * B.y,
  };
}

function nodeTag(s: NetSnapshot, li: number, unit: number) {
  if (li === 0) return `x${unit + 1}`;
  const name = s.layers[li].name;
  return `${name === "Salida" ? "S" : name}.${unit + 1}`;
}

/** Para cada transición (capa li → li+1): las señales que más aportan a cada neurona destino. */
function buildSignals(s: NetSnapshot, acts: number[][]): Signal[][] {
  return s.links.map((link, li) => {
    const contrib: Signal[] = [];
    const nb = link.w[0]?.length ?? 0;
    for (let b = 0; b < nb; b++) {
      const col = link.w.map((row, a) => ({ a, c: row[b] * (acts[li]?.[a] ?? 0) }));
      col.sort((x, y) => Math.abs(y.c) - Math.abs(x.c));
      col.slice(0, 4).forEach(({ a, c }) => contrib.push({ a, b, c, mag: 0, delay: 0 }));
    }
    const max = Math.max(1e-9, ...contrib.map((x) => Math.abs(x.c)));
    return contrib
      .map((x) => ({ ...x, mag: Math.abs(x.c) / max, delay: (x.a % 7) * 0.035 + Math.random() * 0.05 }))
      .filter((x) => x.mag > 0.03);
  });
}

export default function NetworkLive({ jobId, liveEpoch, running }: { jobId: string; liveEpoch: number | null; running: boolean }) {
  const epochsQ = useQuery({
    queryKey: ["net-epochs", jobId, liveEpoch],
    queryFn: () => api<number[]>(`/training-jobs/${jobId}/network/epochs`),
  });
  const epochs = epochsQ.data ?? [];
  const [follow, setFollow] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [probe, setProbe] = useState(0);
  const [hover, setHover] = useState<{ li: number; ni: number } | null>(null);
  const [pinned, setPinned] = useState<{ li: number; ni: number } | null>(null);
  const [mode, setMode] = useState<"wave" | "flow">("wave");
  const [speed, setSpeed] = useState(1);
  const [phase, setPhase] = useState<{ key: string; step: number }>({ key: "intro", step: 0 });
  const latest = epochs.length ? epochs[epochs.length - 1] : null;
  const epoch = follow ? latest : sel ?? latest;

  const snapQ = useQuery({
    queryKey: ["net", jobId, epoch],
    queryFn: () => api<NetSnapshot>(`/training-jobs/${jobId}/network?epoch=${epoch}`),
    enabled: epoch !== null,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });
  const snap = snapQ.data;

  // Reproducción: recorre las épocas guardadas para ver cómo aprende la red
  useEffect(() => {
    if (!playing || !epochs.length) return;
    const t = setInterval(() => {
      setSel((cur) => {
        const i = epochs.indexOf(cur ?? epochs[0]);
        if (i >= epochs.length - 1) {
          setPlaying(false);
          return cur;
        }
        return epochs[i + 1];
      });
    }, 450);
    return () => clearInterval(t);
  }, [playing, epochs]);

  const baseRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  // Callback ref: el escenario aparece después del estado de carga, así que se observa al montarse
  const roRef = useRef<ResizeObserver | null>(null);
  const wrapRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) return;
    setWidth(Math.max(360, Math.floor(el.clientWidth)));
    roRef.current = new ResizeObserver(([e]) => setWidth(Math.max(360, Math.floor(e.contentRect.width))));
    roRef.current.observe(el);
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);

  const geo = useMemo(() => (snap && width ? geometry(snap, width) : null), [snap, width]);
  const p = snap?.probes[Math.min(probe, (snap?.probes.length ?? 1) - 1)];
  const nActs = useMemo(() => (p ? normActs(p.acts) : []), [p]);
  const signals = useMemo(() => (snap && p ? buildSignals(snap, p.acts) : []), [snap, p]);
  const focus = pinned ?? hover;
  const wave = mode === "wave";

  // Cada muestra nueva arranca una pasada desde la entrada
  const t0 = useRef(performance.now());
  useEffect(() => { t0.current = performance.now(); }, [probe, mode, jobId]);

  /* ---------- capa estática: estructura (conexiones tenues, rótulos, anillos) ---------- */
  useEffect(() => {
    const c = baseRef.current;
    if (!c || !snap || !geo) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = geo.W * dpr;
    c.height = geo.H * dpr;
    c.style.height = `${geo.H}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, geo.W, geo.H);

    if (!wave) {
      // niebla de activación (en modo propagación la dibuja la animación)
      ctx.globalCompositeOperation = "lighter";
      geo.nodes.forEach((col, li) => col.forEach((n, ni) => {
        const a = Math.abs(nActs[li]?.[ni] ?? 0);
        if (a < 0.05) return;
        const r = 70 + a * 60;
        const g = ctx.createRadialGradient(n.x - 30, n.y, 0, n.x - 30, n.y, r);
        g.addColorStop(0, `rgba(40,150,230,${0.10 * a})`);
        g.addColorStop(1, "rgba(40,150,230,0)");
        ctx.fillStyle = g;
        ctx.fillRect(n.x - 30 - r, n.y - r, r * 2, r * 2);
      }));
    }

    // conexiones: color por signo, grosor por |peso|. En propagación quedan tenues (es el "cableado")
    const maxW = Math.max(1e-6, snap.stats.max_abs_w);
    ctx.globalCompositeOperation = "lighter";
    snap.links.forEach((link, li) => {
      const A = geo.nodes[li], B = geo.nodes[li + 1];
      link.w.forEach((row, ai) => row.forEach((w, bi) => {
        const mag = Math.abs(w) / maxW;
        const sig = Math.abs(nActs[li]?.[ai] ?? 0);
        let alpha = wave ? 0.025 + 0.13 * mag : 0.03 + 0.42 * mag * (0.35 + 0.65 * sig);
        if (focus) {
          const on = (focus.li === li && focus.ni === ai) || (focus.li === li + 1 && focus.ni === bi);
          alpha = on ? Math.min(0.95, 0.25 + mag * 0.9) : alpha * 0.4;
        }
        if (alpha < 0.015) return;
        ctx.strokeStyle = w >= 0 ? `rgba(${POS},${alpha})` : `rgba(${NEG},${alpha})`;
        ctx.lineWidth = 0.6 + mag * 2.2;
        ctx.beginPath();
        ctx.moveTo(A[ai].x, A[ai].y);
        ctx.bezierCurveTo((A[ai].x + B[bi].x) / 2, A[ai].y, (A[ai].x + B[bi].x) / 2, B[bi].y, B[bi].x, B[bi].y);
        ctx.stroke();
      }));
    });
    ctx.globalCompositeOperation = "source-over";

    // cabeceras de capa
    snap.layers.forEach((l, li) => {
      const x = geo.colX[li];
      const w = geo.headerW;
      const bx = Math.min(Math.max(4, x - w / 2), geo.W - w - 4);
      ctx.fillStyle = "rgba(8,20,36,0.82)";
      ctx.strokeStyle = "rgba(79,209,232,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, 8, w, geo.headerH - 16, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e2e9f6";
      ctx.font = "600 12.5px 'IBM Plex Mono', monospace";
      ctx.fillText(l.name, bx + 9, 26);
      ctx.fillStyle = "#9fb3d6";
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText(`${l.type === "Conv2D" ? "Filtros" : "Neuronas"}: ${l.units}`, bx + 9, 42);
      ctx.fillText(l.activation ? `Activación: ${ACT_LABEL[l.activation] ?? l.activation}` : TYPE_LABEL[l.type] ?? l.type, bx + 9, 56);
      ctx.strokeStyle = "rgba(79,209,232,0.10)";
      ctx.beginPath();
      ctx.moveTo(x, geo.headerH);
      ctx.lineTo(x, geo.H - 8);
      ctx.stroke();
    });

    // neuronas (en propagación: anillos apagados; el brillo y el valor los pone la animación)
    geo.nodes.forEach((col, li) => {
      const gap = col.length > 1 ? col[1].y - col[0].y : 30;
      col.forEach((n, ni) => {
        const a = nActs[li]?.[ni] ?? 0;
        const raw = p?.acts[li]?.[ni] ?? 0;
        const isFocus = focus && focus.li === li && focus.ni === ni;
        const r = Math.min(7.5, Math.max(4, gap * 0.32));
        if (!wave && Math.abs(a) > 0.05) {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3.2);
          const c = a >= 0 ? POS : NEG;
          g.addColorStop(0, `rgba(${c},${0.55 * Math.abs(a)})`);
          g.addColorStop(1, `rgba(${c},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#06101e";
        ctx.strokeStyle = isFocus ? "#ffffff"
          : wave ? "rgba(120,160,200,0.45)"
          : a >= 0 ? `rgba(150,235,250,${0.55 + 0.45 * Math.abs(a)})` : "rgba(245,160,110,0.9)";
        ctx.lineWidth = isFocus ? 2.4 : 1.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (gap >= 15) {
          ctx.font = "10.5px 'IBM Plex Mono', monospace";
          ctx.textAlign = "right";
          ctx.fillStyle = "rgba(190,210,240,0.85)";
          ctx.fillText(nodeTag(snap, li, n.unit), n.x - r - 5, n.y + 3.5);
          if (!wave) {
            ctx.textAlign = "left";
            ctx.fillStyle = Math.abs(a) > 0.05 ? "#bdf3fc" : "rgba(130,150,185,0.8)";
            ctx.fillText(raw.toFixed(2), n.x + r + 5, n.y + 3.5);
          }
        }
      });
    });
    ctx.textAlign = "left";
  }, [snap, geo, nActs, p, focus, wave]);

  /* ---------- capa animada ---------- */
  useEffect(() => {
    const c = fxRef.current;
    if (!c || !snap || !geo || !p) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = geo.W * dpr;
    c.height = geo.H * dpr;
    c.style.height = `${geo.H}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = snap.layers.length;
    const total = INTRO + (L - 1) * STEP + HOLD + FADE;
    const predIdx = p.prediction.length > 1 ? p.prediction.indexOf(Math.max(...p.prediction)) : -1;
    let lastKey = "";

    const radius = (li: number) => {
      const col = geo.nodes[li];
      const gap = col.length > 1 ? col[1].y - col[0].y : 30;
      return { r: Math.min(7.5, Math.max(4, gap * 0.32)), gap };
    };

    /** Enciende las neuronas de una capa con intensidad g (0..1) y destello de llegada. */
    const drawLayerLit = (li: number, g: number, flash: number) => {
      const { r, gap } = radius(li);
      geo.nodes[li].forEach((n, ni) => {
        const a = (nActs[li]?.[ni] ?? 0) * g;
        const mag = Math.abs(a);
        const col = a >= 0 ? POS : NEG;
        // niebla de la capa
        if (mag > 0.08) {
          const fr = 60 + mag * 50;
          const fg = ctx.createRadialGradient(n.x - 24, n.y, 0, n.x - 24, n.y, fr);
          fg.addColorStop(0, `rgba(40,150,230,${0.09 * mag})`);
          fg.addColorStop(1, "rgba(40,150,230,0)");
          ctx.fillStyle = fg;
          ctx.fillRect(n.x - 24 - fr, n.y - fr, fr * 2, fr * 2);
        }
        if (mag > 0.03) {
          const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3.6);
          halo.addColorStop(0, `rgba(${col},${0.7 * mag})`);
          halo.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 3.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(${a >= 0 ? "190,245,255" : "255,200,160"},${0.25 + 0.6 * mag})`;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 0.62, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = `rgba(${mag > 0.03 ? (a >= 0 ? "170,240,252" : "250,180,130") : "130,160,200"},${0.4 + 0.6 * g})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.stroke();
        // destello: anillo que se expande cuando la señal llega
        if (flash > 0 && flash < 1 && mag > 0.03) {
          ctx.strokeStyle = `rgba(${col},${(1 - flash) * 0.8})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 3 + flash * 14, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (gap >= 15 && g > 0.05) {
          const raw = (p.acts[li]?.[ni] ?? 0) * g;
          ctx.font = "10.5px 'IBM Plex Mono', monospace";
          ctx.textAlign = "left";
          ctx.fillStyle = mag > 0.05 ? `rgba(200,245,255,${g})` : `rgba(130,150,185,${0.8 * g})`;
          ctx.fillText(raw.toFixed(2), n.x + r + 5, n.y + 3.5);
        }
      });
    };

    const drawHeaderGlow = (li: number, alpha: number) => {
      const x = geo.colX[li];
      const bx = Math.min(Math.max(4, x - geo.headerW / 2), geo.W - geo.headerW - 4);
      ctx.strokeStyle = `rgba(245,184,74,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(bx - 1, 7, geo.headerW + 2, geo.headerH - 14, 7);
      ctx.stroke();
    };

    const drawTransition = (li: number, u: number) => {
      const A = geo.nodes[li], B = geo.nodes[li + 1];
      ctx.globalCompositeOperation = "lighter";
      for (const s of signals[li] ?? []) {
        if (focus && !((focus.li === li && focus.ni === s.a) || (focus.li === li + 1 && focus.ni === s.b)) && s.mag < 0.5) continue;
        const v = clamp01((u - s.delay) / 0.78);
        if (v <= 0) continue;
        const col = s.c >= 0 ? POS : NEG;
        // estela: el tramo ya recorrido de la conexión se ilumina
        const pa = A[s.a], pb = B[s.b];
        ctx.strokeStyle = `rgba(${col},${(0.08 + 0.5 * s.mag) * (v < 1 ? 1 : Math.max(0, 1 - (u - 0.95) * 10))})`;
        ctx.lineWidth = 0.8 + s.mag * 2.4;
        ctx.beginPath();
        const steps = 18;
        for (let k = 0; k <= steps; k++) {
          const pt = bezierPoint(pa, pb, (k / steps) * v);
          if (k === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        // la "esfera" de información viajando
        if (v < 1) {
          const pt = bezierPoint(pa, pb, ease(v));
          const sz = 2 + s.mag * 3.5;
          const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, sz * 3);
          g.addColorStop(0, `rgba(${s.c >= 0 ? "210,250,255" : "255,215,180"},0.95)`);
          g.addColorStop(0.35, `rgba(${col},0.6)`);
          g.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, sz * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const drawPrediction = (alpha: number) => {
      const out = geo.nodes[L - 1];
      const targets = predIdx >= 0 ? [predIdx] : out.map((_, i) => i);
      targets.forEach((i) => {
        const n = out[i];
        if (!n) return;
        const { r } = radius(L - 1);
        ctx.strokeStyle = `rgba(245,184,74,${alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = "600 11px 'IBM Plex Sans', sans-serif";
        ctx.fillStyle = `rgba(245,184,74,${alpha})`;
        ctx.textAlign = "right";
        const name = predIdx >= 0 ? (snap.class_names?.[n.unit] ?? `clase ${n.unit + 1}`) : "";
        ctx.fillText(predIdx >= 0 ? `predicción: ${name}` : "salida", n.x - r - 30, n.y - 12);
        ctx.textAlign = "left";
      });
    };

    let parts: Particle[] = [];
    let raf = 0;
    const flowPool = (() => {
      const maxW = Math.max(1e-6, snap.stats.max_abs_w);
      const cands: { li: number; a: number; b: number; s: number; pos: boolean }[] = [];
      snap.links.forEach((link, li) => link.w.forEach((row, a) => row.forEach((w, b) => {
        const s = (Math.abs(w) / maxW) * (0.15 + Math.abs(nActs[li]?.[a] ?? 0));
        if (s > 0.12) cands.push({ li, a, b, s, pos: w >= 0 });
      })));
      return cands.sort((x, y) => y.s - x.s).slice(0, 400);
    })();
    const flowTotal = flowPool.reduce((t, x) => t + x.s, 0);

    const frame = (now: number) => {
      ctx.clearRect(0, 0, geo.W, geo.H);

      if (!wave) {
        // Flujo continuo: muchas señales a la vez, proporcionales a |peso| × activación
        if (flowPool.length && parts.length < (running ? 140 : 80)) {
          for (let k = 0; k < 3; k++) {
            let r = Math.random() * flowTotal;
            const e = flowPool.find((x) => (r -= x.s) <= 0) ?? flowPool[0];
            parts.push({ li: e.li, a: e.a, b: e.b, t: 0, speed: 0.006 + e.s * 0.012, pos: e.pos, size: 1.1 + e.s * 1.3 });
          }
        }
        ctx.globalCompositeOperation = "lighter";
        parts = parts.filter((q) => {
          q.t += q.speed;
          if (q.t >= 1) return false;
          const pt = bezierPoint(geo.nodes[q.li][q.a], geo.nodes[q.li + 1][q.b], q.t);
          const col = q.pos ? "150,235,250" : "250,170,110";
          const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, q.size * 3);
          g.addColorStop(0, `rgba(${col},0.85)`);
          g.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, q.size * 3, 0, Math.PI * 2);
          ctx.fill();
          return true;
        });
        ctx.globalCompositeOperation = "source-over";
        if (!reduce) raf = requestAnimationFrame(frame);
        return;
      }

      // Propagación capa por capa
      const t = reduce ? INTRO + (L - 1) * STEP + 10 : ((now - t0.current) * speed) % total;
      const fade = t > total - FADE ? 1 - (t - (total - FADE)) / FADE : 1;
      const arrival = (li: number) => (li === 0 ? 0 : INTRO + li * STEP - 120);
      for (let li = 0; li < L; li++) {
        const local = (t - arrival(li)) / 420;
        if (local <= 0) continue;
        drawLayerLit(li, clamp01(local) * fade, clamp01((t - arrival(li)) / 700));
      }
      let key = "hold", step = L;
      if (t < INTRO) { key = "intro"; step = 0; }
      else if (t < INTRO + (L - 1) * STEP) {
        const li = Math.floor((t - INTRO) / STEP);
        const u = ((t - INTRO) % STEP) / STEP;
        drawTransition(li, u);
        drawHeaderGlow(li + 1, 0.35 + 0.45 * Math.sin(u * Math.PI));
        key = `t${li}`; step = li + 1;
      } else {
        drawPrediction(0.9 * fade);
      }
      if (key !== lastKey) {
        lastKey = key;
        setPhase({ key, step });
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [snap, geo, nActs, p, signals, focus, running, wave, speed]);

  /* ---------- interacción ---------- */
  const hitTest = (ev: React.MouseEvent) => {
    if (!geo) return null;
    const r = (ev.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const k = geo.W / r.width; // por si el lienzo se muestra escalado
    const x = (ev.clientX - r.left) * k, y = (ev.clientY - r.top) * k;
    let best: { li: number; ni: number; d: number } | null = null;
    geo.nodes.forEach((col, li) => col.forEach((n, ni) => {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < 14 && (!best || d < best.d)) best = { li, ni, d };
    }));
    return best ? { li: (best as { li: number }).li, ni: (best as { ni: number }).ni } : null;
  };

  const info = useMemo(() => {
    if (!snap || !focus || !p) return null;
    const layer = snap.layers[focus.li];
    const unit = layer.shown[focus.ni];
    const incoming = focus.li > 0 ? snap.links[focus.li - 1].w.map((row, ai) => ({ from: snap.layers[focus.li - 1].shown[ai], w: row[focus.ni], act: p.acts[focus.li - 1][ai] })) : [];
    const top = [...incoming].sort((a, b) => Math.abs(b.w * b.act) - Math.abs(a.w * a.act)).slice(0, 4);
    return {
      tag: focus.li === 0 ? `Entrada x${unit + 1}` : `${layer.name}.${unit + 1}`,
      act: p.acts[focus.li][focus.ni],
      bias: layer.bias?.[focus.ni],
      activation: layer.activation,
      top,
      prevName: focus.li > 0 ? snap.layers[focus.li - 1].name : "",
      aggregated: focus.li > 0 && snap.links[focus.li - 1].aggregated,
    };
  }, [snap, focus, p]);

  /* ---------- texto del paso actual ---------- */
  const caption = useMemo(() => {
    if (!snap || !p) return null;
    const L = snap.layers.length;
    const total = L + 1;
    if (phase.key === "intro") {
      const xs = p.acts[0];
      const vals = xs.length <= 4 ? xs.map((v, i) => `x${snap.layers[0].shown[i] + 1} = ${v.toFixed(2)}`).join(" · ") : `${snap.layers[0].units} valores`;
      return { n: 1, total, title: "Entran los datos", text: `La muestra "${p.label}" llega a la capa de entrada: ${vals}.` };
    }
    if (phase.key.startsWith("t")) {
      const li = parseInt(phase.key.slice(1), 10);
      const from = snap.layers[li], to = snap.layers[li + 1];
      const act = to.activation ? ACT_LABEL[to.activation] ?? to.activation : "su función";
      const extra = to.name === "Salida" && to.activation === "softmax" ? " Softmax convierte los resultados en probabilidades que suman 1." : "";
      return {
        n: li + 2, total,
        title: `${from.name} → ${to.name}`,
        text: `Cada neurona de ${to.name} recibe las señales de ${from.name}, las multiplica por sus pesos, suma el sesgo (Σ w·x + b) y aplica ${act}.${extra} Solo se ven las señales que más aportan.`,
      };
    }
    const pred = p.prediction;
    const out = pred.length === 1 ? pred[0].toFixed(3) : `[${pred.map((v) => v.toFixed(2)).join(", ")}]`;
    if (pred.length > 1) {
      const idx = pred.indexOf(Math.max(...pred));
      const name = snap.class_names?.[snap.layers[L - 1].shown[idx]] ?? `clase ${idx + 1}`;
      const ok = name === p.label;
      return { n: total, total, title: ok ? "Resultado · acierta" : "Resultado · se equivoca", ok,
        text: `La red responde ${out}: la probabilidad más alta es "${name}" (${(pred[idx] * 100).toFixed(1)} %). El valor real es "${p.label}".` };
    }
    if (snap.task === "binary") {
      const name = snap.class_names?.[pred[0] >= 0.5 ? 1 : 0] ?? (pred[0] >= 0.5 ? "clase 1" : "clase 0");
      const ok = name === p.label;
      return { n: total, total, title: ok ? "Resultado · acierta" : "Resultado · se equivoca", ok,
        text: `La red responde ${out} (probabilidad de "${snap.class_names?.[1] ?? "clase 1"}"), así que predice "${name}". El valor real es "${p.label}".` };
    }
    return { n: total, total, title: "Resultado", text: `La red responde ${out}. Valor real: ${p.label}.` };
  }, [phase, snap, p]);

  if (epochsQ.isLoading) return <div className="net-empty">Cargando la red…</div>;
  if (!epochs.length)
    return <div className="net-empty">{running ? "La red aparecerá aquí en cuanto el worker la construya…" : "Este entrenamiento no tiene instantáneas de la red (se creó antes de habilitar el visor)."}</div>;

  const idx = epoch !== null ? epochs.indexOf(epoch) : -1;
  const pred = p?.prediction ?? [];
  const lastLayer = snap?.layers[snap.layers.length - 1];
  return (
    <div className="net-live">
      <div className="net-toolbar">
        <button className="btn sm" onClick={() => { if (playing) setPlaying(false); else { setFollow(false); setSel(epochs[0]); setPlaying(true); } }}
          aria-label={playing ? "Pausar reproducción" : "Reproducir aprendizaje"}>
          {playing ? <Pause /> : <Play />}{playing ? "Pausar" : "Ver cómo aprendió"}
        </button>
        <input type="range" min={0} max={Math.max(0, epochs.length - 1)} value={Math.max(0, idx)} aria-label="Época"
          onChange={(e) => { setFollow(false); setPlaying(false); setSel(epochs[parseInt(e.target.value, 10)]); }} style={{ flex: 1, minWidth: 120 }} />
        <span className="num small" style={{ minWidth: 92 }}>{epoch === 0 ? "Pesos iniciales" : `Época ${epoch}`}</span>
        <button className={`btn sm ${follow ? "primary" : ""}`} onClick={() => { setFollow(true); setPlaying(false); }} title="Seguir la última época">
          <Radio />{running ? "En vivo" : "Última"}
        </button>
      </div>

      <div className="net-probes">
        <span className="small muted">Muestra que atraviesa la red:</span>
        {snap?.probes.map((pr, i) => {
          const dup = snap.probes.filter((q) => q.label === pr.label).length > 1;
          const n = snap.probes.slice(0, i + 1).filter((q) => q.label === pr.label).length;
          return (
            <button key={i} className={`chip ${i === probe ? "on" : ""}`} onClick={() => setProbe(i)}>
              {pr.label}{dup ? ` · ${n}` : ""}
            </button>
          );
        })}
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Modo de animación">
          <button className={wave ? "on" : ""} onClick={() => setMode("wave")} title="La información avanza capa por capa"><Zap size={14} />Paso a paso</button>
          <button className={!wave ? "on" : ""} onClick={() => setMode("flow")} title="Todas las señales a la vez"><Waves size={14} />Flujo continuo</button>
        </div>
        {wave && (
          <select className="input" style={{ width: 92, height: 30, fontSize: 13 }} value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} aria-label="Velocidad">
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        )}
      </div>

      {wave && caption && (
        <div className={`net-step ${caption.ok === false ? "bad" : caption.ok ? "good" : ""}`} aria-live="polite">
          <div className="net-step-dots" aria-hidden="true">
            {Array.from({ length: caption.total }, (_, i) => <span key={i} className={i < caption.n ? "on" : ""} />)}
          </div>
          <div>
            <strong>Paso {caption.n} de {caption.total} · {caption.title}</strong>
            <p className="small">{caption.text}</p>
          </div>
        </div>
      )}

      <div ref={wrapRef} className="net-stage">
        <canvas ref={baseRef} className="net-canvas" />
        <canvas ref={fxRef} className="net-canvas fx"
          onMouseMove={(e) => setHover(hitTest(e))} onMouseLeave={() => setHover(null)}
          onClick={(e) => { const h = hitTest(e); setPinned(h && pinned && h.li === pinned.li && h.ni === pinned.ni ? null : h); }} />
        {info && (
          <div className="net-tip">
            <div className="row between"><strong className="num">{info.tag}</strong>{pinned && <span className="xs muted">fijada · clic para soltar</span>}</div>
            <dl className="kv xs mt-s">
              <dt>Activación</dt><dd className="num">{info.act.toFixed(4)}</dd>
              {info.activation && <><dt>Función</dt><dd>{ACT_LABEL[info.activation] ?? info.activation}</dd></>}
              {info.bias !== undefined && info.bias !== null && <><dt>Sesgo b</dt><dd className="num">{info.bias.toFixed(4)}</dd></>}
            </dl>
            {info.top.length > 0 && (
              <>
                <div className="xs muted mt-s">{info.aggregated ? "Conexiones (promedio por canal)" : "Entradas que más aportan (peso × señal)"}</div>
                {info.top.map((t) => (
                  <div key={t.from} className="xs num row between">
                    <span>{info.prevName === "Entrada" ? `x${t.from + 1}` : `${info.prevName}.${t.from + 1}`}</span>
                    <span style={{ color: t.w >= 0 ? "var(--signal)" : "#f8a76a" }}>w={t.w.toFixed(3)}</span>
                    <span className="muted">×{t.act.toFixed(2)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="net-foot">
        <span className="xs muted">
          <span className="swatch" style={{ background: "var(--signal)" }} /> señal que excita
          <span className="swatch" style={{ background: "#f58c5a", marginLeft: 12 }} /> señal que inhibe · grosor = fuerza (peso × señal) · brillo = activación · clic en una neurona para ver su cálculo
        </span>
        {p && lastLayer && (
          <span className="small">
            Real: <strong>{p.label}</strong> · La red responde:{" "}
            <span className="num" style={{ color: "var(--pulse)" }}>
              {pred.length === 1 ? pred[0].toFixed(3) : `[${pred.map((v) => v.toFixed(2)).join(", ")}]`}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
