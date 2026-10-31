import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .api.v1 import admin, architectures, datasets, models_registry, projects, training
from .core.config import get_settings
from .core.db import Base, SessionLocal, engine
from .core.logging import AccessLogMiddleware, RateLimitMiddleware, setup_logging

settings = get_settings()
setup_logging()
log = logging.getLogger("neurolab")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.create_tables:
        from . import models  # noqa: F401
        Base.metadata.create_all(engine)
    log.info("NeuroLab API v%s · entorno=%s · auth=%s · worker=%s", settings.code_version, settings.environment,
             settings.auth_mode, "embebido" if settings.embedded_worker else "externo")
    if settings.embedded_worker and settings.environment != "test":
        import importlib.util
        if importlib.util.find_spec("tensorflow") is None:
            log.error("EMBEDDED_WORKER=true pero TensorFlow no está instalado: instala requirements-worker.txt "
                      "o ejecuta el worker como servicio aparte (EMBEDDED_WORKER=false).")
        else:
            from .workers import training as worker
            worker.start_embedded()
    yield
    if settings.embedded_worker:
        from .workers import training as worker
        worker.stop()


app = FastAPI(
    title="NeuroLab Enterprise API",
    version=settings.code_version,
    description="Plataforma de experimentación y gestión de redes neuronales (Semana 11).",
    lifespan=lifespan,
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(AccessLogMiddleware)
app.add_middleware(RateLimitMiddleware, per_minute=240)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_origin_regex=r"https://.*\.vercel\.app" if settings.environment != "production" else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Dev-User", "Last-Event-ID"],
    expose_headers=["Content-Disposition", "X-Checksum-SHA256"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = [f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e in exc.errors()]
    return JSONResponse({"detail": {"message": "Datos de entrada inválidos", "errors": errors}}, status_code=422)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("error no controlado en %s", request.url.path)
    return JSONResponse({"detail": "Error interno. El incidente quedó registrado."}, status_code=500)


@app.get("/health", tags=["ops"])
def health():
    """Usado por Render como health check (sin autenticación, sin datos sensibles)."""
    try:
        with SessionLocal() as db:
            db.execute(text("select 1"))
        return {"status": "ok", "version": settings.code_version}
    except Exception:
        return JSONResponse({"status": "degraded"}, status_code=503)


@app.get("/", include_in_schema=False)
def root():
    return {"name": "NeuroLab Enterprise API", "docs": "/docs", "health": "/health"}


PREFIX = "/api/v1"
for r in (projects.router, architectures.router, datasets.router, training.router, models_registry.router, admin.router):
    app.include_router(r, prefix=PREFIX)
