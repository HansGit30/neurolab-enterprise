import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ...core.auth import CurrentUser, authorize_project, get_current_user, project_role
from ...core.db import get_db
from ...models import (Architecture, Dataset, ModelVersion, Project, ProjectMember, TrainingJob, User)
from ...modules.audit import audit
from ...schemas import MemberIn, MemberOut, ProjectIn, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])

CREATOR_ROLES = {"admin", "project_owner"}


def _stats(db: Session, pid: uuid.UUID) -> dict:
    def count(model, *conds):
        return db.scalar(select(func.count()).select_from(model).where(*conds)) or 0
    return {
        "architectures": count(Architecture, Architecture.project_id == pid),
        "datasets": count(Dataset, Dataset.project_id == pid, Dataset.deleted_at.is_(None)),
        "jobs": count(TrainingJob, TrainingJob.project_id == pid),
        "active_jobs": count(TrainingJob, TrainingJob.project_id == pid,
                             TrainingJob.status.in_(("QUEUED", "PREPARING", "RUNNING"))),
        "models": count(ModelVersion, ModelVersion.project_id == pid),
        "members": count(ProjectMember, ProjectMember.project_id == pid),
    }


def _out(db: Session, p: Project, user: CurrentUser) -> ProjectOut:
    o = ProjectOut.model_validate(p)
    o.my_role = project_role(db, user, p.id)
    o.stats = _stats(db, p.id)
    return o


@router.get("", response_model=list[ProjectOut])
def list_projects(
    q: str | None = Query(default=None, max_length=100),
    status: str | None = None,
    tag: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Project)
    if not user.is_admin:
        stmt = stmt.join(ProjectMember, ProjectMember.project_id == Project.id).where(ProjectMember.user_id == user.id)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Project.name).like(like), func.lower(Project.description).like(like)))
    if status:
        stmt = stmt.where(Project.status == status)
    rows = db.scalars(stmt.order_by(Project.updated_at.desc())).all()
    if tag:
        rows = [p for p in rows if tag in (p.tags or [])]
    return [_out(db, p, user) for p in rows]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role not in CREATOR_ROLES:
        raise HTTPException(403, "Solo administradores y responsables de proyecto pueden crear proyectos")
    p = Project(**body.model_dump(), owner_id=user.id)
    db.add(p)
    db.flush()
    db.add(ProjectMember(project_id=p.id, user_id=user.id, role="owner"))
    audit(db, user.id, "project.created", p.id, name=p.name)
    db.commit()
    return _out(db, p, user)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(db, authorize_project(db, user, project_id, "view"), user)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: uuid.UUID, body: ProjectUpdate, user: CurrentUser = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    p = authorize_project(db, user, project_id, "manage")
    changes = body.model_dump(exclude_unset=True)
    if "tags" in changes and changes["tags"] is not None:
        changes["tags"] = ProjectIn(name="xxx", tags=changes["tags"]).tags
    for k, v in changes.items():
        setattr(p, k, v)
    audit(db, user.id, "project.updated", p.id, fields=sorted(changes))
    db.commit()
    db.refresh(p)
    return _out(db, p, user)


# ----------------------------------------------------------------------------- members
@router.get("/{project_id}/members", response_model=list[MemberOut])
def list_members(project_id: uuid.UUID, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    authorize_project(db, user, project_id, "view")
    rows = db.execute(select(ProjectMember, User).join(User, User.id == ProjectMember.user_id)
                      .where(ProjectMember.project_id == project_id).order_by(ProjectMember.added_at)).all()
    return [MemberOut(user_id=u.id, email=u.email, display_name=u.display_name, role=m.role, added_at=m.added_at)
            for m, u in rows]


@router.post("/{project_id}/members", response_model=MemberOut, status_code=201)
def add_member(project_id: uuid.UUID, body: MemberIn, user: CurrentUser = Depends(get_current_user),
               db: Session = Depends(get_db)):
    authorize_project(db, user, project_id, "manage")
    target = db.scalar(select(User).where(func.lower(User.email) == body.email.lower().strip()))
    if target is None:
        raise HTTPException(404, "Ese correo aún no tiene cuenta. Pídele que se registre primero.")
    m = db.get(ProjectMember, (project_id, target.id))
    if m:
        m.role = body.role
    else:
        m = ProjectMember(project_id=project_id, user_id=target.id, role=body.role)
        db.add(m)
    audit(db, user.id, "project.member_set", project_id, member=target.email, role=body.role)
    db.commit()
    return MemberOut(user_id=target.id, email=target.email, display_name=target.display_name, role=m.role,
                     added_at=m.added_at)


@router.delete("/{project_id}/members/{user_id}", status_code=204)
def remove_member(project_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    p = authorize_project(db, user, project_id, "manage")
    if user_id == p.owner_id:
        raise HTTPException(400, "No se puede quitar al propietario del proyecto")
    m = db.get(ProjectMember, (project_id, user_id))
    if m:
        db.delete(m)
        audit(db, user.id, "project.member_removed", project_id, member_id=user_id)
        db.commit()
