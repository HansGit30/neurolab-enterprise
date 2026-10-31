"""Worker de entrenamiento TensorFlow/Keras.

- Toma trabajos QUEUED de PostgreSQL (SELECT ... FOR UPDATE SKIP LOCKED).
- Sigue la máquina de estados QUEUED → PREPARING → RUNNING → COMPLETED/FAILED/CANCELLED.
- Persiste métricas por época, logs y latido (heartbeat): la UI se recupera tras reconexión.
- Cancelación cooperativa: la API marca cancel_requested; el worker confirma el estado final.
- Puede correr embebido en la API (hilo) o como proceso aparte: `python -m app.workers.training`.
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import tempfile
import threading
import time
import traceback
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy import func, select, update

from ..core.config import get_settings
from ..core.db import session_scope
from ..models import Architecture, Dataset, JobLog, ModelVersion, NetworkSnapshot, TrainingJob, TrainingMetric
from ..modules import storage
from ..modules.audit import audit
from ..modules.settings_store import get_setting
from ..ml import datasets as ds
from ..ml.builder import build_optimizer, build_sequential, loss_and_metrics
from ..ml import snapshot as snap

log = logging.getLogger("neurolab.worker")
settings = get_settings()
WORKER_ID = f"worker-{uuid.uuid4().hex[:6]}"
STALE_AFTER = timedelta(minutes=3)
MAX_ATTEMPTS = 2


class Cancelled(Exception):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ----------------------------------------------------------------------------- persistence helpers
def job_log(job_id: uuid.UUID, message: str, level: str = "info") -> None:
    with session_scope() as db:
        db.add(JobLog(job_id=job_id, level=level, message=message[:4000]))


def set_job(job_id: uuid.UUID, **fields) -> None:
    with session_scope() as db:
        db.execute(update(TrainingJob).where(TrainingJob.id == job_id).values(**fields))


def cancel_requested(job_id: uuid.UUID) -> bool:
    with session_scope() as db:
        return bool(db.scalar(select(TrainingJob.cancel_requested).where(TrainingJob.id == job_id)))


def claim_next_job() -> uuid.UUID | None:
    with session_scope() as db:
        q = (select(TrainingJob).where(TrainingJob.status == "QUEUED")
             .order_by(TrainingJob.priority.desc(), TrainingJob.created_at).limit(1))
        if db.bind.dialect.name == "postgresql":
            q = q.with_for_update(skip_locked=True)
        job = db.scalars(q).first()
        if job is None:
            return None
        if job.cancel_requested:
            job.status, job.ended_at = "CANCELLED", utcnow()
            job.cancel_reason = job.cancel_reason or "Cancelado antes de iniciar"
            return None
        job.status = "PREPARING"
        job.attempts += 1
        job.started_at = utcnow()
        job.heartbeat_at = utcnow()
        return job.id


def recover_stale_jobs() -> int:
    """Trabajos huérfanos por reinicio de worker: reintento controlado o FAILED."""
    n = 0
    with session_scope() as db:
        rows = db.scalars(select(TrainingJob).where(TrainingJob.status.in_(("PREPARING", "RUNNING")))).all()
        for job in rows:
            hb = _aware(job.heartbeat_at) or _aware(job.started_at) or _aware(job.created_at)
            if hb and utcnow() - hb < STALE_AFTER:
                continue
            n += 1
            if job.attempts < MAX_ATTEMPTS and not job.cancel_requested:
                job.status, job.progress, job.current_epoch = "QUEUED", 0, 0
                db.add(JobLog(job_id=job.id, level="warning",
                              message="Worker interrumpido: el trabajo vuelve a la cola (reintento controlado)"))
            else:
                job.status, job.ended_at = "FAILED", utcnow()
                job.error_message = "El worker se detuvo durante la ejecución y se agotaron los reintentos"
    return n


# ----------------------------------------------------------------------------- data
def load_arrays(dataset: Dataset, seed: int):
    meta = dataset.metadata_json or {}
    if meta.get("kind") == "builtin":
        return ds.load_builtin(meta["generator"], int(meta.get("n_samples", 1000)), seed=int(meta.get("seed", 42)))
    raw = storage.get_object(dataset.storage_key)
    with np.load(io.BytesIO(raw), allow_pickle=False) as npz:  # allow_pickle=False: sin ejecución de código
        return npz["X"].astype("float32"), npz["y"].astype("float32")


# ----------------------------------------------------------------------------- visor de red
class SnapshotRecorder:
    """Guarda pesos y activaciones reales en ciertas épocas. Nunca hace fallar el entrenamiento."""

    def __init__(self, job_id, model, Xp, yp, meta, total_epochs, input_label="Entrada"):
        self.job_id, self.model, self.Xp, self.yp, self.meta = job_id, model, Xp, yp, meta
        self.epochs = snap.snapshot_epochs(total_epochs) | {0}
        self.input_label = input_label
        self.saved: set[int] = set()
        self.failed = False

    def maybe(self, epoch: int, force: bool = False) -> None:
        if self.failed or epoch in self.saved or (not force and epoch not in self.epochs):
            return
        try:
            data = snap.build_snapshot(self.model, self.Xp, self.yp, self.meta, epoch, self.input_label)
            with session_scope() as db:
                db.add(NetworkSnapshot(job_id=self.job_id, epoch=epoch, data=data))
            self.saved.add(epoch)
        except Exception as exc:  # la visualización es secundaria
            self.failed = True
            log.warning("snapshot desactivado para %s: %s", self.job_id, exc)
            job_log(self.job_id, f"Visor de red no disponible para esta arquitectura ({type(exc).__name__})", "warning")


# ----------------------------------------------------------------------------- training
def _progress_callback(job_id: uuid.UUID, total_epochs: int, deadline: float, recorder: "SnapshotRecorder | None" = None):
    import keras

    class ProgressCallback(keras.callbacks.Callback):
        def __init__(self):
            super().__init__()
            self.last_check = time.monotonic()
            self.cancelled = False

        def _check(self):
            if time.monotonic() > deadline:
                raise TimeoutError("Se superó la duración máxima configurada para el trabajo")
            if cancel_requested(job_id):
                self.cancelled = True
                self.model.stop_training = True

        def on_train_batch_end(self, batch, logs=None):
            if time.monotonic() - self.last_check > 2:
                self.last_check = time.monotonic()
                self._check()

        def on_epoch_end(self, epoch, logs=None):
            logs = logs or {}
            e = epoch + 1
            with session_scope() as db:
                for k, v in logs.items():
                    if v is not None and np.isfinite(float(v)):
                        db.add(TrainingMetric(job_id=job_id, epoch=e, metric_name=k, metric_value=float(v)))
                db.execute(update(TrainingJob).where(TrainingJob.id == job_id).values(
                    current_epoch=e, progress=round(e / total_epochs * 100, 2), heartbeat_at=utcnow()))
                parts = " · ".join(f"{k}={float(v):.4f}" for k, v in logs.items() if v is not None)
                db.add(JobLog(job_id=job_id, message=f"Época {e}/{total_epochs} · {parts}"))
            if recorder:
                recorder.maybe(e)
            self.last_epoch = e
            self._check()

        def on_train_end(self, logs=None):
            if recorder and getattr(self, "last_epoch", 0):
                recorder.maybe(self.last_epoch, force=True)  # p. ej. si early stopping cortó antes

    return ProgressCallback()


def _train_supervised(job, arch, meta, X, y, params, deadline):
    import keras

    seed = int(params.get("seed", 42))
    keras.utils.set_random_seed(seed)
    (Xtr, ytr), (Xva, yva), (Xte, yte) = ds.split(X, y, meta.get("splits", {}), seed)
    cfg = arch.config_json
    model = build_sequential(cfg["input_shape"], cfg["layers"], name=f"neurolab_{arch.family}")
    out_units = int(cfg["layers"][-1]["units"])
    loss, metrics = loss_and_metrics(meta["task"], out_units, cfg["layers"][-1].get("activation", "linear"))
    model.compile(optimizer=build_optimizer(params["optimizer"], float(params["learning_rate"])),
                  loss=loss, metrics=metrics)
    expected = (arch.summary_json or {}).get("total_params")
    real = int(model.count_params())
    job_log(job.id, f"Modelo construido · {real:,} parámetros · pérdida={loss} · optimizador={params['optimizer']}")
    if expected is not None and expected != real:
        job_log(job.id, f"Aviso: el conteo previo ({expected}) difiere del real ({real})", "warning")
    job_log(job.id, f"Datos: train={len(Xtr)} · validación={len(Xva)} · prueba={len(Xte)}")

    Xp, yp = snap.pick_probes(Xte, yte, meta, seed)
    recorder = SnapshotRecorder(job.id, model, Xp, yp, meta, int(params["epochs"]))
    recorder.maybe(0)  # pesos aleatorios iniciales: "antes de aprender"
    set_job(job.id, status="RUNNING", heartbeat_at=utcnow())
    cb = _progress_callback(job.id, int(params["epochs"]), deadline, recorder)
    callbacks = [cb]
    if params.get("early_stopping"):
        callbacks.append(keras.callbacks.EarlyStopping(monitor="val_loss", patience=int(params.get("patience", 10)),
                                                       restore_best_weights=True))
    model.fit(Xtr, ytr, validation_data=(Xva, yva), epochs=int(params["epochs"]),
              batch_size=int(params["batch_size"]), verbose=0, callbacks=callbacks)
    if cb.cancelled:
        raise Cancelled()

    evaluation = {k: float(v) for k, v in model.evaluate(Xte, yte, verbose=0, return_dict=True).items()}
    result: dict = {"test": {k: round(v, 6) for k, v in evaluation.items()}, "n_test": int(len(Xte)),
                    "params": real}
    if meta["task"] in ("binary", "multiclass"):
        pred = model.predict(Xte, verbose=0)
        yhat = (pred[:, 0] > 0.5).astype(int) if pred.shape[1] == 1 else pred.argmax(axis=1)
        n = int(meta.get("n_classes") or 2)
        cm = np.zeros((n, n), dtype=int)
        for t, p in zip(yte.astype(int), yhat):
            cm[t, p] += 1
        result["confusion_matrix"] = cm.tolist()
        result["class_names"] = meta.get("class_names", [])
    else:
        pred = model.predict(Xte, verbose=0)[:, 0]
        ss_res = float(((yte - pred) ** 2).sum())
        ss_tot = float(((yte - yte.mean()) ** 2).sum()) or 1.0
        result["r2"] = round(1 - ss_res / ss_tot, 6)
        result["sample_predictions"] = [[round(float(a), 4), round(float(b), 4)]
                                        for a, b in zip(yte[:50], pred[:50])]
    return model, result


def _train_gan(job, arch, meta, X, params, deadline):
    import keras
    import tensorflow as tf

    seed = int(params.get("seed", 42))
    keras.utils.set_random_seed(seed)
    cfg = arch.config_json
    latent = int(cfg["latent_dim"])
    gen = build_sequential([latent], cfg["generator"]["layers"], name="generator")
    disc = build_sequential(cfg["input_shape"], cfg["discriminator"]["layers"], name="discriminator")
    lr = float(params["learning_rate"])
    g_opt, d_opt = build_optimizer(params["optimizer"], lr), build_optimizer(params["optimizer"], lr)
    bce = keras.losses.BinaryCrossentropy()
    epochs, bs = int(params["epochs"]), int(params["batch_size"])
    data = tf.data.Dataset.from_tensor_slices(X).shuffle(len(X), seed=seed).batch(bs, drop_remainder=True)
    job_log(job.id, f"GAN construida · generador={gen.count_params():,} · discriminador={disc.count_params():,}")
    rng = np.random.default_rng(seed)
    zp = rng.standard_normal((snap.N_PROBES, latent)).astype("float32")
    recorder = SnapshotRecorder(job.id, gen, zp, np.zeros(len(zp)), {"task": "generative"}, epochs, "Ruido z")
    recorder.maybe(0)
    set_job(job.id, status="RUNNING", heartbeat_at=utcnow())

    @tf.function
    def step(real):
        n = tf.shape(real)[0]
        z = tf.random.normal((n, latent))
        with tf.GradientTape() as dt, tf.GradientTape() as gt:
            fake = gen(z, training=True)
            pr, pf = disc(real, training=True), disc(fake, training=True)
            d_loss = bce(tf.ones_like(pr), pr) + bce(tf.zeros_like(pf), pf)
            g_loss = bce(tf.ones_like(pf), pf)
        d_opt.apply_gradients(zip(dt.gradient(d_loss, disc.trainable_variables), disc.trainable_variables))
        g_opt.apply_gradients(zip(gt.gradient(g_loss, gen.trainable_variables), gen.trainable_variables))
        return d_loss, g_loss

    for e in range(1, epochs + 1):
        dl, gl = [], []
        for real in data:
            d, g = step(real)
            dl.append(float(d)); gl.append(float(g))
        logs = {"d_loss": float(np.mean(dl)), "g_loss": float(np.mean(gl))}
        with session_scope() as db:
            for k, v in logs.items():
                db.add(TrainingMetric(job_id=job.id, epoch=e, metric_name=k, metric_value=v))
            db.execute(update(TrainingJob).where(TrainingJob.id == job.id).values(
                current_epoch=e, progress=round(e / epochs * 100, 2), heartbeat_at=utcnow()))
            db.add(JobLog(job_id=job.id, message=f"Época {e}/{epochs} · d_loss={logs['d_loss']:.4f} · g_loss={logs['g_loss']:.4f}"))
        recorder.maybe(e)
        if time.monotonic() > deadline:
            raise TimeoutError("Se superó la duración máxima configurada para el trabajo")
        if cancel_requested(job.id):
            raise Cancelled()

    samples = gen(tf.random.normal((500, latent)), training=False).numpy()
    gap = float(np.abs(samples.mean(0) - X.mean(0)).mean() + np.abs(samples.std(0) - X.std(0)).mean())
    return gen, {"distribution_gap": round(gap, 6), "samples": samples[:200].round(4).tolist(),
                 "real": X[:200].round(4).tolist(), "params": int(gen.count_params() + disc.count_params())}


def _save_model(job, model, result) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "model.keras")
        model.save(path)
        data = open(path, "rb").read()
    checksum = hashlib.sha256(data).hexdigest()
    key = f"projects/{job.project_id}/models/{job.id}.keras"
    storage.put_object(key, data, "application/octet-stream")
    with session_scope() as db:
        next_v = (db.scalar(select(func.max(ModelVersion.version)).where(ModelVersion.project_id == job.project_id)) or 0) + 1
        db.add(ModelVersion(project_id=job.project_id, job_id=job.id, version=next_v, storage_key=key,
                            checksum=checksum, size_bytes=len(data), metrics_json=result.get("test", {}) or
                            {"distribution_gap": result.get("distribution_gap")}, created_by=job.created_by))
        audit(db, job.created_by, "model.version_created", job.project_id, job_id=job.id, version=next_v,
              checksum=checksum)
    job_log(job.id, f"Modelo guardado como versión v{next_v} · sha256 {checksum[:12]}… · {len(data) / 1024:.1f} KB")


def run_job(job_id: uuid.UUID) -> None:
    with session_scope() as db:
        job = db.get(TrainingJob, job_id)
        arch = db.get(Architecture, job.architecture_id)
        dataset = db.get(Dataset, job.dataset_id)
        db.expunge_all()
    params = job.params_json
    limits = {}
    with session_scope() as db:
        limits = get_setting(db, "limits")
    deadline = time.monotonic() + int(limits.get("job_timeout_seconds", 900))
    job_log(job_id, f"[{WORKER_ID}] Preparando trabajo · intento {job.attempts} · código v{job.code_version}")
    try:
        import tensorflow as tf
        tf.config.threading.set_intra_op_parallelism_threads(int(os.getenv("TF_THREADS", "2")))
        X, y = load_arrays(dataset, int(params.get("seed", 42)))
        meta = dataset.metadata_json
        if arch.family == "gan":
            model, result = _train_gan(job, arch, meta, X, params, deadline)
        else:
            model, result = _train_supervised(job, arch, meta, X, y, params, deadline)
        _save_model(job, model, result)
        set_job(job_id, status="COMPLETED", progress=100.0, result_json=result, ended_at=utcnow())
        job_log(job_id, "Entrenamiento completado")
        with session_scope() as db:
            audit(db, job.created_by, "training.completed", job.project_id, job_id=job_id)
    except Cancelled:
        with session_scope() as db:
            reason = db.scalar(select(TrainingJob.cancel_reason).where(TrainingJob.id == job_id))
        set_job(job_id, status="CANCELLED", ended_at=utcnow(), cancel_reason=reason or "Cancelado por el usuario")
        job_log(job_id, "Trabajo cancelado; el worker confirmó la detención", "warning")
        with session_scope() as db:
            audit(db, job.created_by, "training.cancelled", job.project_id, job_id=job_id)
    except Exception as exc:  # error controlado + log técnico protegido
        msg = str(exc) if isinstance(exc, (ValueError, TimeoutError, storage.StorageError)) else \
            "Error interno durante el entrenamiento. Revisa los logs técnicos."
        set_job(job_id, status="FAILED", ended_at=utcnow(), error_message=msg[:1000])
        job_log(job_id, f"Fallo: {msg}", "error")
        job_log(job_id, traceback.format_exc()[-3500:], "debug")
        log.exception("job %s falló", job_id)
    finally:
        try:
            import keras
            keras.backend.clear_session()
        except Exception:
            pass


# ----------------------------------------------------------------------------- loop
_stop = threading.Event()


def worker_loop() -> None:
    log.info("%s iniciado", WORKER_ID)
    last_recovery = 0.0
    while not _stop.is_set():
        try:
            if time.monotonic() - last_recovery > 60:
                last_recovery = time.monotonic()
                if (n := recover_stale_jobs()):
                    log.warning("recuperados %d trabajos huérfanos", n)
            job_id = claim_next_job()
            if job_id:
                run_job(job_id)
                continue
        except Exception:
            log.exception("error en el bucle del worker")
        _stop.wait(settings.worker_poll_seconds)


def start_embedded() -> threading.Thread:
    t = threading.Thread(target=worker_loop, name="training-worker", daemon=True)
    t.start()
    return t


def stop() -> None:
    _stop.set()


def _health_server(port: int) -> None:
    """Servidor HTTP mínimo para plataformas que exigen un puerto abierto (p. ej. Hugging Face Spaces)."""
    import json
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class H(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            body = json.dumps({"status": "ok", "worker": WORKER_ID}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    threading.Thread(target=ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever, daemon=True).start()


if __name__ == "__main__":
    from ..core.logging import setup_logging
    setup_logging()
    if os.getenv("PORT"):
        _health_server(int(os.environ["PORT"]))
    worker_loop()
