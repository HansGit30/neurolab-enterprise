"""Almacenamiento de objetos: Supabase Storage (producción) o disco local (desarrollo)."""
from __future__ import annotations

import os
from pathlib import Path

import httpx

from ..core.config import get_settings

settings = get_settings()


class StorageError(RuntimeError):
    pass


def _safe_key(key: str) -> str:
    if ".." in key or key.startswith("/"):
        raise StorageError("Clave de almacenamiento inválida")
    return key


def _headers(content_type: str | None = None) -> dict[str, str]:
    key = settings.supabase_service_role_key
    # Claves nuevas (sb_secret_…) van SOLO en "apikey"; la legacy service_role (JWT) también como Bearer
    h = {"apikey": key} if key.startswith("sb_") else {"Authorization": f"Bearer {key}", "apikey": key}
    if content_type:
        h["Content-Type"] = content_type
    return h


def _base() -> str:
    return settings.supabase_url.rstrip("/") + "/storage/v1"


def put_object(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    key = _safe_key(key)
    if settings.use_supabase_storage:
        r = httpx.post(f"{_base()}/object/{settings.storage_bucket}/{key}", content=data,
                       headers={**_headers(content_type), "x-upsert": "false"}, timeout=120)
        if r.status_code >= 300:
            raise StorageError(f"Supabase Storage respondió {r.status_code}: {r.text[:200]}")
        return
    path = Path(settings.local_storage_dir) / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def get_object(key: str) -> bytes:
    key = _safe_key(key)
    if settings.use_supabase_storage:
        r = httpx.get(f"{_base()}/object/{settings.storage_bucket}/{key}", headers=_headers(), timeout=120)
        if r.status_code >= 300:
            raise StorageError(f"No se pudo descargar el objeto ({r.status_code})")
        return r.content
    path = Path(settings.local_storage_dir) / key
    if not path.exists():
        raise StorageError("Objeto no encontrado")
    return path.read_bytes()


def delete_object(key: str) -> None:
    key = _safe_key(key)
    if settings.use_supabase_storage:
        httpx.request("DELETE", f"{_base()}/object/{settings.storage_bucket}", headers=_headers("application/json"),
                      json={"prefixes": [key]}, timeout=60)
        return
    path = Path(settings.local_storage_dir) / key
    if path.exists():
        os.remove(path)


def ping() -> dict:
    if not settings.use_supabase_storage:
        return {"backend": "local", "ok": True}
    try:
        r = httpx.get(f"{_base()}/bucket/{settings.storage_bucket}", headers=_headers(), timeout=10)
        return {"backend": "supabase", "ok": r.status_code == 200}
    except Exception:
        return {"backend": "supabase", "ok": False}
