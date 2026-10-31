import { useState, type FormEvent } from "react";
import NeuralField from "../../components/NeuralField";
import { BrandMark } from "../../components/Layout";
import { Alert, Field } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { AUTH_MODE } from "../../lib/supabase";

export default function LoginPage() {
  const { signIn, signUp, error: authError } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "in") await signIn(email, password);
      else {
        const msg = await signUp(email, password, name);
        if (msg) setNotice(msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-visual">
        <NeuralField layers={[4, 7, 9, 9, 6, 3]} density={1.2} />
        <div className="copy">
          <h1>Mira cómo aprende una red neuronal.</h1>
          <p>
            Diseña capas, entrena con TensorFlow/Keras y sigue cada época en vivo. Cada experimento queda versionado y
            auditado.
          </p>
        </div>
      </section>
      <section className="auth-form">
        <div className="row" style={{ gap: 12 }}>
          <BrandMark />
          <div>
            <div className="brand-name">NeuroLab Enterprise</div>
            <div className="brand-sub">Semana 11 · Define la estructura y crea una red neuronal</div>
          </div>
        </div>
        <h2>{mode === "in" ? "Inicia sesión" : "Crea tu cuenta"}</h2>
        {AUTH_MODE === "dev" && (
          <Alert tone="warn">Modo desarrollo: escribe cualquier correo. El primero en entrar será administrador.</Alert>
        )}
        <form onSubmit={submit}>
          {mode === "up" && (
            <Field label="Nombre visible">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
            </Field>
          )}
          <Field label="Correo">
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          {AUTH_MODE === "supabase" && (
            <Field label="Contraseña" hint={mode === "up" ? "Mínimo 8 caracteres" : undefined}>
              <input
                className="input"
                type="password"
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                minLength={mode === "up" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          )}
          {(error || authError) && <Alert tone="err">{error || authError}</Alert>}
          {notice && <Alert tone="ok">{notice}</Alert>}
          <button className="btn primary" disabled={busy} style={{ height: 42 }}>
            {busy ? "Conectando…" : mode === "in" ? "Entrar" : "Crear cuenta"}
          </button>
          {AUTH_MODE === "supabase" && (
            <p className="small muted">
              {mode === "in" ? "¿Aún no tienes cuenta? " : "¿Ya tienes cuenta? "}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === "in" ? "up" : "in"); setError(null); }}>
                {mode === "in" ? "Regístrate" : "Inicia sesión"}
              </a>
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
