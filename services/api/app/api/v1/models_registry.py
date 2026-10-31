import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.auth import CurrentUser, authorize_project, get_current_user, project_role
from ...core.db import get_db
from ...models import Architecture, Dataset, ModelVersion, TrainingJob
from ...modules import storage
from ...modules.audit import audit
from ...schemas import ModelStatusIn, ModelVersionOut

router = APIRouter(tags=["models"])

TRANSITIONS = {"draft": {"reviewed", "retired"}, "reviewed": {"approved", "retired"}, "approved": {"retired"},
               "retired": set()}


def _enrich(db: Session, rows: list[ModelVersion]) -> list[ModelVersionOut]:
    out = []
    for m in rows:
        o = ModelVersionOut.model_validate(m)
        job = db.get(TrainingJob, m.job_id)
        if job:
            a, d = db.get(Architecture, job.architecture_id), db.get(Dataset, job.dataset_id)
            o.architecture_name = f"{a.name} v{a.version}" if a else None
            o.architecture_family = a.family if a else None
            o.dataset_name = f"{d.name} v{d.version}" if d else None
        out.append(o)
    return out


@router.get("/projects/{project_id}/models", response_model=list[ModelVersionOut])
def list_models(project_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    authorize_project(db, user, project_id, "view")
    return _enrich(db, db.scalars(select(ModelVersion).where(ModelVersion.project_id == project_id)
                                  .order_by(ModelVersion.version.desc())).all())


def _model(db, user, model_id, cap) -> ModelVersion:
    m = db.get(ModelVersion, model_id)
    if m is None:
        raise HTTPException(404, "Versión no encontrada")
    authorize_project(db, user, m.project_id, cap)
    return m


@router.post("/models/{model_id}/status", response_model=ModelVersionOut)
def change_status(model_id: uuid.UUID, body: ModelStatusIn, user: CurrentUser = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    m = _model(db, user, model_id, "view")
    role = project_role(db, user, m.project_id)
    if body.status == "retired":
        if role != "owner":
            raise HTTPException(403, "Solo el responsable del proyecto puede retirar versiones")
    elif role not in ("owner", "reviewer"):
        raise HTTPException(403, "Solo revisores o responsables pueden revisar/aprobar")
    if body.status not in TRANSITIONS[m.status]:
        raise HTTPException(409, f"Transición no permitida: {m.status} → {body.status}")
    if body.status == "approved" and m.created_by == user.id and not user.is_admin:
        raise HTTPException(403, "Separación de funciones: no puedes aprobar un modelo que tú entrenaste")
    old = m.status
    m.status = body.status
    m.reviewed_by = user.id
    if body.notes:
        m.notes = (m.notes + "\n" if m.notes else "") + f"[{body.status}] {body.notes}"
    audit(db, user.id, "model.status_changed", m.project_id, model_id=m.id, version=m.version,
          old=old, new=body.status)
    db.commit()
    return _enrich(db, [m])[0]


@router.get("/models/{model_id}/download")
def download(model_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    m = _model(db, user, model_id, "export")
    if m.status == "retired":
        raise HTTPException(409, "La versión está retirada")
    try:
        data = storage.get_object(m.storage_key)
    except storage.StorageError as exc:
        raise HTTPException(502, str(exc))
    audit(db, user.id, "model.downloaded", m.project_id, model_id=m.id, version=m.version)
    db.commit()
    return Response(data, media_type="application/octet-stream", headers={
        "Content-Disposition": f'attachment; filename="neurolab_model_v{m.version}.keras"',
        "X-Checksum-SHA256": m.checksum})
