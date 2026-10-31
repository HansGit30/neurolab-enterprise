import asyncio
import json
import time
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ...core.auth import CAN, CurrentUser, authorize_project, get_current_user, project_role
from ...core.config import get_settings
from ...core.db import SessionLocal, get_db
from ...models import (Architecture, Dataset, JobLog, NetworkSnapshot, Project, ProjectMember, TrainingJob,
                       TrainingMetric)
from ...modules.architecture_validation import check_dataset_compatibility, validate_architecture
from ...modules.audit import audit
from ...modules.settings_store import get_setting
from ...schemas import CancelIn, LogOut, MetricOut, TrainingJobIn, TrainingJobOut

router = APIRouter(tags=["training"])
settings = get_settings()
ACTIVE = ("QUEUED", "PREPARING", "RUNNING")
TERMINAL = ("COMPLETED", "FAILED", "CANCELLED")


def enrich(db: Session, jobs: list[TrainingJob]) -> list[TrainingJobOut]:
    out = []
    for j in jobs:
        o = TrainingJobOut.model_validate(j)
        a = db.get(Architecture, j.architecture_id)
        d = db.get(Dataset, j.dataset_id)
        p = db.get(Project, j.project_id)
        o.architecture_name = f"{a.name} v{a.version}" if a else None
        o.architecture_family = a.family if a else None
        o.dataset_name = f"{d.name} v{d.version}" if d else None
        o.project_name = p.name if p else None
        out.append(o)
    return out


def _job_for(db: Session, user: CurrentUser, job_id: uuid.UUID, capability: str) -> TrainingJob:
    job = db.get(TrainingJob, job_id)
    if job is None:
        raise HTTPException(404, "Trabajo no encontrado")
    authorize_project(db, user, job.project_id, capability)  # 404 si no es miembro: sin acceso horizontal
    return job


@router.post("/projects/{project_id}/training-jobs", response_model=TrainingJobOut, status_code=201)
def create_job(project_id: uuid.UUID, body: TrainingJobIn, user: CurrentUser = Depends(get_current_user),
               db: Session = Depends(get_db)):
    project = authorize_project(db, user, project_id, "edit")
    if project.status != "active":
        raise HTTPException(409, "El proyecto no está activo")
    arch = db.get(Architecture, body.architecture_id)
    dataset = db.get(Dataset, body.dataset_id)
    if arch is None or arch.project_id != project_id:
        raise HTTPException(422, "Arquitectura inválida para este proyecto")
    if dataset is None or dataset.project_id != project_id or dataset.deleted_at:
        raise HTTPException(422, "Dataset inválido para este proyecto")

    limits, feats = get_setting(db, "limits"), get_setting(db, "features")
    flag = {"rnn": "rnn_training_enabled", "cnn": "cnn_training_enabled", "gan": "gan_training_enabled"}.get(arch.family)
    if flag and not feats.get(flag, False):
        raise HTTPException(409, f"El entrenamiento de la familia {arch.family.upper()} aún no está habilitado "
                                 "(Administración → Configuración)")
    p = body.params
    errors: list[str] = []
    if p.epochs > limits["max_epochs"]:
        errors.append(f"Máximo {limits['max_epochs']} épocas")
    if p.batch_size > limits["max_batch_size"]:
        errors.append(f"batch_size máximo {limits['max_batch_size']}")
    # Revalidación en backend (la configuración guardada podría venir de reglas antiguas)
    check = validate_architecture(arch.family, arch.config_json, limits)
    errors += check.errors
    errors += check_dataset_compatibility(arch.family, arch.config_json, check.as_dict(), dataset.metadata_json)
    if arch.family == "gan" and dataset.metadata_json.get("task") not in ("generative",) and \
            len(dataset.metadata_json.get("input_shape", [])) != 1:
        errors.append("La GAN requiere un dataset tabular")
    if errors:
        raise HTTPException(422, {"message": "No se puede iniciar el entrenamiento", "errors": errors})

    running = db.scalar(select(func.count()).select_from(TrainingJob).where(
        TrainingJob.created_by == user.id, TrainingJob.status.in_(ACTIVE))) or 0
    if running >= limits["max_concurrent_jobs_per_user"]:
        raise HTTPException(429, f"Límite de {limits['max_concurrent_jobs_per_user']} trabajos activos por usuario")

    priority = body.priority if project_role(db, user, project_id) == "owner" else 0
    job = TrainingJob(project_id=project_id, architecture_id=arch.id, dataset_id=dataset.id,
                      params_json=p.model_dump(), total_epochs=p.epochs, priority=priority,
                      code_version=settings.code_version, created_by=user.id)
    db.add(job)
    db.flush()
    db.add(JobLog(job_id=job.id, message=f"Trabajo en cola · {arch.family} · {p.epochs} épocas · semilla {p.seed}"))
    audit(db, user.id, "training.started", project_id, job_id=job.id, architecture_id=arch.id, dataset_id=dataset.id)
    db.commit()
    _wake_worker()
    return enrich(db, [job])[0]


def _wake_worker() -> None:
    if not settings.worker_wake_url or settings.embedded_worker:
        return
    import threading

    import httpx

    def ping():
        try:
            httpx.get(settings.worker_wake_url, timeout=10, follow_redirects=True)
        except Exception:
            pass
    threading.Thread(target=ping, daemon=True).start()


@router.get("/training-jobs", response_model=list[TrainingJobOut])
def list_jobs(project_id: uuid.UUID | None = None, status: str | None = None,
              limit: int = Query(default=50, ge=1, le=500),
              user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(TrainingJob)
    if project_id:
        authorize_project(db, user, project_id, "view")
        stmt = stmt.where(TrainingJob.project_id == project_id)
    elif not user.is_admin:
        stmt = stmt.where(TrainingJob.project_id.in_(
            select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)))
    if status:
        stmt = stmt.where(TrainingJob.status.in_(status.split(",")))
    return enrich(db, db.scalars(stmt.order_by(TrainingJob.created_at.desc()).limit(limit)).all())


@router.get("/training-jobs/{job_id}", response_model=TrainingJobOut)
def get_job(job_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return enrich(db, [_job_for(db, user, job_id, "view")])[0]


@router.get("/training-jobs/{job_id}/metrics", response_model=list[MetricOut])
def get_metrics(job_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    _job_for(db, user, job_id, "view")
    return db.scalars(select(TrainingMetric).where(TrainingMetric.job_id == job_id).order_by(TrainingMetric.id)).all()


@router.get("/training-jobs/{job_id}/logs", response_model=list[LogOut])
def get_logs(job_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    job = _job_for(db, user, job_id, "view")
    stmt = select(JobLog).where(JobLog.job_id == job_id)
    if project_role(db, user, job.project_id) not in CAN["edit"]:
        stmt = stmt.where(JobLog.level != "debug")  # logs técnicos protegidos
    return db.scalars(stmt.order_by(JobLog.id.desc()).limit(300)).all()[::-1]


@router.post("/training-jobs/{job_id}/cancel", response_model=TrainingJobOut)
def cancel_job(job_id: uuid.UUID, body: CancelIn, user: CurrentUser = Depends(get_current_user),
               db: Session = Depends(get_db)):
    job = _job_for(db, user, job_id, "edit")
    if job.status not in ACTIVE:
        raise HTTPException(409, f"No se puede cancelar un trabajo en estado {job.status}")
    job.cancel_requested = True
    job.cancel_reason = body.reason
    db.add(JobLog(job_id=job.id, level="warning", message=f"Cancelación solicitada: {body.reason}"))
    audit(db, user.id, "training.cancel_requested", job.project_id, job_id=job.id, reason=body.reason)
    db.commit()
    return enrich(db, [job])[0]


@router.post("/training-jobs/{job_id}/retry", response_model=TrainingJobOut, status_code=201)
def retry_job(job_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    job = _job_for(db, user, job_id, "edit")
    if job.status not in ("FAILED", "CANCELLED"):
        raise HTTPException(409, "Solo se reintentan trabajos fallidos o cancelados")
    from ...schemas import TrainingParams
    return create_job(job.project_id, TrainingJobIn(architecture_id=job.architecture_id, dataset_id=job.dataset_id,
                                                    params=TrainingParams(**job.params_json)), user, db)


# ----------------------------------------------------------------------------- tiempo real (SSE)
def _snapshot(job: TrainingJob) -> dict:
    return {"id": str(job.id), "status": job.status, "progress": job.progress, "current_epoch": job.current_epoch,
            "total_epochs": job.total_epochs, "error_message": job.error_message,
            "cancel_requested": job.cancel_requested, "result": job.result_json if job.status in TERMINAL else None}


def _poll(job_id: uuid.UUID, last_metric: int, last_log: int, show_debug: bool):
    with SessionLocal() as db:
        job = db.get(TrainingJob, job_id)
        metrics = db.scalars(select(TrainingMetric).where(TrainingMetric.job_id == job_id, TrainingMetric.id > last_metric)
                             .order_by(TrainingMetric.id).limit(2000)).all()
        q = select(JobLog).where(JobLog.job_id == job_id, JobLog.id > last_log)
        if not show_debug:
            q = q.where(JobLog.level != "debug")
        logs = db.scalars(q.order_by(JobLog.id).limit(500)).all()
        net_epoch = db.scalar(select(func.max(NetworkSnapshot.epoch)).where(NetworkSnapshot.job_id == job_id))
        return (_snapshot(job), net_epoch,
                [{"id": m.id, "epoch": m.epoch, "metric_name": m.metric_name, "metric_value": m.metric_value} for m in metrics],
                [{"id": l.id, "level": l.level, "message": l.message, "created_at": l.created_at.isoformat()} for l in logs])


def _sse(event: str, data, event_id: str | None = None) -> str:
    head = f"id: {event_id}\n" if event_id else ""
    return f"{head}event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.get("/training-jobs/{job_id}/events")
async def job_events(job_id: uuid.UUID, request: Request, last_event_id: str | None = Header(default=None),
                     user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Canal SSE autenticado. El servidor empuja eventos: snapshot, metrics, logs, network y end.

    La fuente de verdad es PostgreSQL (estado persistido por el worker); el canal lee los
    cambios cada segundo y solo envía deltas. Al reconectar, el cliente manda Last-Event-ID
    ("m<id>.l<id>") y recibe exactamente lo que se perdió.
    """
    job = _job_for(db, user, job_id, "view")
    show_debug = project_role(db, user, job.project_id) in CAN["edit"]
    last_metric = last_log = 0
    if last_event_id and last_event_id.startswith("m"):
        try:
            m, l = last_event_id[1:].split(".l")
            last_metric, last_log = int(m), int(l)
        except ValueError:
            pass
    db.close()

    async def stream():
        nonlocal last_metric, last_log
        prev = None
        prev_net = None
        last_beat = time.monotonic()
        yield "retry: 3000\n\n"
        while True:
            if await request.is_disconnected():
                break
            snap, net_epoch, metrics, logs = await run_in_threadpool(_poll, job_id, last_metric, last_log, show_debug)
            if metrics:
                last_metric = metrics[-1]["id"]
            if logs:
                last_log = logs[-1]["id"]
            eid = f"m{last_metric}.l{last_log}"
            if metrics:
                yield _sse("metrics", metrics, eid)
            if logs:
                yield _sse("logs", logs, eid)
            if net_epoch is not None and net_epoch != prev_net:
                prev_net = net_epoch
                yield _sse("network", {"epoch": net_epoch}, eid)
            if snap != prev:
                prev = snap
                yield _sse("snapshot", snap, eid)
            if snap["status"] in TERMINAL:
                yield _sse("end", {"status": snap["status"]}, eid)
                break
            if time.monotonic() - last_beat > 15:
                last_beat = time.monotonic()
                yield ": keep-alive\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


# ----------------------------------------------------------------------------- visor de red
@router.get("/training-jobs/{job_id}/network/epochs")
def network_epochs(job_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Épocas para las que hay instantánea de pesos/activaciones (0 = pesos iniciales aleatorios)."""
    _job_for(db, user, job_id, "view")
    return db.scalars(select(NetworkSnapshot.epoch).where(NetworkSnapshot.job_id == job_id)
                      .order_by(NetworkSnapshot.epoch)).all()


@router.get("/training-jobs/{job_id}/network")
def network_snapshot(job_id: uuid.UUID, epoch: int | None = Query(default=None, ge=0),
                     user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Pesos y activaciones reales de la red en una época (la última si no se indica)."""
    _job_for(db, user, job_id, "view")
    q = select(NetworkSnapshot).where(NetworkSnapshot.job_id == job_id)
    q = q.where(NetworkSnapshot.epoch == epoch) if epoch is not None else q.order_by(NetworkSnapshot.epoch.desc())
    row = db.scalars(q.limit(1)).first()
    if row is None:
        raise HTTPException(404, "Aún no hay instantáneas de la red para este trabajo")
    return row.data
