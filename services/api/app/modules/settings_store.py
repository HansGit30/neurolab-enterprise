"""Configuración global persistida (límites, features, retención, registro)."""
from sqlalchemy.orm import Session

from ..models import SystemSetting

DEFAULTS: dict[str, dict] = {
    "limits": {
        "max_epochs": 200,
        "max_batch_size": 1024,
        "max_concurrent_jobs_per_user": 2,
        "max_upload_mb": 10,
        "job_timeout_seconds": 900,
        "max_layers": 24,
        "max_units": 1024,
    },
    "features": {
        "gan_training_enabled": False,
        "rnn_training_enabled": True,
        "cnn_training_enabled": True,
    },
    "retention": {"audit_days": 365, "logs_days": 90},
    "signup": {"default_role": "project_owner"},
}


def get_setting(db: Session, key: str) -> dict:
    row = db.get(SystemSetting, key)
    merged = dict(DEFAULTS.get(key, {}))
    if row and isinstance(row.value, dict):
        merged.update(row.value)
    return merged


def all_settings(db: Session) -> dict[str, dict]:
    return {k: get_setting(db, k) for k in DEFAULTS}


def put_setting(db: Session, key: str, value: dict) -> dict:
    row = db.get(SystemSetting, key)
    if row is None:
        row = SystemSetting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    return value
