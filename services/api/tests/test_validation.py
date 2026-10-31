from app.modules.architecture_validation import check_dataset_compatibility, validate_architecture

LIMITS = {"max_layers": 24, "max_units": 1024}


def test_feedforward_params():
    cfg = {"input_shape": [2], "layers": [
        {"type": "Dense", "units": 16, "activation": "relu"},
        {"type": "Dropout", "rate": 0.1},
        {"type": "Dense", "units": 1, "activation": "sigmoid"}]}
    r = validate_architecture("feedforward", cfg, LIMITS)
    assert r.errors == []
    assert r.total_params == (2 * 16 + 16) + (16 + 1)
    assert r.output_shape == [1]


def test_dense_needs_flatten_in_cnn():
    cfg = {"input_shape": [8, 8, 1], "layers": [
        {"type": "Conv2D", "filters": 4, "kernel_size": 3, "activation": "relu"},
        {"type": "Dense", "units": 3, "activation": "softmax"}]}
    r = validate_architecture("cnn", cfg, LIMITS)
    assert any("Flatten" in e for e in r.errors)


def test_cnn_shapes():
    cfg = {"input_shape": [8, 8, 1], "layers": [
        {"type": "Conv2D", "filters": 8, "kernel_size": 3, "activation": "relu"},
        {"type": "MaxPooling2D", "pool_size": 2},
        {"type": "Flatten"},
        {"type": "Dense", "units": 3, "activation": "softmax"}]}
    r = validate_architecture("cnn", cfg, LIMITS)
    assert r.errors == []
    assert r.layers[0]["output_shape"] == [6, 6, 8]
    assert r.layers[1]["output_shape"] == [3, 3, 8]
    assert r.total_params == (9 * 8 + 8) + (72 * 3 + 3)


def test_rnn_requires_vector_before_dense():
    cfg = {"input_shape": [20, 1], "layers": [
        {"type": "LSTM", "units": 8, "return_sequences": True},
        {"type": "Dense", "units": 3, "activation": "softmax"}]}
    assert validate_architecture("rnn", cfg, LIMITS).errors


def test_family_layer_whitelist():
    cfg = {"input_shape": [2], "layers": [{"type": "Conv2D", "filters": 2}]}
    assert validate_architecture("feedforward", cfg, LIMITS).errors


def test_gan_validation():
    cfg = {"input_shape": [2], "latent_dim": 8,
           "generator": {"layers": [{"type": "Dense", "units": 16, "activation": "relu"},
                                    {"type": "Dense", "units": 2, "activation": "linear"}]},
           "discriminator": {"layers": [{"type": "Dense", "units": 16, "activation": "relu"},
                                        {"type": "Dense", "units": 1, "activation": "sigmoid"}]}}
    assert validate_architecture("gan", cfg, LIMITS).errors == []


def test_dataset_compatibility():
    cfg = {"input_shape": [2], "layers": [{"type": "Dense", "units": 3, "activation": "softmax"}]}
    r = validate_architecture("feedforward", cfg, LIMITS).as_dict()
    assert check_dataset_compatibility("feedforward", cfg, r, {"input_shape": [2], "task": "multiclass", "n_classes": 3}) == []
    assert check_dataset_compatibility("feedforward", cfg, r, {"input_shape": [2], "task": "binary", "n_classes": 2})
