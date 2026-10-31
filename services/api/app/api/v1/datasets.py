import hashlib
import io
import uuid
from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...core.auth import CurrentUser, authorize_project, get_current_user
from ...core.db import get_db
from ...ml import datasets as ds
from ...models import Dataset, TrainingJob
from ...modules import storage
from ...modules.audit import audit
from ...modules.settings_store import get_setting
from ...schemas import BuiltinDatasetIn, DatasetOut

router = APIRouter(tags=["datasets"])


@router.get("/catalog/datasets")
def builtin_catalog(user: CurrentUser = Depends(get_current_user)):
    return [{"key": k, **v} for k, v in ds.BUILTIN.items()]


def _next_version(db: Session, project_id: uuid.UUID, name: str) -> int:
    return (db.scalar(select(func.max(Dataset.version)).where(Dataset.project_id == project_id,
                                                               Dataset.name == name)) or 0) + 1


@router.get("/projects/{project_id}/datasets", response_model=list[DatasetOut])
def list_datasets(project_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    authorize_project(db, user, project_id, "view")
    return db.scalars(select(Dataset).where(Dataset.project_id == project_id, Dataset.deleted_at.is_(None))
                      .order_by(Dataset.created_at.desc())).all()


@router.post("/projects/{project_id}/datasets/builtin", response_model=DatasetOut, status_code=201)
def register_builtin(project_id: uuid.UUID, body: BuiltinDatasetIn, user: CurrentUser = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    authorize_project(db, user, project_id, "edit")
    if body.generator not in ds.BUILTIN:
        raise HTTPException(422, "Dataset demo desconocido")
    meta = ds.builtin_metadata(body.generator, body.n_samples)
    meta.update({"n_samples": body.n_samples, "seed": body.seed, "license": "Sintético · sin datos personales"})
    name = ds.BUILTIN[body.generator]["label"]
    d = Dataset(project_id=project_id, name=name, version=_next_version(db, project_id, name), storage_key=None,
                metadata_json=meta, created_by=user.id)
    db.add(d)
    db.flush()
    audit(db, user.id, "dataset.registered", project_id, dataset_id=d.id, kind="builtin", generator=body.generator)
    db.commit()
    return d


@router.post("/projects/{project_id}/datasets/upload", response_model=DatasetOut, status_code=201)
async def upload_csv(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    name: str = Form(..., min_length=2, max_length=120),
    target: str | None = Form(default=None, max_length=120),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    authorize_project(db, user, project_id, "edit")
    max_mb = int(get_setting(db, "limits").get("max_upload_mb", 10))
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(415, "Solo se aceptan archivos .csv")
    content = await file.read(max_mb * 1024 * 1024 + 1)
    if len(content) > max_mb * 1024 * 1024:
        raise HTTPException(413, f"El archivo supera el máximo de {max_mb} MB")
    try:
        X, y, meta = ds.parse_csv(content, target or None)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    buf = io.BytesIO()
    np.savez_compressed(buf, X=X, y=y)
    version = _next_version(db, project_id, name)
    key = f"projects/{project_id}/datasets/{uuid.uuid4().hex}.npz"
    try:
        storage.put_object(key, buf.getvalue())
    except storage.StorageError as exc:
        raise HTTPException(502, str(exc))
    meta.update({"original_filename": file.filename, "source_sha256": hashlib.sha256(content).hexdigest(),
                 "size_bytes": len(content)})
    d = Dataset(project_id=project_id, name=name, version=version, storage_key=key, metadata_json=meta,
                created_by=user.id)
    db.add(d)
    db.flush()
    audit(db, user.id, "dataset.uploaded", project_id, dataset_id=d.id, rows=meta["n_samples"], size=len(content))
    db.commit()
    return d


@router.get("/datasets/{dataset_id}/preview")
def preview(dataset_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    d = db.get(Dataset, dataset_id)
    if d is None or d.deleted_at:
        raise HTTPException(404, "Dataset no encontrado")
    authorize_project(db, user, d.project_id, "view")
    meta = d.metadata_json
    if meta.get("kind") == "builtin":
        X, y = ds.load_builtin(meta["generator"], min(int(meta.get("n_samples", 1000)), 400), seed=int(meta.get("seed", 42)))
    else:
        from ...workers.training import load_arrays
        X, y = load_arrays(d, 42)
        X, y = X[:400], y[:400]
    out: dict = {"task": meta.get("task"), "input_shape": meta.get("input_shape")}
    if X.ndim == 2:
        out["points"] = [[round(float(v), 4) for v in row[:2]] + [round(float(t), 4)] for row, t in zip(X, y)]
    elif X.ndim == 3:  # secuencias
        out["sequences"] = [{"label": int(t), "values": X[i, :, 0].round(3).tolist()} for i, t in enumerate(y[:9])]
    elif X.ndim == 4:  # imágenes
        out["images"] = [{"label": int(t), "pixels": X[i, :, :, 0].round(2).tolist()} for i, t in enumerate(y[:12])]
    return out


@router.delete("/datasets/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    d = db.get(Dataset, dataset_id)
    if d is None or d.deleted_at:
        raise HTTPException(404, "Dataset no encontrado")
    authorize_project(db, user, d.project_id, "manage")
    active = db.scalar(select(func.count()).select_from(TrainingJob).where(
        TrainingJob.dataset_id == d.id, TrainingJob.status.in_(("QUEUED", "PREPARING", "RUNNING")))) or 0
    if active:
        raise HTTPException(409, "Hay entrenamientos activos usando este dataset")
    used = db.scalar(select(func.count()).select_from(TrainingJob).where(TrainingJob.dataset_id == d.id)) or 0
    # Eliminación segura: se borra el archivo, pero se conserva el registro para la trazabilidad histórica
    if d.storage_key:
        storage.delete_object(d.storage_key)
    d.deleted_at = datetime.now(timezone.utc)
    audit(db, user.id, "dataset.deleted", d.project_id, dataset_id=d.id, referenced_by_jobs=used)
    db.commit()
