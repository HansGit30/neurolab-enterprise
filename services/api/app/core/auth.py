"""Autenticación (Supabase Auth JWT) y autorización RBAC por proyecto."""
import logging
import uuid
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Project, ProjectMember, User
from ..modules.settings_store import get_setting
from .config import get_settings
from .db import get_db

log = logging.getLogger("neurolab.auth")
settings = get_settings()

GLOBAL_ROLES = ("admin", "project_owner", "engineer", "reviewer", "reader")
PROJECT_ROLES = ("owner", "engineer", "reviewer", "reader")

# Capacidades por rol de proyecto
CAN = {
    "view": {"owner", "engineer", "reviewer", "reader"},
    "edit": {"owner", "engineer"},          # arquitecturas, datasets, entrenamientos
    "manage": {"owner"},                    # miembros, estado, borrado
    "review": {"owner", "reviewer"},        # aprobar versiones de modelo
    "audit": {"owner", "reviewer"},
    "export": {"owner", "engineer", "reviewer"},
}

_jwks_client: jwt.PyJWKClient | None = None


def _jwks() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
        _jwks_client = jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)
    return _jwks_client


def decode_supabase_token(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "")
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise HTTPException(401, "Token HS256 recibido pero SUPABASE_JWT_SECRET no está configurado")
            key = settings.supabase_jwt_secret
        else:
            key = _jwks().get_signing_key_from_jwt(token).key
        return jwt.decode(
            token, key, algorithms=["HS256", "RS256", "ES256"], audience="authenticated",
            options={"require": ["exp", "sub"]},
        )
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Sesión expirada")
    except Exception as exc:  # firma inválida, JWKS caído, etc.
        log.warning("token rechazado: %s", type(exc).__name__)
        raise HTTPException(401, "Token inválido")


def _ensure_user(db: Session, user_id: uuid.UUID, email: str, name: str | None) -> User:
    user = db.get(User, user_id)
    if user is None:
        # Respaldo si el trigger de Supabase no creó el perfil
        existing = db.scalar(select(func.count()).select_from(User)) or 0
        role = "admin" if existing == 0 else get_setting(db, "signup").get("default_role", "reader")
        user = User(id=user_id, email=email, display_name=name or email.split("@")[0], role=role)
        db.add(user)
        db.commit()
    return user


@dataclass
class CurrentUser:
    id: uuid.UUID
    email: str
    display_name: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def get_current_user(
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CurrentUser:
    if settings.auth_mode == "dev":
        if not x_dev_user:
            raise HTTPException(401, "Falta cabecera X-Dev-User (modo desarrollo)")
        uid = uuid.uuid5(uuid.NAMESPACE_URL, f"dev:{x_dev_user.lower()}")
        user = _ensure_user(db, uid, x_dev_user.lower(), None)
    else:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No autenticado")
        claims = decode_supabase_token(authorization.split(" ", 1)[1])
        meta = claims.get("user_metadata") or {}
        user = _ensure_user(db, uuid.UUID(claims["sub"]), claims.get("email", ""), meta.get("display_name"))
    if user.status != "active":
        raise HTTPException(403, "Usuario deshabilitado")
    return CurrentUser(user.id, user.email, user.display_name, user.role)


def require_global(*roles: str):
    def dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(403, "Permiso insuficiente")
        return user
    return dep


def project_role(db: Session, user: CurrentUser, project_id: uuid.UUID) -> str | None:
    if user.is_admin:
        return "owner"
    m = db.get(ProjectMember, (project_id, user.id))
    return m.role if m else None


def authorize_project(db: Session, user: CurrentUser, project_id: uuid.UUID, capability: str) -> Project:
    """Comprueba existencia + pertenencia + capacidad. Evita acceso horizontal (404 si no es miembro)."""
    project = db.get(Project, project_id)
    role = project_role(db, user, project_id) if project else None
    if project is None or role is None:
        raise HTTPException(404, "Proyecto no encontrado")
    if role not in CAN[capability]:
        raise HTTPException(403, f"Tu rol '{role}' no permite esta acción")
    return project
