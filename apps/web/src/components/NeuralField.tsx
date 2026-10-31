import { useEffect, useRef } from "react";

/**
 * Campo neuronal animado: capas de neuronas con señales que viajan por las conexiones.
 * Es el "globo" de este observatorio. Respeta prefers-reduced-motion (se dibuja estático).
 */
export default function NeuralField({ layers = [5, 8, 9, 7, 4], density = 1, className }: {
  layers?: number[];
  density?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0, h = 0, dpr = 1;
    type Node = { x: number; y: number; bx: number; by: number; phase: number; act: number; layer: number };
    type Pulse = { from: Node; to: Node; t: number; speed: number; amber: boolean };
    let nodes: Node[][] = [];
    let pulses: Pulse[] = [];

    const build = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const padX = w * 0.08, padY = h * 0.14;
      nodes = layers.map((n, li) => {
        const x = padX + (li / (layers.length - 1)) * (w - padX * 2);
        return Array.from({ length: n }, (_, i) => {
          const y = padY + ((i + 0.5) / n) * (h - padY * 2);
          return { x, y, bx: x, by: y, phase: Math.random() * Math.PI * 2, act: 0, layer: li };
        });
      });
      pulses = [];
    };

    const spawn = () => {
      const li = Math.floor(Math.random() * (nodes.length - 1));
      const from = nodes[li][Math.floor(Math.random() * nodes[li].length)];
      const to = nodes[li + 1][Math.floor(Math.random() * nodes[li + 1].length)];
      pulses.push({ from, to, t: 0, speed: 0.008 + Math.random() * 0.012, amber: Math.random() < 0.18 });
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      // posición con deriva suave
      for (const col of nodes) for (const n of col) {
        n.x = n.bx + Math.sin(time / 2600 + n.phase) * 4;
        n.y = n.by + Math.cos(time / 3100 + n.phase) * 5;
        n.act *= 0.96;
      }
      // conexiones
      ctx.lineWidth = 1;
      for (let li = 0; li < nodes.length - 1; li++) {
        for (const a of nodes[li]) for (const b of nodes[li + 1]) {
          const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          g.addColorStop(0, `rgba(79,209,232,${0.05 + a.act * 0.25})`);
          g.addColorStop(1, `rgba(79,209,232,${0.05 + b.act * 0.25})`);
          ctx.strokeStyle = g;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      // señales
      if (!reduce && pulses.length < 26 * density && Math.random() < 0.35 * density) spawn();
      pulses = pulses.filter((p) => {
        p.t += p.speed;
        if (p.t >= 1) {
          p.to.act = Math.min(1, p.to.act + 0.8);
          if (p.to.layer < nodes.length - 1 && Math.random() < 0.55) {
            const nxt = nodes[p.to.layer + 1];
            pulses.push({ from: p.to, to: nxt[Math.floor(Math.random() * nxt.length)], t: 0, speed: p.speed, amber: p.amber });
          }
          return false;
        }
        const x = p.from.x + (p.to.x - p.from.x) * p.t;
        const y = p.from.y + (p.to.y - p.from.y) * p.t;
        const c = p.amber ? "245,184,74" : "122,226,242";
        const rg = ctx.createRadialGradient(x, y, 0, x, y, 9);
        rg.addColorStop(0, `rgba(${c},0.95)`);
        rg.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });
      // neuronas
      for (const col of nodes) for (const n of col) {
        const r = 3.2 + n.act * 3;
        if (n.act > 0.05) {
          const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 18);
          halo.addColorStop(0, `rgba(79,209,232,${0.35 * n.act})`);
          halo.addColorStop(1, "rgba(79,209,232,0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 18, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#0b1324";
        ctx.strokeStyle = `rgba(122,226,242,${0.55 + n.act * 0.45})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    build();
    if (reduce) {
      nodes.flat().forEach((n, i) => (n.act = i % 4 === 0 ? 0.6 : 0));
      draw(0);
    } else raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => {
      build();
      if (reduce) draw(0);
    });
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [layers.join(","), density]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
