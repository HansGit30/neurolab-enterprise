from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración por variables de entorno (nunca secretos en el código)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"  # development | test | production
    code_version: str = "1.0.0"

    # Base de datos (Supabase → Connect → Session pooler, puerto 5432)
    database_url: str = "sqlite:///./neurolab.db"
    create_tables: bool = False  # solo desarrollo local; en Supabase se usa la migración SQL

    # Autenticación
    auth_mode: str = "supabase"  # supabase | dev
    supabase_url: str = ""
    supabase_jwt_secret: str = ""  # opcional: proyectos con "Legacy JWT secret" (HS256)
    supabase_service_role_key: str = ""  # SOLO servidor, para Storage

    # Almacenamiento de objetos
    storage_bucket: str = "neurolab"
    local_storage_dir: str = "./.storage"

    # CORS: lista separada por comas (URL de Vercel)
    cors_origins: str = "http://localhost:5173"

    # Worker: embebido en el proceso de la API (necesita TensorFlow y >=1 GB RAM) o servicio aparte
    embedded_worker: bool = True
    worker_poll_seconds: float = 2.0
    # URL pública del worker externo (p. ej. https://<usuario>-neurolab-worker.hf.space).
    # La API la visita al encolar un trabajo para "despertarlo" si la plataforma lo durmió.
    worker_wake_url: str = ""

    @field_validator("database_url")
    @classmethod
    def normalize_db_url(cls, v: str) -> str:
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    @property
    def cors_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def use_supabase_storage(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.environment == "production" and s.auth_mode != "supabase":
        raise RuntimeError("AUTH_MODE=dev no está permitido en producción")
    return s
