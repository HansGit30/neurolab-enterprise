# Despliegue: Supabase + Render + Vercel (+ worker de entrenamiento)

Esta guía deja NeuroLab funcionando en internet. Tiempo estimado: 40–60 minutos la primera vez.

```
Navegador ──► Vercel (React)  ──►  Render (API FastAPI)  ──►  Supabase (PostgreSQL + Auth + Storage)
                    │                                             ▲
                    └──── Supabase Auth (login) ────┘             │
                                     Worker TensorFlow/Keras ─────┘  (toma trabajos de la cola en PostgreSQL)
```

## Antes de empezar: dónde corre TensorFlow

TensorFlow necesita unos **600 MB de RAM** solo para cargarse (medido en este proyecto). Los planes
Free y Starter de Render tienen **512 MB**, así que **el entrenamiento no cabe ahí**. La API sin
TensorFlow ocupa ~90 MB y sí cabe. Por eso hay dos caminos:

| Camino | Dónde corre cada parte | Costo | Recomendado para |
|---|---|---|---|
| **A. Gratis** | API en Render Free · worker en un Space de Hugging Face (CPU básica, 16 GB) | 0 | Demo, curso, evaluación |
| **B. Todo en Render** | API en Render Free · worker como *Background Worker* Standard (2 GB) | de pago | Entorno “empresa” |

Ambos usan exactamente el mismo código: el worker es `python -m app.workers.training`.
(Si prefieres una sola pieza, la API con `EMBEDDED_WORKER=true` en un plan Standard de Render
también entrena dentro del mismo proceso.)

---

## 0. Subir el código a GitHub

```bash
cd neurolab-enterprise
git init && git add . && git commit -m "NeuroLab Enterprise v1"
# crea un repo vacío en github.com (privado está bien) y luego:
git remote add origin https://github.com/<tu-usuario>/neurolab-enterprise.git
git branch -M main && git push -u origin main
```

## 1. Supabase (base de datos, login y archivos)

1. Entra a **supabase.com → New project**. Región cercana (p. ej. *South America (São Paulo)*).
   Guarda la **contraseña de la base de datos**.
2. **SQL Editor → New query** → pega todo el contenido de `infra/migrations/001_init.sql` → **Run**.
   Luego, en otra consulta, ejecuta `infra/migrations/002_network_snapshots.sql` (tabla del visor de red).
   Crea las tablas, activa RLS, crea el bucket privado `neurolab` y el trigger que da el rol
   **administrador al primer usuario que se registre**.
3. Copia estos valores (los usarás después):

| Dato | Dónde está en Supabase | Variable |
|---|---|---|
| Project URL | Project Settings → API (o botón **Connect**) | `SUPABASE_URL` / `VITE_SUPABASE_URL` |
| Clave pública (*publishable* o *anon*) | Project Settings → API Keys | `VITE_SUPABASE_ANON_KEY` (frontend) |
| Clave secreta (*secret* o *service_role*) | Project Settings → API Keys | `SUPABASE_SERVICE_ROLE_KEY` (**solo servidor**) |
| Cadena de conexión | **Connect → Connection string → Session pooler** | `DATABASE_URL` |
| Legacy JWT secret | Project Settings → JWT Keys | `SUPABASE_JWT_SECRET` (ver nota) |

- Usa el **Session pooler** (host `aws-0-<región>.pooler.supabase.com`, puerto **5432**): la conexión
  directa de Supabase es IPv6 y Render no sale por IPv6. Reemplaza `[YOUR-PASSWORD]` por tu
  contraseña; si tiene símbolos (`@`, `#`, `/`…) codifícalos en URL (`@` → `%40`).
- **JWT:** la API acepta los dos formatos de Supabase. Si tu proyecto firma los tokens con el
  secreto compartido (HS256), configura `SUPABASE_JWT_SECRET`. Si usa las nuevas *signing keys*,
  la API las descarga sola de `/auth/v1/.well-known/jwks.json` y esa variable puede quedar vacía.
  Configurarla no estorba.
4. **Authentication → Sign In / Providers → Email**: déjalo habilitado. Para una demo puedes
   desactivar *Confirm email* y así entrar sin revisar el correo.

## 2. Render (API FastAPI)

1. **render.com → New → Blueprint** → conecta el repositorio. Render lee `render.yaml` y crea
   `neurolab-api` (plan Free, carpeta `services/api`, health check en `/health`).
2. Te pedirá las variables marcadas como secretas:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | la del Session pooler |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | clave secreta |
| `SUPABASE_JWT_SECRET` | legacy JWT secret (o vacío si usas signing keys) |
| `CORS_ORIGINS` | por ahora `http://localhost:5173`; en el paso 4 pondrás la URL de Vercel |
| `WORKER_WAKE_URL` | vacío por ahora; en el paso 3 pondrás la URL del Space |

   Ya vienen fijadas: `ENVIRONMENT=production`, `AUTH_MODE=supabase`, `EMBEDDED_WORKER=false`,
   `PYTHON_VERSION=3.12.8`.
3. Al terminar, abre `https://neurolab-api-xxxx.onrender.com/health` → debe responder
   `{"status":"ok"}`. La documentación interactiva queda en `/docs`.

> Render Free “duerme” el servicio tras un rato sin tráfico; la primera petición después puede
> tardar alrededor de un minuto. La interfaz lo avisa si la API no responde.

**Si no usas Blueprint** (servicio creado a mano): *New → Web Service*, Root Directory
`services/api`, Build `pip install -r requirements.txt`, Start
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`, Health Check Path `/health`, y las mismas
variables.

## 3. Worker de entrenamiento (TensorFlow/Keras)

### Camino A · Hugging Face Space (gratis)

1. En tu computadora: `bash infra/huggingface-worker/prepare_space.sh` → crea la carpeta `hf-space/`.
2. **huggingface.co → New Space** → nombre `neurolab-worker`, SDK **Docker** (*Blank*), hardware
   **CPU basic (free)**. Visibilidad: privado está bien.
3. Sube el contenido de `hf-space/` (botón *Files → Upload files*, o `git clone` del Space, copiar
   y `git push`).
4. **Settings → Variables and secrets → New secret** para: `DATABASE_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`. Variable normal: `STORAGE_BUCKET=neurolab`.
5. Espera a que el Space diga **Running**. Su URL pública es
   `https://<usuario>-neurolab-worker.hf.space` y responde `{"status":"ok","worker":"…"}`.
   (Si el Space es privado, usa el botón *Restart* cuando esté dormido; la URL pública solo funciona
   para despertarlo si el Space es público.)
6. Vuelve a Render y pon esa URL en `WORKER_WAKE_URL`: cada vez que alguien encola un
   entrenamiento, la API lo visita para despertar el Space si se había dormido.

### Camino B · Render Background Worker (de pago)

En `render.yaml` descomenta el bloque `type: worker` (plan **standard**, 2 GB), haz push y vuelve
a sincronizar el Blueprint. Copia al worker las mismas `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` y `STORAGE_BUCKET` de la API.

## 4. Vercel (frontend React)

1. **vercel.com → Add New → Project** → importa el repositorio.
2. **Root Directory: `apps/web`** (importante). Framework: *Vite* (se detecta; `vercel.json` ya
   trae build, salida `dist` y reescritura SPA).
3. **Environment Variables**:

| Variable | Valor |
|---|---|
| `VITE_API_URL` | `https://neurolab-api-xxxx.onrender.com` (sin `/` final) |
| `VITE_AUTH_MODE` | `supabase` |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | clave **pública** (nunca la secreta) |

4. **Deploy**. Obtendrás `https://<tu-app>.vercel.app`.

## 5. Conectar las piezas

1. **Render → neurolab-api → Environment**: `CORS_ORIGINS=https://<tu-app>.vercel.app`
   (varias URL separadas por coma, sin `/` final) → *Save* (se redespliega).
2. **Supabase → Authentication → URL Configuration**: *Site URL* =
   `https://<tu-app>.vercel.app` y agrégala también en *Redirect URLs*.
3. Si cambias variables `VITE_*` en Vercel, haz **Redeploy** (se incrustan al compilar).

## 6. Prueba de aceptación del MVP

1. Abre la app en Vercel → **Regístrate**. El primer usuario queda como **Administrador/a**.
2. *Nuevo proyecto* → describe el problema.
3. Pestaña **Dataset** → *Agregar dataset* → “Dos lunas”.
4. **Arquitectura** → *Abrir el diseñador* → Feedforward (viene Dense 16 relu → Dense 8 relu →
   Dense 1 sigmoid) → *Guardar arquitectura* con una justificación.
5. **Entrenamientos** → *Nuevo entrenamiento* → 40 épocas → *Iniciar*.
6. Verás **En cola → Preparando → Ejecutando** con curvas de pérdida y exactitud llegando en vivo,
   la consola del worker y al final la matriz de confusión.
7. Cierra sesión, vuelve a entrar: el entrenamiento y la versión **v1** siguen en **Modelos**.
8. Con un segundo usuario como revisor, márcala *Revisado* y *Aprobado*. Exporta el informe en PDF.

## Problemas frecuentes

| Síntoma | Causa probable y solución |
|---|---|
| “No se pudo contactar la API” | Render dormido (espera ~1 min) o `VITE_API_URL` mal escrita. |
| Error de CORS en la consola del navegador | `CORS_ORIGINS` en Render no coincide exactamente con la URL de Vercel. |
| 401 “Token inválido” | Falta `SUPABASE_JWT_SECRET` (proyecto HS256) o `SUPABASE_URL` incorrecta. |
| Trabajos quedan “En cola” | El worker no está corriendo/dormido: revisa el Space (logs) o el worker de Render. |
| `Network is unreachable` / IPv6 al conectar a la BD | Usaste la conexión directa: cambia a **Session pooler**. |
| “prepared statement already exists” | Usaste el *Transaction pooler* (6543): usa el **Session pooler** (5432). |
| Falla subir CSV o descargar modelo | `SUPABASE_SERVICE_ROLE_KEY` incorrecta o no se creó el bucket (re-ejecuta la migración). |
| 404 al recargar una ruta en Vercel | Root Directory distinto de `apps/web` (no se aplicó `vercel.json`). |

## Seguridad en producción (resumen)

- La clave secreta de Supabase solo vive en Render/worker. El frontend usa la pública.
- RLS activo sin políticas públicas: nadie puede leer tablas con la clave pública; todo pasa por la
  API, que comprueba pertenencia al proyecto y rol en cada petición.
- `AUTH_MODE=dev` está bloqueado cuando `ENVIRONMENT=production`.
- Copias de seguridad: Supabase hace backups diarios en planes de pago; en Free exporta con
  `pg_dump` (ver `docs/operations/README.md`).
