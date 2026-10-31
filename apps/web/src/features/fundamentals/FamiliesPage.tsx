import { useQuery } from "@tanstack/react-query";
import { useCrumbs } from "../../components/Layout";
import { Badge, ErrorBox, Loading, Panel } from "../../components/ui";
import { api } from "../../lib/api";
import type { Family, FamilyInfo } from "../../types";

const HOW: Record<Family, string> = {
  feedforward: "Cada capa recibe la salida de la anterior y no hay ciclos. Es la base de todo: perceptrón multicapa.",
  rnn: "La salida de un paso vuelve a entrar en el siguiente, así la red “recuerda” lo que vio antes en la secuencia. LSTM y GRU agregan compuertas para recordar más tiempo.",
  cnn: "Pequeños filtros se deslizan por la imagen y comparten pesos; las capas de pooling reducen el tamaño. Detecta bordes, luego formas, luego objetos.",
  gan: "Dos redes compiten: el generador transforma ruido en muestras falsas y el discriminador intenta distinguirlas de las reales. Ambas mejoran juntas.",
};

function Mini({ f }: { f: Family }) {
  const c = "#4fd1e8", a = "#f5b84a";
  return (
    <svg viewBox="0 0 220 90" width="100%" height={90} aria-hidden="true">
      {f === "feedforward" && [20, 45, 70].map((y) => [30, 50, 70].map((y2) => <line key={`${y}${y2}`} x1={40} y1={y} x2={110} y2={y2 - 5} stroke={c} strokeOpacity={.3} />))}
      {f === "feedforward" && <><line x1={110} y1={25} x2={180} y2={45} stroke={c} strokeOpacity={.3} /><line x1={110} y1={65} x2={180} y2={45} stroke={c} strokeOpacity={.3} /><line x1={110} y1={45} x2={180} y2={45} stroke={c} strokeOpacity={.3} />
        {[20, 45, 70].map((y) => <circle key={y} cx={40} cy={y} r={6} fill="#0b1324" stroke={c} />)}{[25, 45, 65].map((y) => <circle key={y} cx={110} cy={y} r={6} fill="#0b1324" stroke={c} />)}<circle cx={180} cy={45} r={7} fill="#0b1324" stroke={a} /></>}
      {f === "rnn" && <>{[40, 90, 140, 190].map((x, i) => <g key={x}><rect x={x - 14} y={30} width={28} height={28} rx={6} fill="#0b1324" stroke={c} />{i < 3 && <path d={`M${x + 14} 44 L${x + 36} 44`} stroke={a} markerEnd="url(#ar)" />}<text x={x} y={78} textAnchor="middle" fontSize={10} fill="#7d8db0">t{i + 1}</text></g>)}
        <defs><marker id="ar" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 6 3 0 6" fill={a} /></marker></defs></>}
      {f === "cnn" && <>{[0, 1, 2].map((k) => <rect key={k} x={20 + k * 6} y={15 + k * 6} width={50} height={50} fill="#0b1324" stroke={c} strokeOpacity={.6} />)}
        <rect x={36} y={30} width={14} height={14} fill="rgba(245,184,74,.25)" stroke={a} /><path d="M80 45 L105 45" stroke={c} />
        {[0, 1, 2, 3].map((k) => <rect key={k} x={110 + k * 5} y={25 + k * 4} width={30} height={30} fill="#0b1324" stroke={c} strokeOpacity={.6} />)}<path d="M160 45 L180 45" stroke={c} /><circle cx={195} cy={45} r={7} fill="#0b1324" stroke={a} /></>}
      {f === "gan" && <><rect x={10} y={30} width={40} height={30} rx={6} fill="#0b1324" stroke="#a78bfa" /><text x={30} y={49} textAnchor="middle" fontSize={10} fill="#c4b5fd">ruido</text>
        <path d="M50 45 L75 45" stroke={c} /><rect x={75} y={25} width={50} height={40} rx={8} fill="#0b1324" stroke={c} /><text x={100} y={49} textAnchor="middle" fontSize={11} fill="#e2e9f6">G</text>
        <path d="M125 45 L150 45" stroke={c} /><rect x={150} y={25} width={50} height={40} rx={8} fill="#0b1324" stroke={a} /><text x={175} y={49} textAnchor="middle" fontSize={11} fill="#e2e9f6">D</text>
        <text x={175} y={82} textAnchor="middle" fontSize={10} fill="#7d8db0">¿real o falso?</text></>}
    </svg>
  );
}

export default function FamiliesPage() {
  useCrumbs([{ label: "Inicio", to: "/" }, { label: "Familias de redes" }]);
  const q = useQuery({ queryKey: ["families"], queryFn: () => api<FamilyInfo[]>("/catalog/families") });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Familias de redes neuronales</h1>
          <p>Cada familia resuelve un tipo de problema distinto y tiene reglas propias. El diseñador valida esas reglas antes de entrenar.</p>
        </div>
      </div>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      <div className="grid g2">
        {q.data?.map((f) => (
          <Panel key={f.key} title={f.label} actions={
            <>
              {f.status !== "ga" && <Badge tone={f.status === "beta" ? "signal" : "pulse"}>{f.status === "beta" ? "Beta" : "Vista previa"}</Badge>}
              <Badge tone={f.training_enabled ? "ok" : "muted"}>{f.training_enabled ? "Entrenable" : "Solo diseño"}</Badge>
            </>}>
            <div className="inset" style={{ padding: 6 }}><Mini f={f.key} /></div>
            <p className="small mt">{HOW[f.key]}</p>
            <div className="grid g2 mt">
              <div>
                <div className="small muted">Casos de uso</div>
                <ul className="small" style={{ paddingLeft: 18, margin: "6px 0 0" }}>{f.use_cases.map((u) => <li key={u}>{u}</li>)}</ul>
              </div>
              <div>
                <div className="small muted">Restricciones</div>
                <ul className="small" style={{ paddingLeft: 18, margin: "6px 0 0" }}>{f.restrictions.map((u) => <li key={u}>{u}</li>)}</ul>
              </div>
            </div>
            <p className="xs faint mt">Capas: {f.layers.join(", ")}</p>
          </Panel>
        ))}
      </div>
    </>
  );
}
