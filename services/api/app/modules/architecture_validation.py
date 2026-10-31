"""Validación de arquitecturas por familia (backend = frontera de seguridad).

Calcula formas de salida y número de parámetros SIN TensorFlow, para que el
diseñador tenga vista previa inmediata. El worker vuelve a construir el modelo
con Keras y compara el conteo como verificación cruzada.
"""
from __future__ import annotations

import math
from typing import Any

FAMILIES = ("feedforward", "rnn", "cnn", "gan")
ACTIVATIONS = ("relu", "sigmoid", "tanh", "softmax", "linear", "elu", "selu", "gelu", "leaky_relu", "swish")

LAYERS_BY_FAMILY: dict[str, set[str]] = {
    "feedforward": {"Dense", "Dropout", "BatchNormalization"},
    "cnn": {"Conv2D", "MaxPooling2D", "AveragePooling2D", "Flatten", "GlobalAveragePooling2D",
            "Dense", "Dropout", "BatchNormalization"},
    "rnn": {"SimpleRNN", "LSTM", "GRU", "Dense", "Dropout"},
    "gan": {"Dense", "Dropout", "BatchNormalization"},
}

INPUT_RANK = {"feedforward": 1, "cnn": 3, "rnn": 2, "gan": 1}

FAMILY_INFO = {
    "feedforward": {
        "label": "Feedforward (MLP)",
        "summary": "La información fluye en una sola dirección: entrada → capas ocultas → salida.",
        "use_cases": ["Clasificación tabular", "Regresión", "Scoring de riesgo"],
        "restrictions": ["Entrada vectorial 1D", "Capas Dense/Dropout/BatchNormalization", "Última capa Dense = salida"],
        "status": "ga",
    },
    "rnn": {
        "label": "Recurrente (RNN/LSTM/GRU)",
        "summary": "Mantiene un estado interno que recorre la secuencia paso a paso.",
        "use_cases": ["Series temporales", "Secuencias de sensores", "Texto (con embeddings)"],
        "restrictions": ["Entrada (pasos, características)", "Capas recurrentes intermedias con return_sequences=true",
                         "La última recurrente devuelve un vector"],
        "status": "beta",
    },
    "cnn": {
        "label": "Convolucional (CNN)",
        "summary": "Filtros que se deslizan sobre la imagen y detectan patrones locales.",
        "use_cases": ["Clasificación de imágenes", "Inspección visual", "Señales 2D"],
        "restrictions": ["Entrada (alto, ancho, canales)", "Flatten o GlobalAveragePooling2D antes de Dense",
                         "Las dimensiones espaciales no pueden quedar en 0"],
        "status": "beta",
    },
    "gan": {
        "label": "Generativa adversaria (GAN)",
        "summary": "Un generador crea muestras y un discriminador aprende a distinguirlas de las reales.",
        "use_cases": ["Datos sintéticos", "Aumento de datos", "Modelado de distribuciones"],
        "restrictions": ["Requiere generador y discriminador", "Salida del generador = forma de los datos",
                         "Discriminador termina en Dense(1, sigmoid)", "Entrenamiento habilitado por feature flag"],
        "status": "preview",
    },
}


class ValidationResult:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.layers: list[dict[str, Any]] = []
        self.total_params = 0
        self.trainable_params = 0
        self.output_shape: list[int] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "valid": not self.errors,
            "errors": self.errors,
            "warnings": self.warnings,
            "layers": self.layers,
            "total_params": self.total_params,
            "trainable_params": self.trainable_params,
            "output_shape": self.output_shape,
        }


def _int(layer: dict, key: str, default: int | None, lo: int, hi: int, errs: list[str], where: str) -> int:
    v = layer.get(key, default)
    if v is None or isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v:
        errs.append(f"{where}: '{key}' debe ser un entero")
        return lo
    v = int(v)
    if not lo <= v <= hi:
        errs.append(f"{where}: '{key}' debe estar entre {lo} y {hi}")
    return v


def _walk(layers: list, input_shape: list[int], family: str, limits: dict, res: ValidationResult,
          prefix: str = "") -> list[int] | None:
    allowed = LAYERS_BY_FAMILY[family]
    shape = list(input_shape)
    max_units = int(limits.get("max_units", 1024))
    if len(layers) > int(limits.get("max_layers", 24)):
        res.errors.append(f"{prefix}máximo {limits.get('max_layers')} capas")
    for i, layer in enumerate(layers):
        where = f"{prefix}Capa {i + 1}"
        if not isinstance(layer, dict):
            res.errors.append(f"{where}: formato inválido")
            return None
        t = layer.get("type")
        if t not in allowed:
            res.errors.append(f"{where}: el tipo '{t}' no está permitido en la familia {family}")
            return None
        act = layer.get("activation")
        if act is not None and act not in ACTIVATIONS:
            res.errors.append(f"{where}: activación '{act}' no soportada")
        params = 0
        trainable = None
        errs = res.errors
        if t == "Dense":
            if len(shape) != 1:
                hint = "agrega Flatten/GlobalAveragePooling2D" if family == "cnn" else \
                    "la última capa recurrente debe tener return_sequences=false"
                errs.append(f"{where}: Dense espera una entrada 1D, recibe {tuple(shape)} ({hint})")
                return None
            units = _int(layer, "units", None, 1, max_units, errs, where)
            params = shape[0] * units + units
            shape = [units]
        elif t == "Dropout":
            rate = layer.get("rate", 0.2)
            if not isinstance(rate, (int, float)) or not 0 <= rate < 1:
                errs.append(f"{where}: 'rate' debe estar en [0, 1)")
        elif t == "BatchNormalization":
            params = 4 * shape[-1]
            trainable = 2 * shape[-1]
        elif t == "Conv2D":
            if len(shape) != 3:
                errs.append(f"{where}: Conv2D espera (alto, ancho, canales), recibe {tuple(shape)}")
                return None
            f = _int(layer, "filters", None, 1, 512, errs, where)
            k = _int(layer, "kernel_size", 3, 1, 11, errs, where)
            s = _int(layer, "strides", 1, 1, 4, errs, where)
            pad = layer.get("padding", "valid")
            if pad not in ("valid", "same"):
                errs.append(f"{where}: padding debe ser 'valid' o 'same'")
            h, w, c = shape
            if pad == "same":
                oh, ow = math.ceil(h / s), math.ceil(w / s)
            else:
                oh, ow = (h - k) // s + 1, (w - k) // s + 1
            if oh <= 0 or ow <= 0:
                errs.append(f"{where}: el kernel {k}x{k} es mayor que la entrada {h}x{w}")
                return None
            params = k * k * c * f + f
            shape = [oh, ow, f]
        elif t in ("MaxPooling2D", "AveragePooling2D"):
            if len(shape) != 3:
                errs.append(f"{where}: {t} espera entrada 3D")
                return None
            p = _int(layer, "pool_size", 2, 1, 8, errs, where)
            h, w, c = shape
            oh, ow = (h - p) // p + 1, (w - p) // p + 1
            if oh <= 0 or ow <= 0:
                errs.append(f"{where}: pool {p}x{p} reduce la imagen a 0")
                return None
            shape = [oh, ow, c]
        elif t == "Flatten":
            shape = [math.prod(shape)]
        elif t == "GlobalAveragePooling2D":
            if len(shape) != 3:
                errs.append(f"{where}: GlobalAveragePooling2D espera entrada 3D")
                return None
            shape = [shape[-1]]
        elif t in ("SimpleRNN", "LSTM", "GRU"):
            if len(shape) != 2:
                errs.append(f"{where}: {t} espera (pasos, características), recibe {tuple(shape)}")
                return None
            units = _int(layer, "units", None, 1, max_units, errs, where)
            fin = shape[1]
            if t == "SimpleRNN":
                params = units * (units + fin + 1)
            elif t == "LSTM":
                params = 4 * units * (units + fin + 1)
            else:  # GRU con reset_after=True (Keras por defecto)
                params = 3 * units * (units + fin + 2)
            shape = [shape[0], units] if layer.get("return_sequences") else [units]
        trainable = params if trainable is None else trainable
        res.total_params += params
        res.trainable_params += trainable
        res.layers.append({"name": f"{prefix}{t.lower()}_{i + 1}", "type": t, "output_shape": list(shape),
                           "params": params})
    return shape


def validate_architecture(family: str, config: dict, limits: dict) -> ValidationResult:
    res = ValidationResult()
    if family not in FAMILIES:
        res.errors.append(f"Familia desconocida: {family}")
        return res
    if not isinstance(config, dict):
        res.errors.append("La configuración debe ser un objeto")
        return res

    input_shape = config.get("input_shape")
    if (not isinstance(input_shape, list) or not input_shape
            or not all(isinstance(x, int) and not isinstance(x, bool) and 0 < x <= 4096 for x in input_shape)):
        res.errors.append("input_shape debe ser una lista de enteros positivos")
        return res
    if len(input_shape) != INPUT_RANK[family]:
        res.errors.append(f"La familia {family} requiere input_shape de {INPUT_RANK[family]} dimensión(es)")
        return res

    if family == "gan":
        latent = config.get("latent_dim")
        if not isinstance(latent, int) or not 1 <= latent <= 256:
            res.errors.append("latent_dim debe ser un entero entre 1 y 256")
            return res
        gen = (config.get("generator") or {}).get("layers") or []
        disc = (config.get("discriminator") or {}).get("layers") or []
        if not gen or not disc:
            res.errors.append("Una GAN necesita capas en el generador y en el discriminador")
            return res
        g_out = _walk(gen, [latent], family, limits, res, "Generador · ")
        if g_out is not None and g_out != input_shape:
            res.errors.append(f"La salida del generador {tuple(g_out)} debe coincidir con los datos {tuple(input_shape)}")
        d_out = _walk(disc, input_shape, family, limits, res, "Discriminador · ")
        if d_out is not None:
            last = disc[-1]
            if d_out != [1] or last.get("activation") != "sigmoid":
                res.errors.append("El discriminador debe terminar en Dense(1, sigmoid)")
        res.output_shape = input_shape
        return res

    layers = config.get("layers")
    if not isinstance(layers, list) or not layers:
        res.errors.append("Agrega al menos una capa")
        return res
    out = _walk(layers, input_shape, family, limits, res)
    if out is None:
        return res
    if layers[-1].get("type") != "Dense":
        res.errors.append("La última capa debe ser Dense (capa de salida)")
    res.output_shape = out
    if family == "rnn" and not any(l.get("type") in ("SimpleRNN", "LSTM", "GRU") for l in layers):
        res.errors.append("Una red recurrente necesita al menos una capa SimpleRNN, LSTM o GRU")
    if family == "cnn" and not any(l.get("type") == "Conv2D" for l in layers):
        res.errors.append("Una CNN necesita al menos una capa Conv2D")
    hidden = [l for l in layers[:-1] if l.get("type") == "Dense"]
    if family == "feedforward" and not hidden:
        res.warnings.append("Sin capas ocultas el modelo equivale a una regresión lineal/logística")
    if any(l.get("activation") == "softmax" for l in layers[:-1]):
        res.warnings.append("softmax suele usarse solo en la capa de salida")
    return res


def check_dataset_compatibility(family: str, config: dict, summary: dict, meta: dict) -> list[str]:
    """Reglas entre arquitectura y dataset antes de encolar un entrenamiento."""
    errors: list[str] = []
    if list(config.get("input_shape", [])) != list(meta.get("input_shape", [])):
        errors.append(f"input_shape {config.get('input_shape')} no coincide con el dataset {meta.get('input_shape')}")
    if family == "gan":
        return errors
    task = meta.get("task")
    out = summary.get("output_shape") or []
    last_act = (config.get("layers") or [{}])[-1].get("activation", "linear")
    if task == "binary":
        if not (out == [1] and last_act == "sigmoid") and not (out == [2] and last_act == "softmax"):
            errors.append("Clasificación binaria: la salida debe ser Dense(1, sigmoid) o Dense(2, softmax)")
    elif task == "multiclass":
        n = meta.get("n_classes")
        if out != [n] or last_act != "softmax":
            errors.append(f"Clasificación de {n} clases: la salida debe ser Dense({n}, softmax)")
    elif task == "regression":
        if out != [1] or last_act not in ("linear", None):
            errors.append("Regresión: la salida debe ser Dense(1, linear)")
    return errors
