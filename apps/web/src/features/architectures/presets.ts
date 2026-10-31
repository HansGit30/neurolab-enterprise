import type { ArchConfig, Family, LayerSpec } from "../../types";

export const PRESETS: Record<Family, ArchConfig> = {
  feedforward: {
    input_shape: [2],
    layers: [
      { type: "Dense", units: 16, activation: "relu" },
      { type: "Dense", units: 8, activation: "relu" },
      { type: "Dense", units: 1, activation: "sigmoid" },
    ],
  },
  rnn: {
    input_shape: [20, 1],
    layers: [
      { type: "LSTM", units: 16, return_sequences: false },
      { type: "Dense", units: 8, activation: "relu" },
      { type: "Dense", units: 3, activation: "softmax" },
    ],
  },
  cnn: {
    input_shape: [8, 8, 1],
    layers: [
      { type: "Conv2D", filters: 8, kernel_size: 3, activation: "relu", padding: "same" },
      { type: "MaxPooling2D", pool_size: 2 },
      { type: "Flatten" },
      { type: "Dense", units: 16, activation: "relu" },
      { type: "Dense", units: 3, activation: "softmax" },
    ],
  },
  gan: {
    input_shape: [2],
    latent_dim: 8,
    generator: { layers: [
      { type: "Dense", units: 32, activation: "relu" },
      { type: "Dense", units: 32, activation: "relu" },
      { type: "Dense", units: 2, activation: "linear" },
    ] },
    discriminator: { layers: [
      { type: "Dense", units: 32, activation: "leaky_relu" },
      { type: "Dense", units: 1, activation: "sigmoid" },
    ] },
  },
};

export const NEW_LAYER: Record<string, LayerSpec> = {
  Dense: { type: "Dense", units: 16, activation: "relu" },
  Dropout: { type: "Dropout", rate: 0.2 },
  BatchNormalization: { type: "BatchNormalization" },
  Conv2D: { type: "Conv2D", filters: 16, kernel_size: 3, activation: "relu", padding: "same" },
  MaxPooling2D: { type: "MaxPooling2D", pool_size: 2 },
  AveragePooling2D: { type: "AveragePooling2D", pool_size: 2 },
  Flatten: { type: "Flatten" },
  GlobalAveragePooling2D: { type: "GlobalAveragePooling2D" },
  SimpleRNN: { type: "SimpleRNN", units: 16, return_sequences: false },
  LSTM: { type: "LSTM", units: 16, return_sequences: false },
  GRU: { type: "GRU", units: 16, return_sequences: false },
};

export const LAYER_HELP: Record<string, string> = {
  Dense: "Capa totalmente conectada: cada neurona recibe todas las salidas de la capa anterior.",
  Dropout: "Apaga al azar una fracción de neuronas durante el entrenamiento para reducir el sobreajuste.",
  BatchNormalization: "Normaliza las activaciones de cada lote; estabiliza y acelera el entrenamiento.",
  Conv2D: "Filtros que recorren la imagen detectando bordes, texturas y formas.",
  MaxPooling2D: "Reduce el tamaño quedándose con el valor máximo de cada ventana.",
  AveragePooling2D: "Reduce el tamaño promediando cada ventana.",
  Flatten: "Aplana un mapa 2D a un vector para conectarlo con capas Dense.",
  GlobalAveragePooling2D: "Promedia cada mapa de características: un número por filtro.",
  SimpleRNN: "Recurrencia básica: la salida de cada paso alimenta al siguiente.",
  LSTM: "Recurrente con compuertas (olvido, entrada, salida); recuerda dependencias largas.",
  GRU: "Variante más liviana de LSTM con dos compuertas.",
};

export function layerMeta(l: LayerSpec): string {
  const p: string[] = [];
  if (l.units !== undefined) p.push(`${l.units} u`);
  if (l.filters !== undefined) p.push(`${l.filters} filtros ${l.kernel_size ?? 3}×${l.kernel_size ?? 3}`);
  if (l.pool_size !== undefined) p.push(`${l.pool_size}×${l.pool_size}`);
  if (l.rate !== undefined) p.push(`p=${l.rate}`);
  if (l.activation) p.push(l.activation);
  if (l.return_sequences) p.push("secuencias");
  return p.join(" · ");
}
