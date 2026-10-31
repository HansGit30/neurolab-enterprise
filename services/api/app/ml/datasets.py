"""Datasets demo (sintéticos, sin datos sensibles) y carga de CSV validada.

Cada dataset devuelve X, y y metadatos: task (binary|multiclass|regression|generative),
input_shape, n_classes, n_samples, feature_names, class_names.
"""
from __future__ import annotations

import io
from typing import Any

import numpy as np

BUILTIN: dict[str, dict[str, Any]] = {
    "moons": {"label": "Dos lunas", "family": "feedforward", "task": "binary",
              "description": "2 características, 2 clases entrelazadas. Clásico para mostrar fronteras no lineales."},
    "circles": {"label": "Círculos concéntricos", "family": "feedforward", "task": "binary",
                "description": "2 características; una clase rodea a la otra."},
    "spiral": {"label": "Espiral de 3 brazos", "family": "feedforward", "task": "multiclass",
               "description": "2 características, 3 clases en espiral. Requiere capas ocultas."},
    "xor": {"label": "XOR con ruido", "family": "feedforward", "task": "binary",
            "description": "El problema que un perceptrón simple no puede resolver."},
    "sine": {"label": "Regresión seno", "family": "feedforward", "task": "regression",
             "description": "1 característica → y = sin(x) + ruido."},
    "seq_trend": {"label": "Secuencias: tendencia", "family": "rnn", "task": "multiclass",
                  "description": "Series de 20 pasos: sube, baja u oscila. Forma (20, 1)."},
    "bars_8x8": {"label": "Imágenes 8×8: barras", "family": "cnn", "task": "multiclass",
                 "description": "Imágenes 8×8 con barra horizontal, vertical o diagonal. Forma (8, 8, 1)."},
    "gaussian_ring": {"label": "Anillo gaussiano (GAN)", "family": "gan", "task": "generative",
                      "description": "Puntos 2D sobre un anillo; la GAN aprende a generarlos."},
}


def _moons(n, rng):
    h = n // 2
    t1 = rng.uniform(0, np.pi, h)
    t2 = rng.uniform(0, np.pi, n - h)
    a = np.c_[np.cos(t1), np.sin(t1)]
    b = np.c_[1 - np.cos(t2), 0.5 - np.sin(t2)]
    X = np.r_[a, b] + rng.normal(0, 0.12, (n, 2))
    y = np.r_[np.zeros(h), np.ones(n - h)]
    return X, y


def _circles(n, rng):
    h = n // 2
    t = rng.uniform(0, 2 * np.pi, n)
    r = np.r_[np.full(h, 1.0), np.full(n - h, 0.45)]
    X = np.c_[r * np.cos(t), r * np.sin(t)] + rng.normal(0, 0.08, (n, 2))
    y = np.r_[np.zeros(h), np.ones(n - h)]
    return X, y


def _spiral(n, rng, k=3):
    per = n // k
    X, y = [], []
    for c in range(k):
        r = np.linspace(0.05, 1, per)
        t = np.linspace(c * 4, (c + 1) * 4, per) + rng.normal(0, 0.2, per)
        X.append(np.c_[r * np.sin(t), r * np.cos(t)])
        y.append(np.full(per, c))
    return np.vstack(X), np.concatenate(y)


def _xor(n, rng):
    X = rng.uniform(-1, 1, (n, 2))
    y = ((X[:, 0] > 0) ^ (X[:, 1] > 0)).astype(float)
    return X + rng.normal(0, 0.05, X.shape), y


def _sine(n, rng):
    x = rng.uniform(-3, 3, (n, 1))
    return x, (np.sin(x[:, 0]) + rng.normal(0, 0.1, n))


def _seq_trend(n, rng, steps=20):
    t = np.linspace(0, 1, steps)
    X = np.zeros((n, steps, 1))
    y = rng.integers(0, 3, n)
    for i, c in enumerate(y):
        slope = rng.uniform(0.5, 1.5)
        if c == 0:
            s = slope * t
        elif c == 1:
            s = -slope * t
        else:
            s = 0.5 * np.sin(2 * np.pi * rng.uniform(1.5, 3) * t + rng.uniform(0, np.pi))
        X[i, :, 0] = s + rng.normal(0, 0.08, steps)
    return X, y.astype(float)


def _bars(n, rng, size=8):
    X = rng.normal(0, 0.1, (n, size, size, 1))
    y = rng.integers(0, 3, n)
    for i, c in enumerate(y):
        p = rng.integers(1, size - 1)
        if c == 0:
            X[i, p, :, 0] += 1
        elif c == 1:
            X[i, :, p, 0] += 1
        else:
            idx = np.arange(size)
            X[i, idx, idx if rng.random() < 0.5 else idx[::-1], 0] += 1
    return X, y.astype(float)


def _ring(n, rng):
    t = rng.uniform(0, 2 * np.pi, n)
    r = 1 + rng.normal(0, 0.05, n)
    return np.c_[r * np.cos(t), r * np.sin(t)], np.zeros(n)


GENERATORS = {"moons": _moons, "circles": _circles, "spiral": _spiral, "xor": _xor, "sine": _sine,
              "seq_trend": _seq_trend, "bars_8x8": _bars, "gaussian_ring": _ring}

CLASS_NAMES = {"spiral": ["brazo A", "brazo B", "brazo C"], "seq_trend": ["sube", "baja", "oscila"],
               "bars_8x8": ["horizontal", "vertical", "diagonal"]}


def builtin_metadata(key: str, n_samples: int = 1000) -> dict[str, Any]:
    X, y = load_builtin(key, n_samples, seed=0)
    info = BUILTIN[key]
    task = info["task"]
    n_classes = int(len(np.unique(y))) if task in ("binary", "multiclass") else None
    return {
        "kind": "builtin", "generator": key, "label": info["label"], "description": info["description"],
        "recommended_family": info["family"], "task": task, "input_shape": list(X.shape[1:]),
        "n_classes": n_classes, "n_samples": int(X.shape[0]),
        "class_names": CLASS_NAMES.get(key, [str(i) for i in range(n_classes)] if n_classes else []),
        "feature_names": [f"x{i + 1}" for i in range(X.shape[1])] if X.ndim == 2 else [],
        "splits": {"train": 0.7, "validation": 0.15, "test": 0.15},
    }


def load_builtin(key: str, n_samples: int = 1000, seed: int = 42):
    if key not in GENERATORS:
        raise ValueError(f"Dataset demo desconocido: {key}")
    rng = np.random.default_rng(seed)
    X, y = GENERATORS[key](n_samples, rng)
    perm = rng.permutation(len(X))
    return X[perm].astype("float32"), y[perm].astype("float32")


# ----------------------------------------------------------------------------- CSV
MAX_ROWS = 200_000
MAX_COLS = 256


def parse_csv(content: bytes, target: str | None) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Valida y convierte un CSV tabular. Nunca ejecuta contenido; solo parsea texto."""
    import pandas as pd
    from pandas.api.types import is_numeric_dtype

    if b"\x00" in content[:4096]:
        raise ValueError("El archivo no parece texto CSV")
    try:
        df = pd.read_csv(io.BytesIO(content), nrows=MAX_ROWS + 1)
    except Exception as exc:
        raise ValueError(f"CSV ilegible: {exc}") from exc
    if len(df) > MAX_ROWS:
        raise ValueError(f"Máximo {MAX_ROWS} filas")
    if df.shape[1] < 2 or df.shape[1] > MAX_COLS:
        raise ValueError(f"Se requieren entre 2 y {MAX_COLS} columnas")
    if len(df) < 20:
        raise ValueError("Se requieren al menos 20 filas")
    target = target or df.columns[-1]
    if target not in df.columns:
        raise ValueError(f"La columna objetivo '{target}' no existe")
    df = df.dropna()
    y_raw = df[target]
    feats = df.drop(columns=[target])
    non_numeric = [c for c in feats.columns if not is_numeric_dtype(feats[c])]
    if non_numeric:
        raise ValueError(f"Columnas no numéricas en las características: {', '.join(map(str, non_numeric[:5]))}")
    X = feats.to_numpy(dtype="float32")
    # Normalización z-score (se guardan medias/desviaciones como metadatos)
    mean, std = X.mean(axis=0), X.std(axis=0)
    std[std == 0] = 1
    X = (X - mean) / std

    if not is_numeric_dtype(y_raw) or (y_raw.nunique() <= 20 and bool((y_raw == y_raw.round()).all())):
        classes = sorted(map(str, y_raw.unique()))
        mapping = {c: i for i, c in enumerate(classes)}
        y = y_raw.astype(str).map(mapping).to_numpy(dtype="float32")
        task = "binary" if len(classes) == 2 else "multiclass"
        class_names = classes
    else:
        y = y_raw.to_numpy(dtype="float32")
        task, class_names = "regression", []
    if task == "multiclass" and len(class_names) < 2:
        raise ValueError("La columna objetivo tiene una sola clase")
    meta = {
        "kind": "upload", "task": task, "target": str(target), "input_shape": [X.shape[1]],
        "n_classes": len(class_names) if class_names else None, "n_samples": int(len(X)),
        "class_names": class_names, "feature_names": [str(c) for c in feats.columns],
        "normalization": {"mean": mean.round(6).tolist(), "std": std.round(6).tolist()},
        "recommended_family": "feedforward", "splits": {"train": 0.7, "validation": 0.15, "test": 0.15},
    }
    return X, y, meta


def split(X, y, splits: dict, seed: int):
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(X))
    n_tr = int(len(X) * splits.get("train", 0.7))
    n_va = int(len(X) * splits.get("validation", 0.15))
    tr, va, te = idx[:n_tr], idx[n_tr:n_tr + n_va], idx[n_tr + n_va:]
    return (X[tr], y[tr]), (X[va], y[va]), (X[te], y[te])
