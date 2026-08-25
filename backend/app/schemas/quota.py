"""配額 API schemas。各上限欄位 0 = 無限制（該欄位不執法）。"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.models import QuotaScope


class ResourceQuotaCreate(BaseModel):
    scope: QuotaScope = QuotaScope.user
    user_id: uuid.UUID
    max_cpu_cores: int = Field(default=8, ge=0, le=256)
    max_memory_mb: int = Field(default=16384, ge=0, le=1048576)
    max_disk_gb: int = Field(default=100, ge=0, le=65536)
    max_instances: int = Field(default=5, ge=0, le=100)

    @model_validator(mode="after")
    def _validate_target(self) -> "ResourceQuotaCreate":
        if self.scope != QuotaScope.user:
            raise ValueError("only user quota scope is supported")
        return self


class ResourceQuotaUpdate(BaseModel):
    max_cpu_cores: int | None = Field(default=None, ge=0, le=256)
    max_memory_mb: int | None = Field(default=None, ge=0, le=1048576)
    max_disk_gb: int | None = Field(default=None, ge=0, le=65536)
    max_instances: int | None = Field(default=None, ge=0, le=100)


class ResourceQuotaPublic(BaseModel):
    id: uuid.UUID
    scope: QuotaScope
    user_id: uuid.UUID
    user_email: str | None = None
    max_cpu_cores: int
    max_memory_mb: int
    max_disk_gb: int
    max_instances: int
    created_at: datetime


class GlobalQuotaPublic(BaseModel):
    """全域預設配額（未設定個人覆寫者套用）。"""

    max_cpu_cores: int
    max_memory_mb: int
    max_disk_gb: int
    max_instances: int
    updated_at: datetime


class GlobalQuotaUpdate(BaseModel):
    """全域預設配額更新（partial；範圍約束與 model 一致）。"""

    max_cpu_cores: int | None = Field(default=None, ge=0, le=256)
    max_memory_mb: int | None = Field(default=None, ge=0, le=1048576)
    max_disk_gb: int | None = Field(default=None, ge=0, le=65536)
    max_instances: int | None = Field(default=None, ge=0, le=100)


class EffectiveQuotaPublic(BaseModel):
    max_cpu_cores: int
    max_memory_mb: int
    max_disk_gb: int
    max_instances: int


class QuotaUsagePublic(BaseModel):
    used_cpu_cores: int
    used_memory_mb: int
    used_disk_gb: int
    used_instances: int
    quota: EffectiveQuotaPublic
