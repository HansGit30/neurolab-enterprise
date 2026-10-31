import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from ...core.auth import CurrentUser, authorize_project, get_current_user, require_global
from ...core.config import get_settings
from ...core.db import get_db
from ...models import (Architecture, AuditEvent, Dataset, JobLog, ModelVersion, Project, ProjectMember, TrainingJob,
                       TrainingMetric, User)
from ...modules import storage
from ...modules.audit import audit
from ...modules.settings_store import DEFAULTS, all_settings, get_setting, put_setting
from ...schemas import AuditOut, ProfileUpdate, SettingIn, UserOut, UserUpdate
from .training import enrich

router = APIRouter(tags=["admin"])
settings = get_settings()


# ----------------------------------------------------------------------------- perfil
@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "display_name": user.display_name, "role": user.role}


@router.patch("/me")
def update_me(body: ProfileUpdate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    u = db.get(User, user.id)
    u.display_name = body.display_name
    db.commit()
    return {"id": u.id, "email": u.email, "display_name": u.display_name, "role": u.role}


# ----------------------------------------------------------------------------- dashboard
@router.get("/dashboard")
def dashboard(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    pids = None if user.is_admin else select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)

    def scoped(stmt, col):
        return stmt if pids is None else stmt.where(col.in_(pids))

    def count(model, col, *conds):
        return db.scalar(scoped(select(func.count()).select_from(model).where(*conds), col)) or 0

    since = datetime.now(timezone.utc) - timedelta(days=14)
    by_status = dict(db.execute(scoped(select(TrainingJob.status, func.count()).group_by(TrainingJob.status),
                                       TrainingJob.project_id)).all())
    recent = db.scalars(scoped(select(TrainingJob).order_by(TrainingJob.created_at.desc()).limit(8),
                               TrainingJob.project_id)).all()
    daily_rows = db.scalars(scoped(select(TrainingJob.created_at).where(TrainingJob.created_at >= since),
                                   TrainingJob.project_id)).all()
    daily: dict[str, int] = {}
    for i in range(14):
        daily[(since + timedelta(days=i + 1)).date().isoformat()] = 0
    for d in daily_rows:
        k = d.date().isoformat()
        if k in daily:
            daily[k] += 1
    alerts = []
    failed_recent = db.scalars(scoped(select(TrainingJob).where(TrainingJob.status == "FAILED",
                                                                TrainingJob.created_at >= since)
                                      .order_by(TrainingJob.created_at.desc()).limit(3), TrainingJob.project_id)).all()
    for j in failed_recent:
        alerts.append({"level": "error", "message": f"Entrenamiento fallido: {j.error_message or 'sin detalle'}",
                       "job_id": str(j.id)})
    pending = count(ModelVersion, ModelVersion.project_id, ModelVersion.status.in_(("draft", "reviewed")))
    if pending:
        alerts.append({"level": "info", "message": f"{pending} versión(es) de modelo pendientes de revisión/aprobación"})
    return {
        "projects": count(Project, Project.id),
        "active_jobs": sum(by_status.get(s, 0) for s in ("QUEUED", "PREPARING", "RUNNING")),
        "jobs_by_status": by_status,
        "models": count(ModelVersion, ModelVersion.project_id),
        "approved_models": count(ModelVersion, ModelVersion.project_id, ModelVersion.status == "approved"),
        "architectures": count(Architecture, Architecture.project_id),
        "datasets": count(Dataset, Dataset.project_id, Dataset.deleted_at.is_(None)),
        "recent_jobs": [j.model_dump(mode="json") for j in enrich(db, list(recent))],
        "daily_jobs": [{"date": k, "count": v} for k, v in daily.items()],
        "alerts": alerts,
    }


# ----------------------------------------------------------------------------- auditoría
def _audit_rows(db: Session, stmt, limit: int) -> list[AuditOut]:
    rows = db.execute(stmt.add_columns(User.email).outerjoin(User, User.id == AuditEvent.actor_id)
                      .order_by(AuditEvent.id.desc()).limit(limit)).all()
    out = []
    for ev, email in rows:
        o = AuditOut.model_validate(ev)
        o.actor_email = email
        out.append(o)
    return out


@router.get("/projects/{project_id}/audit-events", response_model=list[AuditOut])
def project_audit(project_id: uuid.UUID, limit: int = Query(default=200, le=1000),
                  user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    authorize_project(db, user, project_id, "audit")
    return _audit_rows(db, select(AuditEvent).where(AuditEvent.project_id == project_id), limit)


@router.get("/admin/audit-events", response_model=list[AuditOut])
def global_audit(action: str | None = None, limit: int = Query(default=300, le=2000),
                 user: CurrentUser = Depends(require_global("admin")), db: Session = Depends(get_db)):
    stmt = select(AuditEvent)
    if action:
        stmt = stmt.where(AuditEvent.action.like(f"{action}%"))
    return _audit_rows(db, stmt, limit)


# ----------------------------------------------------------------------------- usuarios
@router.get("/admin/users", response_model=list[UserOut])
def users(user: CurrentUser = Depends(require_global("admin")), db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.created_at)).all()


@router.get("/users/lookup")
def lookup(email: str = Query(min_length=3), user: CurrentUser = Depends(get_current_user),
           db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(func.lower(User.email) == email.lower().strip()))
    return {"exists": bool(u), "display_name": u.display_name if u else None}


@router.patch("/admin/users/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, body: UserUpdate, user: CurrentUser = Depends(require_global("admin")),
                db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "Usuario no encontrado")
    changes = body.model_dump(exclude_unset=True)
    if u.id == user.id and (changes.get("role", "admin") != "admin" or changes.get("status", "active") != "active"):
        raise HTTPException(400, "No puedes quitarte el rol de administrador ni deshabilitarte a ti mismo")
    for k, v in changes.items():
        setattr(u, k, v)
    audit(db, user.id, "user.updated", None, target=u.email, **changes)
    db.commit()
    return u


# ----------------------------------------------------------------------------- configuración y salud
@router.get("/admin/settings")
def get_settings_all(user: CurrentUser = Depends(require_global("admin")), db: Session = Depends(get_db)):
    return all_settings(db)


@router.put("/admin/settings/{key}")
def put_settings(key: str, body: SettingIn, user: CurrentUser = Depends(require_global("admin")),
                 db: Session = Depends(get_db)):
    if key not in DEFAULTS:
        raise HTTPException(404, "Clave de configuración desconocida")
    allowed = DEFAULTS[key]
    value = {k: body.value[k] for k in allowed if k in body.value}
    for k, v in value.items():
        if type(allowed[k]) is not type(v) and not (isinstance(allowed[k], int) and isinstance(v, int)):
            raise HTTPException(422, f"'{k}' debe ser de tipo {type(allowed[k]).__name__}")
        if isinstance(v, int) and not isinstance(v, bool) and v <= 0:
            raise HTTPException(422, f"'{k}' debe ser positivo")
    if key == "signup" and value.get("default_role") not in ("project_owner", "engineer", "reviewer", "reader"):
        raise HTTPException(422, "Rol por defecto inválido")
    merged = {**get_setting(db, key), **value}
    put_setting(db, key, merged)
    audit(db, user.id, "settings.updated", None, key=key, value=merged)
    db.commit()
    return merged


@router.post("/admin/retention/run")
def run_retention(user: CurrentUser = Depends(require_global("admin")), db: Session = Depends(get_db)):
    r = get_setting(db, "retention")
    now = datetime.now(timezone.utc)
    a = db.execute(delete(AuditEvent).where(AuditEvent.created_at < now - timedelta(days=r["audit_days"]))).rowcount
    l = db.execute(delete(JobLog).where(JobLog.created_at < now - timedelta(days=r["logs_days"]))).rowcount
    audit(db, user.id, "retention.executed", None, audit_deleted=a, logs_deleted=l)
    db.commit()
    return {"audit_deleted": a, "logs_deleted": l}


@router.get("/admin/health")
def health_detail(user: CurrentUser = Depends(require_global("admin")), db: Session = Depends(get_db)):
    from ...workers.training import WORKER_ID
    t0 = datetime.now(timezone.utc)
    db.execute(text("select 1"))
    db_ms = (datetime.now(timezone.utc) - t0).total_seconds() * 1000
    queued = db.scalar(select(func.count()).select_from(TrainingJob).where(TrainingJob.status == "QUEUED")) or 0
    running = db.scalar(select(func.count()).select_from(TrainingJob).where(
        TrainingJob.status.in_(("PREPARING", "RUNNING")))) or 0
    last_hb = db.scalar(select(func.max(TrainingJob.heartbeat_at)))
    return {
        "api": {"ok": True, "version": settings.code_version, "environment": settings.environment},
        "database": {"ok": True, "latency_ms": round(db_ms, 1), "dialect": db.bind.dialect.name},
        "storage": storage.ping(),
        "worker": {"mode": "embedded" if settings.embedded_worker else "external", "id": WORKER_ID,
                   "queued": queued, "running": running, "last_heartbeat": last_hb},
        "counts": {"users": db.scalar(select(func.count()).select_from(User)),
                   "metrics_rows": db.scalar(select(func.count()).select_from(TrainingMetric))},
    }


# ----------------------------------------------------------------------------- reportes / exportación
@router.get("/projects/{project_id}/report")
def project_report(project_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = authorize_project(db, user, project_id, "view")
    archs = db.scalars(select(Architecture).where(Architecture.project_id == project_id)
                       .order_by(Architecture.created_at)).all()
    jobs = db.scalars(select(TrainingJob).where(TrainingJob.project_id == project_id)
                      .order_by(TrainingJob.created_at)).all()
    models = db.scalars(select(ModelVersion).where(ModelVersion.project_id == project_id)
                        .order_by(ModelVersion.version)).all()
    datasets = db.scalars(select(Dataset).where(Dataset.project_id == project_id)).all()
    owner = db.get(User, p.owner_id)
    audit(db, user.id, "report.viewed", project_id)
    db.commit()
    return {
        "project": {"id": p.id, "name": p.name, "description": p.description, "problem_statement": p.problem_statement,
                    "status": p.status, "tags": p.tags, "owner": owner.email if owner else None,
                    "created_at": p.created_at},
        "architectures": [{"name": a.name, "version": a.version, "family": a.family, "justification": a.justification,
                           "total_params": a.summary_json.get("total_params"), "layers": a.summary_json.get("layers", []),
                           "input_shape": a.config_json.get("input_shape")} for a in archs],
        "datasets": [{"name": d.name, "version": d.version, "task": d.metadata_json.get("task"),
                      "n_samples": d.metadata_json.get("n_samples"), "deleted": bool(d.deleted_at)} for d in datasets],
        "jobs": [j.model_dump(mode="json") for j in enrich(db, list(jobs))],
        "models": [{"version": m.version, "status": m.status, "checksum": m.checksum, "metrics": m.metrics_json,
                    "created_at": m.created_at} for m in models],
        "generated_at": datetime.now(timezone.utc),
        "generated_by": user.email,
    }


def _csv(rows: list[list], header: list[str], filename: str) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/projects/{project_id}/export/jobs.csv")
def export_jobs(project_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    authorize_project(db, user, project_id, "export")
    jobs = enrich(db, list(db.scalars(select(TrainingJob).where(TrainingJob.project_id == project_id)
                                      .order_by(TrainingJob.created_at)).all()))
    rows = [[j.id, j.created_at.isoformat(), j.status, j.architecture_name, j.architecture_family, j.dataset_name,
             j.params_json.get("epochs"), j.params_json.get("batch_size"), j.params_json.get("optimizer"),
             j.params_json.get("learning_rate"), j.params_json.get("seed"), j.current_epoch,
             (j.ended_at - j.started_at).total_seconds() if j.ended_at and j.started_at else "",
             *[j.result_json.get("test", {}).get(k, "") for k in ("loss", "accuracy", "mae")],
             j.code_version] for j in jobs]
    audit(db, user.id, "export.jobs_csv", project_id, rows=len(rows))
    db.commit()
    return _csv(rows, ["job_id", "fecha", "estado", "arquitectura", "familia", "dataset", "epocas", "batch_size",
                       "optimizador", "learning_rate", "semilla", "epoca_final", "duracion_s", "test_loss",
                       "test_accuracy", "test_mae", "version_codigo"], "historial_entrenamientos.csv")


@router.get("/training-jobs/{job_id}/export/metrics.csv")
def export_metrics(job_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(TrainingJob, job_id)
    if job is None:
        raise HTTPException(404, "Trabajo no encontrado")
    authorize_project(db, user, job.project_id, "export")
    ms = db.scalars(select(TrainingMetric).where(TrainingMetric.job_id == job_id).order_by(TrainingMetric.id)).all()
    audit(db, user.id, "export.metrics_csv", job.project_id, job_id=job_id)
    db.commit()
    return _csv([[m.epoch, m.metric_name, m.metric_value, m.recorded_at.isoformat()] for m in ms],
                ["epoca", "metrica", "valor", "registrado"], f"metricas_{job_id}.csv")
