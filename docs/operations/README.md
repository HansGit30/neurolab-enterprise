# Operación

## Entornos

| Entorno | Base de datos | Auth | Worker |
|---|---|---|---|
| dev | SQLite o Postgres en Docker | `AUTH_MODE=dev` | embebido |
| test | SQLite / Postgres de CI | dev | invocado por la prueba |
| prod | Supabase (Session pooler) | Supabase JWT | Hugging Face Space o Render worker |

Recomendado: un proyecto Supabase por entorno (dev/prod) y ramas `develop` → Preview de Vercel,
`main` → producción.

## Monitoreo

- **Salud:** `GET /health` (Render lo usa como health check). Panel *Administración → Salud del
  sistema*: latencia de BD, almacenamiento, cola y último latido del worker.
- **Logs estructurados (JSON)** en stdout: cada petición con método, ruta, estado y duración. Los
  tokens y contraseñas se enmascaran. Consulta: Render → Logs; Hugging Face → Logs del Space.
- **Alertas sugeridas:** trabajos en `QUEUED` más de 10 min (worker caído), tasa de 5xx > 1 %,
  último latido > 5 min con trabajos activos.

## Copias de seguridad

```bash
# Respaldo lógico completo (usa la cadena del Session pooler)
pg_dump "$DATABASE_URL" --no-owner --format=custom -f neurolab_$(date +%F).dump
# Restaurar en otro proyecto
pg_restore --no-owner -d "$DATABASE_URL_DESTINO" neurolab_2026-10-27.dump
```

Los objetos de Storage (modelos/datasets) se respaldan aparte (Supabase → Storage → descarga, o la
API de Storage). Prueba la restauración al menos una vez por trimestre.

## Retención

Configurable en *Administración → Configuración → Retención* (`audit_days`, `logs_days`). El botón
“Aplicar retención ahora” borra eventos más antiguos y queda auditado. Puede programarse con un
cron de Render que llame a `POST /api/v1/admin/retention/run` con un token de administrador.

## Límites de recursos

*Administración → Configuración → Límites*: épocas, batch, trabajos activos por usuario, tamaño de
CSV, duración máxima (timeout cooperativo), capas y unidades por capa. Familias habilitadas: flags
`rnn_training_enabled`, `cnn_training_enabled`, `gan_training_enabled`.

## Escalar

- Más workers: levanta otra instancia del worker; `SKIP LOCKED` reparte los trabajos.
- GPU: usa una imagen `tensorflow` con CUDA en el worker; no cambia nada en la API.
- Rate limit en memoria por instancia: con varias instancias de la API muévelo a Redis.
