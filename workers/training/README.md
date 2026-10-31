# Worker de entrenamiento

El código vive en `services/api/app/workers/training.py` porque comparte el modelo de datos, la
validación y el acceso a Storage con la API. Este directorio documenta cómo ejecutarlo aparte.

```bash
cd services/api
pip install -r requirements-worker.txt
export DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... STORAGE_BUCKET=neurolab
python -m app.workers.training          # con PORT definido expone además un /health mínimo
```

Docker: `docker build --build-arg REQS=requirements-worker.txt -t neurolab-worker services/api`
y `docker run -e ROLE=worker -e DATABASE_URL=... neurolab-worker`.

Hugging Face Space: `bash infra/huggingface-worker/prepare_space.sh` (ver `DEPLOY.md`).

Garantías: un trabajo por worker a la vez, toma atómica de la cola, métricas y latido por época,
cancelación cooperativa, timeout configurable, recuperación de trabajos huérfanos con reintento
controlado, `allow_pickle=False` al cargar datos, y `keras.backend.clear_session()` entre trabajos.
