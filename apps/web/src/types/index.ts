export type GlobalRole = "admin" | "project_owner" | "engineer" | "reviewer" | "reader";
export type ProjectRole = "owner" | "engineer" | "reviewer" | "reader";
export type Family = "feedforward" | "rnn" | "cnn" | "gan";
export type JobStatus = "QUEUED" | "PREPARING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type ModelStatus = "draft" | "reviewed" | "approved" | "retired";

export interface Me {
  id: string;
  email: string;
  display_name: string;
  role: GlobalRole;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  problem_statement: string;
  documentation: string;
  tags: string[];
  owner_id: string;
  status: "active" | "paused" | "archived";
  created_at: string;
  updated_at: string;
  my_role: ProjectRole | null;
  stats: { architectures: number; datasets: number; jobs: number; active_jobs: number; models: number; members: number };
}

export interface Member {
  user_id: string;
  email: string;
  display_name: string;
  role: ProjectRole;
  added_at: string;
}

export interface LayerSpec {
  type: string;
  units?: number;
  activation?: string;
  rate?: number;
  filters?: number;
  kernel_size?: number;
  strides?: number;
  padding?: "valid" | "same";
  pool_size?: number;
  return_sequences?: boolean;
}

export interface ArchConfig {
  input_shape: number[];
  layers?: LayerSpec[];
  latent_dim?: number;
  generator?: { layers: LayerSpec[] };
  discriminator?: { layers: LayerSpec[] };
}

export interface ValidationSummary {
  valid: boolean;
  errors: string[];
  warnings: string[];
  layers: { name: string; type: string; output_shape: number[]; params: number }[];
  total_params: number;
  trainable_params: number;
  output_shape: number[] | null;
}

export interface Architecture {
  id: string;
  project_id: string;
  name: string;
  family: Family;
  config_json: ArchConfig;
  summary_json: ValidationSummary;
  justification: string;
  version: number;
  created_at: string;
}

export interface FamilyInfo {
  key: Family;
  label: string;
  summary: string;
  use_cases: string[];
  restrictions: string[];
  status: "ga" | "beta" | "preview";
  layers: string[];
  activations: string[];
  training_enabled: boolean;
}

export interface DatasetMeta {
  kind: "builtin" | "upload";
  generator?: string;
  label?: string;
  description?: string;
  task: "binary" | "multiclass" | "regression" | "generative";
  input_shape: number[];
  n_classes: number | null;
  n_samples: number;
  class_names: string[];
  feature_names: string[];
  recommended_family?: Family;
  seed?: number;
  target?: string;
  original_filename?: string;
  size_bytes?: number;
  splits: { train: number; validation: number; test: number };
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  version: number;
  metadata_json: DatasetMeta;
  created_at: string;
}

export interface BuiltinDataset {
  key: string;
  label: string;
  family: Family;
  task: string;
  description: string;
}

export interface TrainingParams {
  epochs: number;
  batch_size: number;
  optimizer: "adam" | "sgd" | "rmsprop" | "adamw";
  learning_rate: number;
  seed: number;
  early_stopping: boolean;
  patience: number;
}

export interface TrainingJob {
  id: string;
  project_id: string;
  architecture_id: string;
  dataset_id: string;
  status: JobStatus;
  progress: number;
  current_epoch: number;
  total_epochs: number;
  priority: number;
  params_json: TrainingParams;
  result_json: Record<string, any>;
  code_version: string;
  cancel_requested: boolean;
  cancel_reason: string | null;
  error_message: string | null;
  attempts: number;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  architecture_name: string | null;
  architecture_family: Family | null;
  dataset_name: string | null;
  project_name: string | null;
}

export interface Metric {
  id: number;
  epoch: number;
  metric_name: string;
  metric_value: number;
}

export interface JobLog {
  id: number;
  level: string;
  message: string;
  created_at: string;
}

export interface ModelVersion {
  id: string;
  project_id: string;
  job_id: string;
  version: number;
  status: ModelStatus;
  checksum: string;
  size_bytes: number;
  metrics_json: Record<string, number>;
  notes: string;
  created_by: string | null;
  reviewed_by: string | null;
  created_at: string;
  architecture_name: string | null;
  architecture_family: Family | null;
  dataset_name: string | null;
}

export interface AuditEvent {
  id: number;
  actor_id: string | null;
  project_id: string | null;
  action: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
  actor_email: string | null;
}

export interface Dashboard {
  projects: number;
  active_jobs: number;
  jobs_by_status: Partial<Record<JobStatus, number>>;
  models: number;
  approved_models: number;
  architectures: number;
  datasets: number;
  recent_jobs: TrainingJob[];
  daily_jobs: { date: string; count: number }[];
  alerts: { level: "error" | "info"; message: string; job_id?: string }[];
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  role: GlobalRole;
  status: "active" | "disabled";
  created_at: string;
}
