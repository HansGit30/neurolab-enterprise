import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...core.auth import CurrentUser, authorize_project, get_current_user
from ...core.db import get_db
from ...models import Architecture
from ...modules.architecture_validation import FAMILY_INFO, LAYERS_BY_FAMILY, ACTIVATIONS, validate_architecture
from ...modules.audit import audit
from ...modules.settings_store import get_setting
from ...schemas import ArchitectureIn, ArchitectureOut, ArchitectureValidateIn

router = APIRouter(tags=["architectures"])


@router.get("/catalog/families")
def families(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    feats = get_setting(db, "features")
    enabled = {"feedforward": True, "rnn": feats.get("rnn_training_enabled", True),
               "cnn": feats.get("cnn_training_enabled", True), "gan": feats.get("gan_training_enabled", False)}
    return [{"key": k, **v, "layers": sorted(LAYERS_BY_FAMILY[k]), "training_enabled": bool(enabled[k]),
             "activations": list(ACTIVATIONS)} for k, v in FAMILY_INFO.items()]


@router.post("/architectures/validate")
def validate(body: ArchitectureValidateIn, user: CurrentUser = Depends(get_current_user),
             db: Session = Depends(get_db)):
    return validate_architecture(body.family, body.config, get_setting(db, "limits")).as_dict()


@router.get("/projects/{project_id}/architectures", response_model=list[ArchitectureOut])
def list_architectures(project_id: uuid.UUID, user: CurrentUser = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    authorize_project(db, user, project_id, "view")
    return db.scalars(select(Architecture).where(Architecture.project_id == project_id)
                      .order_by(Architecture.created_at.desc())).all()


@router.post("/projects/{project_id}/architectures", response_model=ArchitectureOut, status_code=201)
def create_architecture(project_id: uuid.UUID, body: ArchitectureIn, user: CurrentUser = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    authorize_project(db, user, project_id, "edit")
    result = validate_architecture(body.family, body.config, get_setting(db, "limits"))
    if result.errors:
        raise HTTPException(422, {"message": "La arquitectura no es válida", "errors": result.errors})
    # Versionado: mismo nombre dentro del proyecto → nueva versión inmutable
    last = db.scalar(select(func.max(Architecture.version)).where(
        Architecture.project_id == project_id, Architecture.name == body.name)) or 0
    a = Architecture(project_id=project_id, name=body.name, family=body.family, config_json=body.config,
                     summary_json=result.as_dict(), justification=body.justification, version=last + 1,
                     created_by=user.id)
    db.add(a)
    db.flush()
    audit(db, user.id, "architecture.created", project_id, architecture_id=a.id, family=a.family, version=a.version)
    db.commit()
    return a


@router.get("/architectures/{architecture_id}", response_model=ArchitectureOut)
def get_architecture(architecture_id: uuid.UUID, user: CurrentUser = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    a = db.get(Architecture, architecture_id)
    if a is None:
        raise HTTPException(404, "Arquitectura no encontrada")
    authorize_project(db, user, a.project_id, "view")
    return a
