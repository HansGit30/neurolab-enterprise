"""Construcción de modelos Keras a partir de configuraciones YA validadas."""
from __future__ import annotations

from typing import Any


def _keras():
    import os
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    import keras  # noqa: E402
    return keras


def _layer(keras, spec: dict[str, Any], name: str):
    L = keras.layers
    t = spec["type"]
    act = spec.get("activation") or None
    if t == "Dense":
        return L.Dense(int(spec["units"]), activation=act, name=name)
    if t == "Dropout":
        return L.Dropout(float(spec.get("rate", 0.2)), name=name)
    if t == "BatchNormalization":
        return L.BatchNormalization(name=name)
    if t == "Conv2D":
        return L.Conv2D(int(spec["filters"]), int(spec.get("kernel_size", 3)), strides=int(spec.get("strides", 1)),
                        padding=spec.get("padding", "valid"), activation=act or "relu", name=name)
    if t == "MaxPooling2D":
        return L.MaxPooling2D(int(spec.get("pool_size", 2)), name=name)
    if t == "AveragePooling2D":
        return L.AveragePooling2D(int(spec.get("pool_size", 2)), name=name)
    if t == "Flatten":
        return L.Flatten(name=name)
    if t == "GlobalAveragePooling2D":
        return L.GlobalAveragePooling2D(name=name)
    if t in ("SimpleRNN", "LSTM", "GRU"):
        cls = getattr(L, t)
        kw = {"return_sequences": bool(spec.get("return_sequences", False)), "name": name}
        if act:
            kw["activation"] = act
        return cls(int(spec["units"]), **kw)
    raise ValueError(f"Capa no soportada: {t}")


def build_sequential(input_shape: list[int], layers: list[dict], name: str = "neurolab_model"):
    keras = _keras()
    model = keras.Sequential(name=name)
    model.add(keras.Input(shape=tuple(input_shape)))
    for i, spec in enumerate(layers):
        model.add(_layer(keras, spec, f"{spec['type'].lower()}_{i + 1}"))
    return model


def build_optimizer(name: str, lr: float):
    keras = _keras()
    opts = {"adam": keras.optimizers.Adam, "sgd": keras.optimizers.SGD, "rmsprop": keras.optimizers.RMSprop,
            "adamw": keras.optimizers.AdamW}
    if name not in opts:
        raise ValueError(f"Optimizador no soportado: {name}")
    return opts[name](learning_rate=lr)


def loss_and_metrics(task: str, output_units: int, last_activation: str) -> tuple[str, list[str]]:
    if task == "regression":
        return "mse", ["mae"]
    if task == "binary" and output_units == 1:
        return "binary_crossentropy", ["accuracy"]
    return "sparse_categorical_crossentropy", ["accuracy"]
