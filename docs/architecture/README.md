# Arquitectura

## Componentes

```
USUARIO → REACT (Vercel) ──REST /api/v1──► FASTAPI (Render) ──► POSTGRESQL (Supabase)
             ▲   │                               │  ▲                 ▲
             │   └──── Supabase Auth (JWT) ──────┘  │                 │ cola: training_jobs
             └──── SSE /training-jobs/{id}/events ──┘                 │
                                                   WORKER PYTHON + TENSORFLOW/KERAS
                                                   (embebido o servicio aparte) ──► Supabase Storage
```

- El navegador nunca entrena: solo diseña, encola y observa.
- La API valida, autoriza y persiste. Nunca ejecuta código del usuario.
- El worker toma trabajos `QUEUED` con `SELECT … FOR UPDATE SKIP LOCKED` (varios workers pueden
  convivir), escribe métricas por época, logs y latido (`heartbeat_at`).
- PostgreSQL es la fuente de verdad. El canal SSE solo transmite deltas de lo persistido.

## Decisiones

| Decisión | Motivo |
|---|---|
| Cola en PostgreSQL en vez de Redis/Celery | Menos piezas que operar; Supabase ya está; `SKIP LOCKED` da exclusión segura. Cambiable por Celery/RQ si crece el volumen. |
| SSE sobre `fetch` (no `EventSource`) | Permite enviar el JWT en la cabecera `Authorization` (no en la URL, que queda en logs). |
| SSE lee de la BD cada 1 s y emite solo cambios | Funciona igual con worker embebido o remoto; reconexión exacta con `Last-Event-ID = m<id>.l<id>`; si el canal cae, la UI re-sincroniza por REST. |
| Validación de arquitectura sin TensorFlow | Vista previa instantánea y API liviana (~90 MB). El worker reconstruye con Keras y compara el conteo de parámetros. |
| Datasets subidos se guardan como `.npz` | Se cargan con `allow_pickle=False`: no hay deserialización de código. |
| RLS activado sin políticas | La clave pública del frontend no da acceso a tablas; toda lectura pasa por la API con RBAC. |
| 404 (no 403) para recursos de proyectos ajenos | Evita revelar la existencia de recursos (acceso horizontal). |
| Versiones inmutables + SHA-256 | Trazabilidad: nunca se sobrescribe un modelo publicado. |
| Separación de funciones | Quien entrenó un modelo no puede aprobarlo (salvo admin). |

## Máquina de estados de un entrenamiento

```
QUEUED ──► PREPARING ──► RUNNING ──► COMPLETED
   │            │            ├──────► FAILED     (error controlado + traza técnica protegida)
   └────────────┴────────────┴──────► CANCELLED  (cancelación cooperativa; el worker confirma)
```

Recuperación: si un worker muere, al cabo de 3 min sin latido el trabajo vuelve a `QUEUED`
(máximo 2 intentos) o pasa a `FAILED`.

## Roles

| Global | Puede |
|---|---|
| Administrador | Todo, incluida la administración y cualquier proyecto |
| Responsable de proyecto | Crear proyectos |
| Ingeniero/a, Revisor/a, Lector/a | Lo que su rol en cada proyecto permita |

| En proyecto | Ver | Editar (arquitecturas, datasets, entrenar) | Gestionar (miembros, estado, borrar) | Revisar/aprobar | Auditoría | Exportar |
|---|---|---|---|---|---|---|
| Responsable | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ingeniero/a | ✓ | ✓ | | | | ✓ |
| Revisor/a | ✓ | | | ✓ | ✓ | ✓ |
| Lector/a | ✓ | | | | | |

## Modelo de datos

Tablas: `users`, `projects`, `project_members`, `datasets`, `architectures`, `training_jobs`,
`training_metrics`, `job_logs`, `model_versions`, `audit_events`, `system_settings`.
Definición completa en `infra/migrations/001_init.sql`.

## Desviaciones respecto al documento maestro

- El código del worker vive en `services/api/app/workers/` (comparte modelos y validación con la
  API); `workers/training/` documenta cómo ejecutarlo como servicio independiente.
- GAN se entrena solo con el feature flag `gan_training_enabled` (desactivado por defecto), en línea
  con la “habilitación progresiva” del MVP. RNN y CNN están habilitadas como beta.
- La exportación PDF usa la impresión del navegador sobre el informe (estilos de impresión incluidos).
