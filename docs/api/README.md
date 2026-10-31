# API v1

Documentación interactiva generada desde el código: `GET /docs` (Swagger) y `GET /openapi.json`.
Todas las rutas (salvo `/health`) exigen `Authorization: Bearer <access_token de Supabase>`.

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Salud (sin auth) |
| GET/PATCH | `/api/v1/me` | Perfil |
| GET | `/api/v1/dashboard` | Indicadores del inicio |
| GET/POST | `/api/v1/projects` | Listar (q, status, tag) / crear |
| GET/PATCH | `/api/v1/projects/{id}` | Detalle / editar |
| GET/POST | `/api/v1/projects/{id}/members` | Miembros / asignar rol por correo |
| DELETE | `/api/v1/projects/{id}/members/{user_id}` | Quitar miembro |
| GET | `/api/v1/catalog/families` | Familias, capas, activaciones, flags |
| POST | `/api/v1/architectures/validate` | Validar configuración (formas, parámetros) |
| GET/POST | `/api/v1/projects/{id}/architectures` | Listar / crear versión validada |
| GET | `/api/v1/catalog/datasets` | Datasets demo |
| GET | `/api/v1/projects/{id}/datasets` | Listar |
| POST | `/api/v1/projects/{id}/datasets/builtin` | Registrar demo |
| POST | `/api/v1/projects/{id}/datasets/upload` | Subir CSV (multipart) |
| GET | `/api/v1/datasets/{id}/preview` | Vista previa |
| DELETE | `/api/v1/datasets/{id}` | Borrado seguro |
| POST | `/api/v1/projects/{id}/training-jobs` | Encolar → devuelve `job_id` |
| GET | `/api/v1/training-jobs?project_id&status` | Listar |
| GET | `/api/v1/training-jobs/{id}` | Estado persistido |
| GET | `/api/v1/training-jobs/{id}/metrics` · `/logs` | Métricas por época · logs |
| POST | `/api/v1/training-jobs/{id}/cancel` · `/retry` | Cancelar · reintentar |
| GET | `/api/v1/training-jobs/{id}/events` | **SSE**: `snapshot`, `metrics`, `logs`, `end` |
| GET | `/api/v1/projects/{id}/models` | Versiones |
| POST | `/api/v1/models/{id}/status` | Revisar / aprobar / retirar |
| GET | `/api/v1/models/{id}/download` | Descargar `.keras` (cabecera `X-Checksum-SHA256`) |
| GET | `/api/v1/projects/{id}/audit-events` | Auditoría del proyecto |
| GET | `/api/v1/projects/{id}/report` | Informe |
| GET | `/api/v1/projects/{id}/export/jobs.csv` | Historial CSV |
| GET | `/api/v1/training-jobs/{id}/export/metrics.csv` | Métricas CSV |
| GET/PATCH | `/api/v1/admin/users[/{id}]` | Usuarios y roles (admin) |
| GET/PUT | `/api/v1/admin/settings[/{key}]` | Límites, flags, retención, registro (admin) |
| POST | `/api/v1/admin/retention/run` | Aplicar retención (admin) |
| GET | `/api/v1/admin/audit-events` · `/admin/health` | Auditoría global · salud (admin) |

## Contrato del canal SSE

```
retry: 3000

id: m120.l45
event: metrics
data: [{"id":120,"epoch":12,"metric_name":"val_loss","metric_value":0.31}]

id: m120.l45
event: snapshot
data: {"status":"RUNNING","progress":30.0,"current_epoch":12,"total_epochs":40,...}

event: end
data: {"status":"COMPLETED"}
```

Errores: `{"detail": "mensaje"}` o `{"detail": {"message": "...", "errors": ["..."]}}` (422).
