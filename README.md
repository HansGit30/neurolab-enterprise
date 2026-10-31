# NeuroLab Enterprise

Plataforma web para **diseñar, entrenar, evaluar, versionar y auditar redes neuronales** con
TensorFlow/Keras. Implementa el *Documento Maestro de Desarrollo* (Semana 11 · “Define la
estructura y crea una red neuronal artificial”).

- **Frontend:** React 19 + Vite + TypeScript + TanStack Query + Recharts (`apps/web`)
- **API:** Python + FastAPI, REST versionado `/api/v1`, OpenAPI en `/docs` (`services/api`)
- **Worker:** TensorFlow/Keras en proceso aislado, cola en PostgreSQL con `FOR UPDATE SKIP LOCKED`
- **Datos:** PostgreSQL (Supabase) + Supabase Storage (datasets `.npz`, modelos `.keras`)
- **Auth:** Supabase Auth (JWT verificado en la API) + RBAC global y por proyecto
- **Tiempo real:** Server-Sent Events autenticados, con reconexión por `Last-Event-ID`
- **Visor de red en vivo:** pesos y activaciones reales leídos del modelo Keras por época, reproducibles

👉 **Para publicarlo:** [DEPLOY.md](DEPLOY.md) (Supabase + Render + Vercel + worker).

## Ejecutar en local (5 minutos, sin Supabase)

```bash
# API + worker embebido, SQLite y login de desarrollo
cd services/api
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                      # AUTH_MODE=dev, SQLite, CREATE_TABLES=true
uvicorn app.main:app --reload --port 8000

# Frontend (otra terminal)
cd apps/web
cp .env.example .env                                      # VITE_AUTH_MODE=dev
npm install && npm run dev                                # http://localhost:5173
```

En modo desarrollo se entra solo con un correo; el primero es administrador.
Alternativa con PostgreSQL en Docker: `docker compose -f infra/docker/docker-compose.yml up --build`.

## Pruebas

```bash
cd services/api && pytest -q                       # SQLite
TEST_DATABASE_URL=postgresql://... pytest -q        # contra PostgreSQL con la migración aplicada
cd apps/web && npm run build                        # chequeo de tipos + build
```

La suite cubre: validación de arquitecturas por familia (formas y conteo de parámetros), flujo
end-to-end real con TensorFlow (proyecto → dataset → arquitectura → entrenamiento → métricas → SSE →
versión → descarga → revisión/aprobación → auditoría → CSV), cancelación, acceso horizontal
(un usuario ajeno recibe 404), roles de proyecto, y entrenamiento real de RNN, CNN y GAN.

## Estructura

```
apps/web/src/
  app/            router y proveedores
  components/     layout, UI, gráficos, grafo de red, campo neuronal animado
  features/       dashboard, projects, fundamentals, architectures, datasets, training,
                  evaluation, model-registry, reports, administration, auth
  hooks/ lib/ types/ styles/
services/api/app/
  api/v1/         endpoints REST + SSE
  core/           config, auth (JWT Supabase + RBAC), db, logging, rate limit
  modules/        validación de arquitecturas, storage, auditoría, configuración
  ml/             datasets demo + CSV, construcción de modelos Keras
  workers/        worker de entrenamiento (embebido o independiente)
  schemas/        contratos Pydantic
infra/            migraciones SQL, docker-compose, worker para Hugging Face
docs/             arquitectura, API, operación, manual de usuario
```

## Módulos implementados (M01–M10)

| Módulo | Dónde |
|---|---|
| M01 Dashboard | Indicadores, trabajos recientes, actividad 14 días, alertas |
| M02 Proyectos | Listado/búsqueda/filtros, crear/editar, miembros y roles, documentación, etiquetas |
| M03 Fundamentos | Laboratorio interactivo de una neurona, capas, aprendizaje, glosario, código Keras |
| M04 Diseñador | Familias Feedforward/RNN/CNN/GAN, editor de capas, validación de formas en servidor, grafo, resumen de parámetros, versionado |
| M05 Datasets | 8 datasets demo sintéticos + carga CSV validada, división train/val/test, versionado, borrado seguro |
| M06 Entrenamientos | Épocas, batch, optimizador, lr, semilla, early stopping, cola con prioridad, cancelar, reintentar, progreso en vivo, **visor de la red con pesos y activaciones reales** |
| M07 Evaluación | Curvas por época, evaluación final, matriz de confusión, R², comparación de ejecuciones |
| M08 Registro de modelos | Versiones inmutables con SHA-256, borrador → revisado → aprobado → retirado, descarga autorizada |
| M09 Reportes | Ficha e informe imprimible a PDF, exportación CSV de historial y métricas |
| M10 Administración | Usuarios y roles, auditoría global, límites de recursos, feature flags por familia, retención, salud |

Más detalle en [docs/architecture/README.md](docs/architecture/README.md).
