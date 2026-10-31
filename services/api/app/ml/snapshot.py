"""Instantáneas de la red: pesos y activaciones REALES leídos del modelo Keras.

Formato (lo consume el visor del frontend):
{
  "epoch": 12,
  "layers": [ {"name": "Entrada", "type": "Input", "activation": null, "units": 2,
               "shown": [0, 1], "bias": null, "shape": [2]}, ... ],
  "links":  [ {"w": [[...]], "aggregated": false}, ... ],   # links[i] conecta layers[i] → layers[i+1]
  "probes": [ {"label": "clase 1", "target": 1, "prediction": [0.93], "acts": [[...], [...], ...]} ],
  "stats":  {"max_abs_w": 1.8}
}
Solo se muestran capas con neuronas (Dense, Conv2D por filtro, RNN por unidad). Dropout,
BatchNormalization, Flatten y pooling se "atraviesan". Con más de MAX_SHOWN neuronas se toma una
muestra estable (siempre las mismas posiciones) para que la animación entre épocas sea coherente.
"""
from __future__ import annotations

import math

import numpy as np

MAX_SHOWN = 32
VISIBLE = {"Dense", "Conv2D", "SimpleRNN", "LSTM", "GRU"}
N_PROBES = 4


def snapshot_epochs(total: int, limit: int = 60) -> set[int]:
    step = max(1, math.ceil(total / limit))
    return {e for e in range(1, total + 1) if e == 1 or e % step == 0 or e == total}


def _shown(n: int) -> list[int]:
    if n <= MAX_SHOWN:
        return list(range(n))
    return sorted(set(np.linspace(0, n - 1, MAX_SHOWN).round().astype(int).tolist()))


def _reduce_act(a: np.ndarray) -> np.ndarray:
    """(n, ..., units) → (n, units): promedio espacial en CNN, último paso en secuencias."""
    if a.ndim == 4:
        return a.mean(axis=(1, 2))
    if a.ndim == 3:
        return a[:, -1, :]
    return a


def _input_acts(X: np.ndarray) -> np.ndarray:
    if X.ndim == 4:
        return X.mean(axis=(1, 2))
    if X.ndim == 3:
        return X[:, -1, :]
    return X


def _kernel_matrix(layer, prev_units: int) -> tuple[np.ndarray, bool, np.ndarray | None]:
    """Matriz (entrada visible × salida) de fuerza de conexión. aggregated=True si se resumió."""
    t = layer.__class__.__name__
    w = layer.get_weights()
    k = w[0]
    bias = None
    if t == "Dense":
        bias = w[1] if len(w) > 1 else None
        if k.shape[0] == prev_units:
            return k, False, bias
        if prev_units and k.shape[0] % prev_units == 0:  # tras Flatten de un mapa (h·w·c): promedio por canal
            return k.reshape(-1, prev_units, k.shape[1]).mean(axis=0), True, bias
        return np.zeros((prev_units, k.shape[1])), True, bias
    if t == "Conv2D":
        bias = w[1] if len(w) > 1 else None
        return k.mean(axis=(0, 1)), True, bias  # (k,k,cin,cout) → (cin,cout)
    units = layer.units
    gates = {"SimpleRNN": 1, "LSTM": 4, "GRU": 3}[t]
    return k.reshape(k.shape[0], gates, units).mean(axis=1), gates > 1, None


def _label(meta: dict, y) -> str:
    task = meta.get("task")
    names = meta.get("class_names") or []
    if task in ("binary", "multiclass"):
        i = int(round(float(y)))
        return names[i] if i < len(names) else f"clase {i}"
    if task == "regression":
        return f"y = {float(y):.3f}"
    return "ruido latente"


def pick_probes(X: np.ndarray, y: np.ndarray, meta: dict, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Elige muestras de prueba fijas; en clasificación intenta una por clase."""
    rng = np.random.default_rng(seed)
    if meta.get("task") in ("binary", "multiclass"):
        idx: list[int] = []
        for c in np.unique(y.astype(int)):
            cand = np.where(y.astype(int) == c)[0]
            idx.append(int(rng.choice(cand)))
        rest = [i for i in rng.permutation(len(X)) if i not in idx]
        idx = (idx + rest)[:N_PROBES]
    else:
        idx = rng.choice(len(X), size=min(N_PROBES, len(X)), replace=False).tolist()
    return X[idx], y[idx]


def build_snapshot(model, Xp: np.ndarray, yp: np.ndarray, meta: dict, epoch: int, input_label: str = "Entrada") -> dict:
    import keras

    vis = [l for l in model.layers if l.__class__.__name__ in VISIBLE]
    probe_model = keras.Model(inputs=model.inputs[0], outputs=[l.output for l in vis])
    outs = probe_model(Xp, training=False)
    outs = [np.asarray(o) for o in (outs if isinstance(outs, (list, tuple)) else [outs])]

    in_acts = _input_acts(Xp)
    in_units = in_acts.shape[1]
    layers = [{"name": input_label, "type": "Input", "activation": None, "units": int(in_units),
               "shown": _shown(in_units), "bias": None, "shape": list(Xp.shape[1:])}]
    acts = [in_acts]
    links = []
    prev = in_units
    max_abs = 1e-9
    for i, l in enumerate(vis):
        t = l.__class__.__name__
        units = int(l.units if hasattr(l, "units") else l.filters)
        M, aggregated, bias = _kernel_matrix(l, prev)
        src, dst = layers[-1]["shown"], _shown(units)
        sub = M[np.ix_(src, dst)]
        max_abs = max(max_abs, float(np.abs(sub).max()) if sub.size else 0)
        links.append({"w": np.round(sub, 4).tolist(), "aggregated": aggregated})
        act_name = getattr(getattr(l, "activation", None), "__name__", None)
        is_last = i == len(vis) - 1
        layers.append({
            "name": "Salida" if is_last else f"H{i + 1}", "type": t, "activation": act_name, "units": units,
            "shown": dst, "bias": np.round(bias[dst], 4).tolist() if bias is not None else None,
        })
        acts.append(_reduce_act(outs[i]))
        prev = units

    probes = []
    for p in range(len(Xp)):
        probes.append({
            "label": _label(meta, yp[p]),
            "target": float(yp[p]),
            "prediction": np.round(acts[-1][p], 4).tolist(),
            "acts": [np.round(a[p, layers[k]["shown"]], 4).tolist() for k, a in enumerate(acts)],
        })
    return {"epoch": epoch, "layers": layers, "links": links, "probes": probes,
            "task": meta.get("task"), "class_names": list(meta.get("class_names") or []),
            "stats": {"max_abs_w": round(max_abs, 4)}}
