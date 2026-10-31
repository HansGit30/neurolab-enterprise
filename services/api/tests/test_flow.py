"""Flujo end-to-end del MVP + pruebas de seguridad (acceso horizontal)."""
from conftest import as_user

ADMIN = as_user("admin@neurolab.test")      # primer usuario → admin
OWNER = as_user("owner@neurolab.test")      # rol por defecto: project_owner
OTHER = as_user("intruso@neurolab.test")


def test_end_to_end(client):
    assert client.get("/api/v1/me", headers=ADMIN).json()["role"] == "admin"
    assert client.get("/api/v1/me", headers=OWNER).json()["role"] == "project_owner"
    client.get("/api/v1/me", headers=OTHER)

    p = client.post("/api/v1/projects", headers=OWNER, json={
        "name": "Clasificador lunas", "description": "Demo", "problem_statement": "Separar dos clases", "tags": ["demo"]})
    assert p.status_code == 201, p.text
    pid = p.json()["id"]

    d = client.post(f"/api/v1/projects/{pid}/datasets/builtin", headers=OWNER, json={"generator": "moons", "n_samples": 400})
    assert d.status_code == 201, d.text
    did = d.json()["id"]

    cfg = {"input_shape": [2], "layers": [
        {"type": "Dense", "units": 16, "activation": "relu"},
        {"type": "Dense", "units": 8, "activation": "relu"},
        {"type": "Dense", "units": 1, "activation": "sigmoid"}]}
    a = client.post(f"/api/v1/projects/{pid}/architectures", headers=OWNER,
                    json={"name": "MLP base", "family": "feedforward", "config": cfg, "justification": "Datos tabulares 2D"})
    assert a.status_code == 201, a.text
    aid = a.json()["id"]

    bad = client.post(f"/api/v1/projects/{pid}/architectures", headers=OWNER,
                      json={"name": "Mala", "family": "feedforward", "config": {"input_shape": [2], "layers": []}})
    assert bad.status_code == 422

    j = client.post(f"/api/v1/projects/{pid}/training-jobs", headers=OWNER,
                    json={"architecture_id": aid, "dataset_id": did, "params": {"epochs": 5, "batch_size": 32}})
    assert j.status_code == 201, j.text
    jid = j.json()["id"]
    assert j.json()["status"] == "QUEUED"

    # Seguridad: un usuario ajeno no puede leer ni cancelar
    assert client.get(f"/api/v1/training-jobs/{jid}", headers=OTHER).status_code == 404
    assert client.post(f"/api/v1/training-jobs/{jid}/cancel", headers=OTHER, json={}).status_code == 404
    assert client.get(f"/api/v1/projects/{pid}", headers=OTHER).status_code == 404

    # Worker: toma el trabajo y entrena con TensorFlow/Keras
    from app.workers import training as worker
    claimed = worker.claim_next_job()
    assert str(claimed) == jid
    worker.run_job(claimed)

    job = client.get(f"/api/v1/training-jobs/{jid}", headers=OWNER).json()
    assert job["status"] == "COMPLETED", job
    assert job["progress"] == 100
    assert "accuracy" in job["result_json"]["test"]

    metrics = client.get(f"/api/v1/training-jobs/{jid}/metrics", headers=OWNER).json()
    assert {m["epoch"] for m in metrics} == {1, 2, 3, 4, 5}

    # SSE: un trabajo terminado envía snapshot + end
    with client.stream("GET", f"/api/v1/training-jobs/{jid}/events", headers=OWNER) as s:
        body = "".join(s.iter_text())
    assert "event: snapshot" in body and "event: end" in body

    models = client.get(f"/api/v1/projects/{pid}/models", headers=OWNER).json()
    assert len(models) == 1 and models[0]["version"] == 1
    mid = models[0]["id"]
    dl = client.get(f"/api/v1/models/{mid}/download", headers=OWNER)
    assert dl.status_code == 200 and len(dl.content) > 1000

    # Revisión: el creador no puede aprobar su propio modelo
    assert client.post(f"/api/v1/models/{mid}/status", headers=OWNER, json={"status": "reviewed"}).status_code == 200
    assert client.post(f"/api/v1/models/{mid}/status", headers=OWNER, json={"status": "approved"}).status_code == 403
    assert client.post(f"/api/v1/models/{mid}/status", headers=ADMIN, json={"status": "approved"}).status_code == 200

    # Auditoría y exportación
    audit = client.get(f"/api/v1/projects/{pid}/audit-events", headers=OWNER).json()
    actions = {e["action"] for e in audit}
    assert {"project.created", "training.started", "model.status_changed"} <= actions
    csv = client.get(f"/api/v1/projects/{pid}/export/jobs.csv", headers=OWNER)
    assert csv.status_code == 200 and "COMPLETED" in csv.text


def test_cancel_flow(client):
    pid = client.post("/api/v1/projects", headers=OWNER, json={"name": "Cancelación"}).json()["id"]
    did = client.post(f"/api/v1/projects/{pid}/datasets/builtin", headers=OWNER, json={"generator": "spiral"}).json()["id"]
    cfg = {"input_shape": [2], "layers": [{"type": "Dense", "units": 8, "activation": "relu"},
                                         {"type": "Dense", "units": 3, "activation": "softmax"}]}
    aid = client.post(f"/api/v1/projects/{pid}/architectures", headers=OWNER,
                      json={"name": "Espiral", "family": "feedforward", "config": cfg}).json()["id"]
    jid = client.post(f"/api/v1/projects/{pid}/training-jobs", headers=OWNER,
                      json={"architecture_id": aid, "dataset_id": did, "params": {"epochs": 3}}).json()["id"]
    r = client.post(f"/api/v1/training-jobs/{jid}/cancel", headers=OWNER, json={"reason": "prueba"})
    assert r.status_code == 200 and r.json()["cancel_requested"]
    from app.workers import training as worker
    assert worker.claim_next_job() is None  # cancelado antes de iniciar
    assert client.get(f"/api/v1/training-jobs/{jid}", headers=OWNER).json()["status"] == "CANCELLED"


def test_member_roles(client):
    pid = client.post("/api/v1/projects", headers=OWNER, json={"name": "Colaborativo"}).json()["id"]
    r = client.post(f"/api/v1/projects/{pid}/members", headers=OWNER, json={"email": "intruso@neurolab.test", "role": "reader"})
    assert r.status_code == 201
    assert client.get(f"/api/v1/projects/{pid}", headers=OTHER).status_code == 200
    # lector no puede crear arquitecturas
    cfg = {"input_shape": [2], "layers": [{"type": "Dense", "units": 1, "activation": "sigmoid"}]}
    assert client.post(f"/api/v1/projects/{pid}/architectures", headers=OTHER,
                       json={"name": "x1", "family": "feedforward", "config": cfg}).status_code == 403
    # usuario no admin no accede a administración
    assert client.get("/api/v1/admin/users", headers=OWNER).status_code == 403
