import json
import logging
import re
import sys
import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

_SECRET = re.compile(r"(bearer\s+)[\w\-\.]+|(password|token|secret|apikey)=([^&\s]+)", re.I)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        msg = _SECRET.sub(lambda m: (m.group(1) or (m.group(2) + "=")) + "***", record.getMessage())
        data = {"ts": self.formatTime(record), "level": record.levelname, "logger": record.name, "msg": msg}
        for k in ("method", "path", "status", "ms"):
            if hasattr(record, k):
                data[k] = getattr(record, k)
        if record.exc_info:
            data["exc"] = self.formatException(record.exc_info)[-2000:]
        return json.dumps(data, ensure_ascii=False)


def setup_logging() -> None:
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [h]
    root.setLevel(logging.INFO)
    logging.getLogger("uvicorn.access").disabled = True


class AccessLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        t0 = time.perf_counter()
        response = await call_next(request)
        logging.getLogger("neurolab.http").info(
            "request", extra={"method": request.method, "path": request.url.path, "status": response.status_code,
                              "ms": round((time.perf_counter() - t0) * 1000, 1)})
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Límite simple por IP (ventana deslizante en memoria). Para varias instancias usar Redis."""

    def __init__(self, app, per_minute: int = 240):
        super().__init__(app)
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        if request.url.path.endswith("/events") or request.method == "OPTIONS":
            return await call_next(request)
        ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0]
        now = time.monotonic()
        q = self.hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= self.per_minute:
            return JSONResponse({"detail": "Demasiadas solicitudes, intenta en un minuto"}, status_code=429)
        q.append(now)
        return await call_next(request)
