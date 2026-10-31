"""Visor de red (pesos/activaciones reales), CSV subido y verificación de JWT de Supabase."""
import io
import time
import uuid

import jwt
import numpy as np
import pytest
from conftest import as_user
from cryptography.hazmat.primitives.asymmetric import ec

U = as_user("visor@neurolab.test")
ADMIN = as_user("admin@neurolab.test")


def _owner(client):
    client.get("/api/v1/me", headers=ADMIN)
    uid = client.get("/api/v1/me", headers=U).json()["id"]
    client.patch(f"/api/v1/admin/users/{uid}", headers=ADMIN, json={"role": "project_owner"})


def _run_worker():
    from app.workers import training as worker
    worker.run_job(worker.claim_next_job())


def test_network_snapshots_are_real_weights(client):
    _owner(client)
    pid = client.post("/api/v1/projects", headers=U, json={"name": "Visor"}).json()["id"]
    did = client.post(f"/api/v1/projects/{pid}/datasets/builtin", headers=U, json={"generator": "spiral", "n_samples": 300}).json()["id"]
    cfg = {"input_shape": [2], "layers": [{"type": "Dense", "units": 40, "activation": "relu"},
                                         {"type": "Dropout", "rate": 0.1},
                                         {"type": "Dense", "units": 12, "activation": "tanh"},
                                         {"type": "Dense", "units": 3, "activation": "softmax"}]}
    aid = client.post(f"/api/v1/projects/{pid}/architectures", headers=U, json={"name": "mlp", "family": "feedforward", "config": cfg}).json()["id"]
    jid = client.post(f"/api/v1/projects/{pid}/training-jobs", headers=U,
                      json={"architecture_id": aid, "dataset_id": did, "params": {"epochs": 6}}).json()["id"]
    _run_worker()

    epochs = client.get(f"/api/v1/training-jobs/{jid}/network/epochs", headers=U).json()
    assert epochs[0] == 0 and epochs[-1] == 6          # pesos iniciales + todas las épocas (≤ 60)
    first = client.get(f"/api/v1/training-jobs/{jid}/network?epoch=0", headers=U).json()
    last = client.get(f"/api/v1/training-jobs/{jid}/network", headers=U).json()
    assert [l["name"] for l in last["layers"]] == ["Entrada", "H1", "H2", "Salida"]   # Dropout se atraviesa
    assert last["layers"][1]["units"] == 40 and len(last["layers"][1]["shown"]) == 32  # muestra estable
    assert np.array(last["links"][0]["w"]).shape == (2, 32)
    assert np.array(last["links"][1]["w"]).shape == (32, 12)
    assert first["links"][0]["w"] != last["links"][0]["w"]   # los pesos cambiaron al entrenar
    probe = last["probes"][0]
    assert len(probe["acts"]) == 4 and abs(sum(probe["prediction"]) - 1) < 1e-3  # softmax real
    assert {p["label"] for p in last["probes"]} >= {"brazo A", "brazo B", "brazo C"}

    # Comprobación cruzada con el modelo guardado: la salida del visor = predicción de Keras
    import keras
    from app.modules import storage
    mid = client.get(f"/api/v1/projects/{pid}/models", headers=U).json()[0]
    from app.core.db import SessionLocal
    from app.models import ModelVersion
    with SessionLocal() as db:
        key = db.get(ModelVersion, uuid.UUID(mid["id"])).storage_key
    path = f"/tmp/visor_{mid['id']}.keras"
    open(path, "wb").write(storage.get_object(key))
    model = keras.models.load_model(path)
    x = np.array([probe["acts"][0]], dtype="float32")
    np.testing.assert_allclose(model.predict(x, verbose=0)[0], probe["prediction"], atol=2e-3)

    # SSE anuncia la red
    with client.stream("GET", f"/api/v1/training-jobs/{jid}/events", headers=U) as s:
        body = "".join(s.iter_text())
    assert "event: network" in body
    # acceso ajeno bloqueado
    assert client.get(f"/api/v1/training-jobs/{jid}/network", headers=as_user("otro@x.test")).status_code == 404


def test_cnn_snapshot_aggregates_after_flatten(client):
    _owner(client)
    pid = client.post("/api/v1/projects", headers=U, json={"name": "Visor CNN"}).json()["id"]
    did = client.post(f"/api/v1/projects/{pid}/datasets/builtin", headers=U, json={"generator": "bars_8x8", "n_samples": 200}).json()["id"]
    cfg = {"input_shape": [8, 8, 1], "layers": [{"type": "Conv2D", "filters": 6, "kernel_size": 3, "activation": "relu"},
                                               {"type": "Flatten"}, {"type": "Dense", "units": 3, "activation": "softmax"}]}
    aid = client.post(f"/api/v1/projects/{pid}/architectures", headers=U, json={"name": "cnn", "family": "cnn", "config": cfg}).json()["id"]
    jid = client.post(f"/api/v1/projects/{pid}/training-jobs", headers=U,
                      json={"architecture_id": aid, "dataset_id": did, "params": {"epochs": 2}}).json()["id"]
    _run_worker()
    net = client.get(f"/api/v1/training-jobs/{jid}/network", headers=U).json()
    assert [l["units"] for l in net["layers"]] == [1, 6, 3]
    assert np.array(net["links"][1]["w"]).shape == (6, 3) and net["links"][1]["aggregated"]


def test_csv_upload_and_training(client):
    _owner(client)
    pid = client.post("/api/v1/projects", headers=U, json={"name": "CSV propio"}).json()["id"]
    rng = np.random.default_rng(0)
    rows = ["edad,ingreso,deuda,aprobado"]
    for _ in range(300):
        a, i, d = rng.integers(18, 70), rng.normal(3000, 800), rng.normal(1000, 400)
        rows.append(f"{a},{i:.1f},{d:.1f},{'si' if i - d > 1900 else 'no'}")
    files = {"file": ("creditos.csv", io.BytesIO("\n".join(rows).encode()), "text/csv")}
    r = client.post(f"/api/v1/projects/{pid}/datasets/upload", headers=U, files=files, data={"name": "Créditos"})
    assert r.status_code == 201, r.text
    meta = r.json()["metadata_json"]
    assert meta["task"] == "binary" and meta["input_shape"] == [3] and meta["class_names"] == ["no", "si"]
    bad = client.post(f"/api/v1/projects/{pid}/datasets/upload", headers=U,
                      files={"file": ("x.exe", io.BytesIO(b"MZ\x00\x00"), "application/octet-stream")}, data={"name": "malo"})
    assert bad.status_code == 415
    cfg = {"input_shape": [3], "layers": [{"type": "Dense", "units": 8, "activation": "relu"},
                                         {"type": "Dense", "units": 1, "activation": "sigmoid"}]}
    aid = client.post(f"/api/v1/projects/{pid}/architectures", headers=U, json={"name": "credito", "family": "feedforward", "config": cfg}).json()["id"]
    jid = client.post(f"/api/v1/projects/{pid}/training-jobs", headers=U,
                      json={"architecture_id": aid, "dataset_id": r.json()["id"], "params": {"epochs": 15}}).json()["id"]
    _run_worker()
    job = client.get(f"/api/v1/training-jobs/{jid}", headers=U).json()
    assert job["status"] == "COMPLETED" and job["result_json"]["test"]["accuracy"] > 0.8


# ----------------------------------------------------------------------------- JWT de Supabase
def _claims(sub, email):
    return {"sub": sub, "email": email, "aud": "authenticated", "exp": int(time.time()) + 600,
            "user_metadata": {"display_name": "Sup"}}


def test_supabase_jwt_hs256_and_es256(client, monkeypatch):
    from app.core import auth

    monkeypatch.setattr(auth.settings, "auth_mode", "supabase")
    monkeypatch.setattr(auth.settings, "supabase_jwt_secret", "x" * 40)
    sub = str(uuid.uuid4())
    good = jwt.encode(_claims(sub, "hs@supa.test"), "x" * 40, algorithm="HS256")
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {good}"})
    assert r.status_code == 200 and r.json()["id"] == sub

    forged = jwt.encode(_claims(sub, "hs@supa.test"), "y" * 40, algorithm="HS256")
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    expired = jwt.encode({**_claims(sub, "hs@supa.test"), "exp": int(time.time()) - 10}, "x" * 40, algorithm="HS256")
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    assert client.get("/api/v1/me").status_code == 401

    # Nuevas signing keys (ES256 vía JWKS)
    key = ec.generate_private_key(ec.SECP256R1())

    class FakeJWKS:
        def get_signing_key_from_jwt(self, token):
            return type("K", (), {"key": key.public_key()})()

    monkeypatch.setattr(auth, "_jwks", lambda: FakeJWKS())
    sub2 = str(uuid.uuid4())
    es = jwt.encode(_claims(sub2, "es@supa.test"), key, algorithm="ES256", headers={"kid": "k1"})
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {es}"})
    assert r.status_code == 200 and r.json()["email"] == "es@supa.test"
    other = ec.generate_private_key(ec.SECP256R1())
    bad = jwt.encode(_claims(sub2, "es@supa.test"), other, algorithm="ES256", headers={"kid": "k1"})
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {bad}"}).status_code == 401


def test_dev_auth_blocked_in_production(monkeypatch):
    from app.core import config
    config.get_settings.cache_clear()
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AUTH_MODE", "dev")
    with pytest.raises(RuntimeError):
        config.get_settings()
    config.get_settings.cache_clear()
