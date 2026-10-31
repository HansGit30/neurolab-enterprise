import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ.update({
    "ENVIRONMENT": "test",
    "AUTH_MODE": "dev",
    # TEST_DATABASE_URL permite correr la suite contra PostgreSQL con la migración aplicada
    "DATABASE_URL": os.getenv("TEST_DATABASE_URL", f"sqlite:///{_tmp}/test.db"),
    "CREATE_TABLES": "false" if os.getenv("TEST_DATABASE_URL") else "true",
    "EMBEDDED_WORKER": "false",
    "LOCAL_STORAGE_DIR": f"{_tmp}/storage",
    "SUPABASE_URL": "",
    "SUPABASE_SERVICE_ROLE_KEY": "",
})
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def as_user(email: str) -> dict:
    return {"X-Dev-User": email}
