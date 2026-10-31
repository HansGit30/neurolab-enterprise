import uuid

from sqlalchemy.orm import Session

from ..models import AuditEvent


def audit(
    db: Session,
    actor_id: uuid.UUID | None,
    action: str,
    project_id: uuid.UUID | None = None,
    **metadata,
) -> None:
    """Registra una acción relevante. Nunca guardar tokens ni contraseñas en metadata."""
    clean = {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in metadata.items()}
    db.add(AuditEvent(actor_id=actor_id, project_id=project_id, action=action, metadata_json=clean))
