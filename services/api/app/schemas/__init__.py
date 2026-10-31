"""Contratos de la API (validación de entrada con esquemas)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- users
class UserOut(ORM):
    id: uuid.UUID
    email: str
    display_name: str
    role: str
    status: str
    created_at: datetime | None = None


class UserUpdate(BaseModel):
    role: Literal["admin", "project_owner", "engineer", "reviewer", "reader"] | None = None
    status: Literal["active", "disabled"] | None = None
    display_name: str | None = Field(default=None, max_length=80)


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)


# --------------------------------------------------------------------------- projects
class ProjectIn(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    description: str = Field(default="", max_length=2000)
    problem_statement: str = Field(default="", max_length=4000)
    documentation: str = Field(default="", max_length=20000)
    tags: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, v: list[str]) -> list[str]:
        return sorted({t.strip().lower()[:30] for t in v if t.strip()})


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    problem_statement: str | None = Field(default=None, max_length=4000)
    documentation: str | None = Field(default=None, max_length=20000)
    tags: list[str] | None = Field(default=None, max_length=12)
    status: Literal["active", "paused", "archived"] | None = None


class ProjectOut(ORM):
    id: uuid.UUID
    name: str
    description: str
    problem_statement: str
    documentation: str
    tags: list[str]
    owner_id: uuid.UUID
    status: str
    created_at: datetime
    updated_at: datetime
    my_role: str | None = None
    stats: dict[str, Any] = Field(default_factory=dict)


class MemberIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    role: Literal["owner", "engineer", "reviewer", "reader"]


class MemberOut(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str
    role: str
    added_at: datetime


# --------------------------------------------------------------------------- architectures
Family = Literal["feedforward", "rnn", "cnn", "gan"]


class ArchitectureValidateIn(BaseModel):
    family: Family
    config: dict[str, Any]


class ArchitectureIn(ArchitectureValidateIn):
    name: str = Field(min_length=2, max_length=120)
    justification: str = Field(default="", max_length=2000)


class ArchitectureOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    family: str
    config_json: dict[str, Any]
    summary_json: dict[str, Any]
    justification: str
    version: int
    created_at: datetime


# --------------------------------------------------------------------------- datasets
class BuiltinDatasetIn(BaseModel):
    generator: str
    n_samples: int = Field(default=1000, ge=100, le=20000)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)


class DatasetOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    version: int
    metadata_json: dict[str, Any]
    created_at: datetime


# --------------------------------------------------------------------------- training
class TrainingParams(BaseModel):
    epochs: int = Field(default=30, ge=1, le=1000)
    batch_size: int = Field(default=32, ge=1, le=4096)
    optimizer: Literal["adam", "sgd", "rmsprop", "adamw"] = "adam"
    learning_rate: float = Field(default=0.01, gt=0, le=1)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    early_stopping: bool = False
    patience: int = Field(default=10, ge=1, le=100)


class TrainingJobIn(BaseModel):
    architecture_id: uuid.UUID
    dataset_id: uuid.UUID
    params: TrainingParams = Field(default_factory=TrainingParams)
    priority: int = Field(default=0, ge=0, le=10)


class CancelIn(BaseModel):
    reason: str = Field(default="Cancelado por el usuario", max_length=300)


class TrainingJobOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    architecture_id: uuid.UUID
    dataset_id: uuid.UUID
    status: str
    progress: float
    current_epoch: int
    total_epochs: int
    priority: int
    params_json: dict[str, Any]
    result_json: dict[str, Any]
    code_version: str
    cancel_requested: bool
    cancel_reason: str | None
    error_message: str | None
    attempts: int
    created_by: uuid.UUID | None
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    architecture_name: str | None = None
    architecture_family: str | None = None
    dataset_name: str | None = None
    project_name: str | None = None


class MetricOut(ORM):
    id: int
    epoch: int
    metric_name: str
    metric_value: float


class LogOut(ORM):
    id: int
    level: str
    message: str
    created_at: datetime


# --------------------------------------------------------------------------- models
class ModelVersionOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    job_id: uuid.UUID
    version: int
    status: str
    checksum: str
    size_bytes: int
    metrics_json: dict[str, Any]
    notes: str
    created_by: uuid.UUID | None
    reviewed_by: uuid.UUID | None
    created_at: datetime
    architecture_name: str | None = None
    architecture_family: str | None = None
    dataset_name: str | None = None


class ModelStatusIn(BaseModel):
    status: Literal["reviewed", "approved", "retired"]
    notes: str = Field(default="", max_length=2000)


# --------------------------------------------------------------------------- audit / admin
class AuditOut(ORM):
    id: int
    actor_id: uuid.UUID | None
    project_id: uuid.UUID | None
    action: str
    metadata_json: dict[str, Any]
    created_at: datetime
    actor_email: str | None = None


class SettingIn(BaseModel):
    value: dict[str, Any]
