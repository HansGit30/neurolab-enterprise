"""Entrenamiento real (pocas épocas) de RNN, CNN y GAN con los datasets demo."""
import pytest
from conftest import as_user

U = as_user("familias@neurolab.test")
ADMIN = as_user("admin@neurolab.test")

CASES = {
    "rnn": ("seq_trend", {"input_shape": [20, 1], "layers": [
        {"type": "GRU", "units": 8, "return_sequences": True},
        {"type": "LSTM", "units": 8},
        {"type": "Dense", "units": 3, "activation": "softmax"}]}),
    "cnn": ("bars_8x8", {"input_shape": [8, 8, 1], "layers": [
        {"type": "Conv2D", "filters": 8, "kernel_size": 3, "activation": "relu", "padding": "same"},
        {"type": "MaxPooling2D", "pool_size": 2},
        {"type": "Flatten"},
        {"type": "Dense", "units": 3, "activation": "softmax"}]}),
    "gan": ("gaussian_ring", {"input_shape": [2], "latent_dim": 4,
            "generator": {"layers": [{"type": "Dense", "units": 16, "activation": "relu"},
                                     {"type": "Dense", "units": 2, "activation": "linear"}]},
            "discriminator": {"layers": [{"type": "Dense", "units": 16, "activation": "leaky_relu"},
                                         {"type": "Dense", "units": 1, "activation": "sigmoid"}]}}),
}


@pytest.mark.parametrize("family", list(CASES))
def test_family_training(client, family):
    client.get("/api/v1/me", headers=ADMIN)
    if family == "gan":
        client.put("/api/v1/admin/settings/features", headers=ADMIN, json={"value": {"gan_training_enabled": True}})
    client.put("/api/v1/admin/users/" + client.get("/api/v1/me", headers=U).json()["id"], headers=ADMIN,
               json={"role": "project_owner"})
    gen, cfg = CASES[family]
    pid = client.post("/api/v1/projects", headers=U, json={"name": f"Familia {family}"}).json()["id"]
    did = client.post(f"/api/v1/projects/{pid}/datasets/builtin", headers=U, json={"generator": gen, "n_samples": 300}).json()["id"]
    a = client.post(f"/api/v1/projects/{pid}/architectures", headers=U, json={"name": family, "family": family, "config": cfg})
    assert a.status_code == 201, a.text
    j = client.post(f"/api/v1/projects/{pid}/training-jobs", headers=U,
                    json={"architecture_id": a.json()["id"], "dataset_id": did, "params": {"epochs": 2, "batch_size": 32}})
    assert j.status_code == 201, j.text
    from app.workers import training as worker
    worker.run_job(worker.claim_next_job())
    job = client.get(f"/api/v1/training-jobs/{j.json()['id']}", headers=U).json()
    assert job["status"] == "COMPLETED", job["error_message"]
    # el conteo de parámetros sin TF coincide con Keras
    assert a.json()["summary_json"]["total_params"] == job["result_json"]["params"] or family == "gan"
