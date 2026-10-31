import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Layers, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCrumbs } from "../../components/Layout";
import NetworkGraph from "../../components/NetworkGraph";
import { Alert, Badge, ErrorBox, Field, Loading, Modal, Panel } from "../../components/ui";
import { api } from "../../lib/api";
import { FAMILY_LABEL, canEdit, fmtInt } from "../../lib/format";
import type { ArchConfig, Architecture, Family, FamilyInfo, LayerSpec, ValidationSummary } from "../../types";
import { useProject } from "../projects/ProjectDetailPage";
import { LAYER_HELP, NEW_LAYER, PRESETS, layerMeta } from "./presets";

type Section = "layers" | "generator" | "discriminator";

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function DesignerPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const project = useProject(id);
  useCrumbs([{ label: "Proyectos", to: "/projects" }, { label: project.data?.name ?? "…", to: `/projects/${id}?tab=architectures` }, { label: "Diseñador" }]);

  const families = useQuery({ queryKey: ["families"], queryFn: () => api<FamilyInfo[]>("/catalog/families") });
  const fromId = params.get("from");
  const from = useQuery({ queryKey: ["arch", fromId], queryFn: () => api<Architecture>(`/architectures/${fromId}`), enabled: !!fromId });

  const [family, setFamily] = useState<Family>((params.get("family") as Family) || "feedforward");
  const [config, setConfig] = useState<ArchConfig>(structuredClone(PRESETS[family]));
  const [section, setSection] = useState<Section>("layers");
  const [sel, setSel] = useState<number | null>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (from.data) {
      setFamily(from.data.family);
      setConfig(structuredClone(from.data.config_json));
      setSection(from.data.family === "gan" ? "generator" : "layers");
    }
  }, [from.data]);

  const pickFamily = (f: Family) => {
    setFamily(f);
    setConfig(structuredClone(PRESETS[f]));
    setSection(f === "gan" ? "generator" : "layers");
    setSel(0);
  };

  const debounced = useDebounced(JSON.stringify({ family, config }));
  const validation = useQuery({
    queryKey: ["validate", debounced],
    queryFn: () => api<ValidationSummary>("/architectures/validate", { method: "POST", body: JSON.parse(debounced) }),
    placeholderData: (prev) => prev,
  });
  const v = validation.data;

  const layers: LayerSpec[] = (section === "layers" ? config.layers : config[section]?.layers) ?? [];
  const setLayers = (ls: LayerSpec[]) =>
    setConfig((c) => (section === "layers" ? { ...c, layers: ls } : { ...c, [section]: { layers: ls } }));

  const famInfo = families.data?.find((f) => f.key === family);
  const allowed = famInfo?.layers ?? [];

  // Resumen solo de la sección editada (GAN tiene dos redes)
  const sectionSummary = useMemo<ValidationSummary | null>(() => {
    if (!v) return null;
    if (family !== "gan") return v;
    const prefix = section === "generator" ? "Generador · " : "Discriminador · ";
    return { ...v, layers: v.layers.filter((l) => l.name.startsWith(prefix.toLowerCase()) || l.name.startsWith(prefix)) };
  }, [v, family, section]);
  const graphInput = family === "gan" && section === "generator" ? [config.latent_dim ?? 8] : config.input_shape;

  const errorFor = (i: number) => v?.errors.find((e) => e.includes(`Capa ${i + 1}:`) &&
    (family !== "gan" || e.startsWith(section === "generator" ? "Generador" : "Discriminador")));

  const add = (type: string) => {
    const ls = [...layers];
    const at = sel !== null ? sel + 1 : ls.length;
    const idx = Math.min(at, Math.max(ls.length - 1, 0)); // la salida se mantiene al final
    ls.splice(idx, 0, structuredClone(NEW_LAYER[type]));
    setLayers(ls);
    setSel(idx);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= layers.length) return;
    const ls = [...layers];
    [ls[i], ls[j]] = [ls[j], ls[i]];
    setLayers(ls);
    setSel(j);
  };
  const remove = (i: number) => {
    setLayers(layers.filter((_, k) => k !== i));
    setSel(null);
  };
  const patch = (i: number, p: Partial<LayerSpec>) => setLayers(layers.map((l, k) => (k === i ? { ...l, ...p } : l)));

  if (project.isLoading || families.isLoading) return <Loading />;
  if (project.error) return <ErrorBox error={project.error} />;
  const editable = canEdit(project.data?.my_role);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Diseñador de arquitecturas</h1>
          <p>Elige la familia, apila capas y observa cómo cambian las formas y los parámetros. El servidor valida cada cambio.</p>
        </div>
        {editable && (
          <button className="btn primary" disabled={!v?.valid} onClick={() => setSaving(true)}><Save />Guardar arquitectura</button>
        )}
      </div>

      <div className="grid g4 mb">
        {families.data?.map((f) => (
          <button key={f.key} className={`family-card ${family === f.key ? "sel" : ""}`} onClick={() => pickFamily(f.key)} aria-pressed={family === f.key}>
            <div className="row between">
              <h3>{f.label}</h3>
              {f.status !== "ga" && <Badge tone={f.status === "beta" ? "signal" : "pulse"}>{f.status === "beta" ? "Beta" : "Vista previa"}</Badge>}
            </div>
            <p className="small muted mt-s">{f.summary}</p>
            {!f.training_enabled && <p className="xs mt-s" style={{ color: "var(--pulse)" }}>Entrenamiento deshabilitado por configuración</p>}
          </button>
        ))}
      </div>

      <div className="designer">
        {/* Panel de capas */}
        <Panel title="Capas disponibles" icon={<Layers />}>
          <div className="stack tight">
            {allowed.map((t) => (
              <button key={t} className="palette-item" onClick={() => add(t)} disabled={!editable} title={LAYER_HELP[t]}>
                {t}
                <Plus size={15} />
              </button>
            ))}
          </div>
          <p className="xs faint mt">Se insertan después de la capa seleccionada. La última capa siempre es la de salida.</p>
        </Panel>

        {/* Lienzo central */}
        <div className="stack" style={{ gap: 16 }}>
          <Panel title={family === "gan" ? "Redes de la GAN" : "Estructura"}
            actions={family === "gan" ? (
              <div className="row" style={{ gap: 4 }}>
                {(["generator", "discriminator"] as Section[]).map((s) => (
                  <button key={s} className={`btn sm ${section === s ? "primary" : ""}`} onClick={() => { setSection(s); setSel(0); }}>
                    {s === "generator" ? "Generador" : "Discriminador"}
                  </button>
                ))}
              </div>
            ) : undefined}>
            <div className="grid g2 mb">
              <Field label="Forma de entrada (input_shape)" hint={family === "cnn" ? "alto, ancho, canales" : family === "rnn" ? "pasos, características" : "nº de características"}>
                <input className="input num" disabled={!editable} value={config.input_shape.join(", ")}
                  onChange={(e) => setConfig({ ...config, input_shape: e.target.value.split(",").map((x) => parseInt(x.trim(), 10)).filter((x) => !Number.isNaN(x)) })} />
              </Field>
              {family === "gan" && (
                <Field label="Dimensión latente" hint="Tamaño del ruido aleatorio que recibe el generador">
                  <input className="input num" type="number" min={1} max={256} disabled={!editable} value={config.latent_dim ?? 8}
                    onChange={(e) => setConfig({ ...config, latent_dim: parseInt(e.target.value, 10) || 1 })} />
                </Field>
              )}
            </div>
            <div className="inset" style={{ padding: 8 }}>
              <NetworkGraph inputShape={graphInput} summary={sectionSummary} selected={sel} onSelect={setSel} height={290} />
            </div>
            <div className="stack tight mt">
              {layers.map((l, i) => (
                <div key={i} className={`layer-row ${sel === i ? "sel" : ""} ${errorFor(i) ? "bad" : ""}`} onClick={() => setSel(i)}
                  role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(i)} aria-label={`Capa ${i + 1}: ${l.type}`}>
                  <span className="layer-idx">{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="small">{l.type}{i === layers.length - 1 && <span className="muted"> · salida</span>}</div>
                    <div className="meta">
                      {layerMeta(l)}
                      {sectionSummary?.layers[i] && <> · salida ({sectionSummary.layers[i].output_shape.join("×")}) · {fmtInt(sectionSummary.layers[i].params)} params</>}
                    </div>
                  </div>
                  {editable && (
                    <div className="row" style={{ gap: 2 }}>
                      <button className="btn ghost icon sm" onClick={(e) => { e.stopPropagation(); move(i, -1); }} aria-label="Subir"><ArrowUp /></button>
                      <button className="btn ghost icon sm" onClick={(e) => { e.stopPropagation(); move(i, 1); }} aria-label="Bajar"><ArrowDown /></button>
                      <button className="btn ghost icon sm" onClick={(e) => { e.stopPropagation(); remove(i); }} aria-label="Eliminar"><Trash2 /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Propiedades + resumen */}
        <div className="stack" style={{ gap: 16 }}>
          <Panel title="Propiedades">
            {sel !== null && layers[sel] ? (
              <LayerProps layer={layers[sel]} activations={famInfo?.activations ?? []} disabled={!editable} onChange={(p) => patch(sel, p)} />
            ) : (
              <p className="muted small">Selecciona una capa en el lienzo para editarla.</p>
            )}
          </Panel>
          <Panel title="Resumen">
            {v ? (
              <div className="stack">
                <div className="row between">
                  <div className="readout"><span className="value signal num" style={{ fontSize: 26 }}>{fmtInt(v.total_params)}</span><span className="label">Parámetros totales</span></div>
                  <Badge tone={v.valid ? "ok" : "err"}>{v.valid ? "Válida" : "Con errores"}</Badge>
                </div>
                <dl className="kv">
                  <dt>Entrenables</dt><dd className="num">{fmtInt(v.trainable_params)}</dd>
                  <dt>Salida</dt><dd className="num">{v.output_shape ? `(${v.output_shape.join("×")})` : "—"}</dd>
                  <dt>Familia</dt><dd>{FAMILY_LABEL[family]}</dd>
                </dl>
                {v.errors.length > 0 && <Alert tone="err"><ul style={{ margin: 0, paddingLeft: 16 }}>{v.errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
                {v.warnings.length > 0 && <Alert tone="warn"><ul style={{ margin: 0, paddingLeft: 16 }}>{v.warnings.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
              </div>
            ) : validation.error ? <ErrorBox error={validation.error} /> : <Loading label="Validando…" />}
          </Panel>
          {famInfo && (
            <Panel title="Reglas de esta familia" className="flat">
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                {famInfo.restrictions.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      {saving && (
        <SaveModal family={family} config={config} defaultName={from.data?.name ?? `${FAMILY_LABEL[family]} base`}
          projectId={id!} onClose={() => setSaving(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["architectures", id] });
            qc.invalidateQueries({ queryKey: ["project", id] });
            nav(`/projects/${id}?tab=architectures`);
          }} />
      )}
    </>
  );
}

function LayerProps({ layer, activations, disabled, onChange }: {
  layer: LayerSpec; activations: string[]; disabled: boolean; onChange: (p: Partial<LayerSpec>) => void;
}) {
  const num = (k: keyof LayerSpec, label: string, min: number, max: number, step = 1) => (
    <Field label={label}>
      <input className="input num" type="number" min={min} max={max} step={step} disabled={disabled}
        value={(layer[k] as number) ?? ""} onChange={(e) => onChange({ [k]: step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10) } as Partial<LayerSpec>)} />
    </Field>
  );
  return (
    <div className="stack">
      <p className="small muted">{LAYER_HELP[layer.type]}</p>
      {"units" in layer && num("units", "Unidades (neuronas)", 1, 1024)}
      {"filters" in layer && num("filters", "Filtros", 1, 512)}
      {"kernel_size" in layer && num("kernel_size", "Tamaño de kernel", 1, 11)}
      {layer.type === "Conv2D" && num("strides", "Paso (strides)", 1, 4)}
      {"pool_size" in layer && num("pool_size", "Tamaño de ventana", 1, 8)}
      {"rate" in layer && num("rate", "Tasa de dropout", 0, 0.9, 0.05)}
      {"padding" in layer && (
        <Field label="Relleno (padding)">
          <select className="input" disabled={disabled} value={layer.padding} onChange={(e) => onChange({ padding: e.target.value as "same" | "valid" })}>
            <option value="same">same · conserva tamaño</option>
            <option value="valid">valid · sin relleno</option>
          </select>
        </Field>
      )}
      {["Dense", "Conv2D", "SimpleRNN", "LSTM", "GRU"].includes(layer.type) && (
        <Field label="Función de activación">
          <select className="input" disabled={disabled} value={layer.activation ?? (layer.type === "Dense" ? "linear" : "tanh")}
            onChange={(e) => onChange({ activation: e.target.value })}>
            {activations.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
      )}
      {"return_sequences" in layer && (
        <label className="check">
          <input type="checkbox" disabled={disabled} checked={!!layer.return_sequences} onChange={(e) => onChange({ return_sequences: e.target.checked })} />
          Devolver la secuencia completa (para apilar otra recurrente)
        </label>
      )}
    </div>
  );
}

function SaveModal({ family, config, defaultName, projectId, onClose, onSaved }: {
  family: Family; config: ArchConfig; defaultName: string; projectId: string; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [justification, setJustification] = useState("");
  const m = useMutation({
    mutationFn: () => api<Architecture>(`/projects/${projectId}/architectures`, { method: "POST", body: { name, family, config, justification } }),
    onSuccess: onSaved,
  });
  return (
    <Modal title="Guardar arquitectura" subtitle="Si el nombre ya existe en el proyecto se crea una nueva versión; las anteriores no se modifican." onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Nombre"><input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="¿Por qué esta familia y esta estructura?" hint="Queda registrado como evidencia de la decisión.">
          <textarea className="input" value={justification} onChange={(e) => setJustification(e.target.value)} />
        </Field>
        <ErrorBox error={m.error} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={m.isPending}>Guardar</button>
        </div>
      </form>
    </Modal>
  );
}
