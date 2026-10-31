import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Line, LineChart, ReferenceDot, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useCrumbs } from "../../components/Layout";
import NeuralField from "../../components/NeuralField";
import { Panel } from "../../components/ui";

const ACT: Record<string, { f: (z: number) => number; note: string }> = {
  relu: { f: (z) => Math.max(0, z), note: "Deja pasar lo positivo y anula lo negativo. Rápida y estándar en capas ocultas." },
  sigmoid: { f: (z) => 1 / (1 + Math.exp(-z)), note: "Comprime a (0, 1): útil como probabilidad en la salida binaria." },
  tanh: { f: (z) => Math.tanh(z), note: "Comprime a (−1, 1) y está centrada en cero. Común en recurrentes." },
  linear: { f: (z) => z, note: "No transforma. Se usa en la salida de regresión." },
  leaky_relu: { f: (z) => (z > 0 ? z : 0.2 * z), note: "Como ReLU pero deja una pequeña pendiente negativa (0,2 en Keras) para que ninguna neurona quede apagada para siempre." },
};

const GLOSSARY: [string, string][] = [
  ["Red neuronal artificial", "Modelo compuesto por unidades simples (neuronas) organizadas en capas que aprenden a transformar entradas en salidas ajustando sus pesos a partir de ejemplos."],
  ["Neurona", "Calcula una suma ponderada de sus entradas más un sesgo y aplica una función de activación: y = f(Σ wᵢxᵢ + b)."],
  ["Capa", "Conjunto de neuronas que procesan la misma entrada. Hay capa de entrada, capas ocultas y capa de salida."],
  ["Conexión y peso", "Cada conexión tiene un peso que indica cuánto influye una neurona en la siguiente. Entrenar es encontrar buenos pesos."],
  ["Sesgo (bias)", "Valor que desplaza la suma antes de activar; permite a la neurona activarse aunque todas las entradas sean cero."],
  ["Función de activación", "Introduce no linealidad. Sin ella, apilar capas equivale a una sola transformación lineal."],
  ["Función de pérdida", "Mide qué tan lejos están las predicciones de los valores reales (entropía cruzada para clasificar, MSE para regresión)."],
  ["Retropropagación", "Algoritmo que calcula cuánto contribuye cada peso al error, para corregirlo en la dirección que reduce la pérdida."],
  ["Optimizador", "Regla que actualiza los pesos con esos gradientes: SGD, Adam, RMSprop…"],
  ["Época", "Una pasada completa por todos los datos de entrenamiento."],
  ["Lote (batch)", "Grupo de ejemplos procesados antes de cada actualización de pesos."],
  ["Sobreajuste", "Cuando la red memoriza el entrenamiento y empeora en datos nuevos: la pérdida de validación sube mientras la de entrenamiento baja."],
];

export default function FundamentalsPage() {
  useCrumbs([{ label: "Inicio", to: "/" }, { label: "Fundamentos" }]);
  const [x, setX] = useState([0.8, -0.4, 0.5]);
  const [w, setW] = useState([1.2, 0.7, -0.9]);
  const [b, setB] = useState(0.1);
  const [act, setAct] = useState("relu");
  const z = x.reduce((s, xi, i) => s + xi * w[i], 0) + b;
  const y = ACT[act].f(z);
  const curve = useMemo(() => Array.from({ length: 81 }, (_, i) => {
    const t = -4 + i * 0.1;
    return { z: +t.toFixed(2), y: ACT[act].f(t) };
  }), [act]);

  const slider = (label: string, v: number, set: (n: number) => void, min = -2, max = 2) => (
    <label className="field">
      <span className="row between"><span>{label}</span><span className="num" style={{ color: "var(--ink)" }}>{v.toFixed(2)}</span></span>
      <input type="range" min={min} max={max} step={0.05} value={v} onChange={(e) => set(parseFloat(e.target.value))} />
    </label>
  );

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="hero-strip">
        <NeuralField layers={[3, 5, 5, 2]} density={0.6} />
        <div className="copy">
          <h1>¿Qué es una red neuronal?</h1>
          <p>
            Es un modelo inspirado en el cerebro: muchas unidades simples conectadas en capas que, ajustando la fuerza de sus
            conexiones con ejemplos, aprenden a reconocer patrones. Por eso son la base del deep learning en visión, voz,
            texto y series temporales.
          </p>
        </div>
      </div>

      <Panel title="Laboratorio de una neurona">
        <div className="neuron-lab">
          <div className="stack">
            <p className="small muted">Mueve las entradas, pesos y sesgo. La neurona calcula z = Σ wᵢxᵢ + b y luego y = f(z).</p>
            <div className="grid g2">
              <div className="stack tight">
                {x.map((v, i) => slider(`Entrada x${i + 1}`, v, (n) => setX(x.map((o, k) => (k === i ? n : o)))))}
              </div>
              <div className="stack tight">
                {w.map((v, i) => slider(`Peso w${i + 1}`, v, (n) => setW(w.map((o, k) => (k === i ? n : o)))))}
              </div>
            </div>
            {slider("Sesgo b", b, setB)}
            <label className="field">
              <span>Función de activación</span>
              <select className="input" value={act} onChange={(e) => setAct(e.target.value)}>
                {Object.keys(ACT).map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            <p className="small muted">{ACT[act].note}</p>
          </div>
          <div className="stack">
            <NeuronDiagram x={x} w={w} b={b} y={y} />
            <div className="inset row between">
              <span className="small">z = <span className="num">{z.toFixed(3)}</span></span>
              <span className="small">y = {act}(z) = <span className="num" style={{ color: "var(--pulse)" }}>{y.toFixed(3)}</span></span>
            </div>
            <div className="inset" style={{ padding: 6 }}>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={curve} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
                  <XAxis dataKey="z" type="number" domain={[-4, 4]} stroke="#56668a" fontSize={11} tickLine={false} />
                  <YAxis stroke="#56668a" fontSize={11} tickLine={false} />
                  <Line dataKey="y" stroke="#4fd1e8" dot={false} strokeWidth={2} isAnimationActive={false} />
                  {Math.abs(z) <= 4 && <ReferenceDot x={+z.toFixed(2)} y={y} r={5} fill="#f5b84a" stroke="none" />}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid g3">
        <Panel title="Estructura: capas">
          <p className="small muted">La <strong style={{ color: "var(--ink)" }}>capa de entrada</strong> recibe los datos tal como vienen. Las <strong style={{ color: "var(--ink)" }}>capas ocultas</strong> combinan y transforman esas señales en representaciones cada vez más abstractas. La <strong style={{ color: "var(--ink)" }}>capa de salida</strong> entrega la predicción: una probabilidad, una clase o un número.</p>
        </Panel>
        <Panel title="Cómo aprende">
          <p className="small muted">1) La red predice (propagación hacia adelante). 2) La función de pérdida mide el error. 3) La retropropagación calcula el gradiente de cada peso. 4) El optimizador ajusta los pesos. Repetir por lotes y épocas hasta que la pérdida de validación deje de mejorar.</p>
        </Panel>
        <Panel title="En TensorFlow/Keras">
          <pre className="console" style={{ maxHeight: "none", margin: 0 }}>{`model = keras.Sequential([
  keras.Input(shape=(2,)),
  layers.Dense(16, activation="relu"),
  layers.Dense(1, activation="sigmoid"),
])
model.compile("adam", "binary_crossentropy",
              metrics=["accuracy"])
model.fit(X, y, epochs=40)`}</pre>
        </Panel>
      </div>

      <Panel title="Glosario">
        <dl className="glossary grid g2" style={{ margin: 0, rowGap: 0 }}>
          {GLOSSARY.map(([t, d]) => (
            <div key={t}><dt>{t}</dt><dd>{d}</dd></div>
          ))}
        </dl>
      </Panel>
      <p className="small muted">Siguiente paso: conoce las <Link to="/families">familias de redes</Link> o abre un proyecto y usa el diseñador.</p>
    </div>
  );
}

function NeuronDiagram({ x, w, b, y }: { x: number[]; w: number[]; b: number; y: number }) {
  const ys = [40, 100, 160];
  return (
    <svg viewBox="0 0 360 200" width="100%" role="img" aria-label="Neurona con tres entradas">
      {ys.map((yy, i) => (
        <g key={i}>
          <line x1={50} y1={yy} x2={200} y2={100} stroke={w[i] >= 0 ? "#4fd1e8" : "#f2657a"} strokeWidth={1 + Math.abs(w[i]) * 2.2} strokeOpacity={0.75} />
          <circle cx={40} cy={yy} r={16} fill="#0b1324" stroke="#a78bfa" strokeWidth={1.5} />
          <text x={40} y={yy + 4} textAnchor="middle" fontSize={11} fill="#e2e9f6" fontFamily="IBM Plex Mono">{x[i].toFixed(1)}</text>
          <text x={118} y={(yy + 100) / 2 - 6} textAnchor="middle" fontSize={10.5} fill="#7d8db0" fontFamily="IBM Plex Mono">w{i + 1}={w[i].toFixed(1)}</text>
        </g>
      ))}
      <circle cx={210} cy={100} r={30} fill="#0f1a2e" stroke="#4fd1e8" strokeWidth={2} />
      <text x={210} y={97} textAnchor="middle" fontSize={13} fill="#e2e9f6" fontFamily="IBM Plex Sans">Σ · f</text>
      <text x={210} y={113} textAnchor="middle" fontSize={10} fill="#7d8db0" fontFamily="IBM Plex Mono">b={b.toFixed(2)}</text>
      <line x1={240} y1={100} x2={300} y2={100} stroke="#f5b84a" strokeWidth={2} />
      <circle cx={320} cy={100} r={18} fill="#0b1324" stroke="#f5b84a" strokeWidth={1.8} />
      <text x={320} y={104} textAnchor="middle" fontSize={11} fill="#f5b84a" fontFamily="IBM Plex Mono">{y.toFixed(2)}</text>
    </svg>
  );
}
