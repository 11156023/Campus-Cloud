"""Teaching-class student machine monitoring schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TeachingClassMachineSummary(BaseModel):
    students: int = 0
    machines: int = 0
    running: int = 0
    stopped: int = 0
    provisioning: int = 0
    failed: int = 0
    unknown: int = 0


class TeachingClassStudentMachinePublic(BaseModel):
    mapping_id: uuid.UUID
    machine_node_id: uuid.UUID
    node_key: str
    name: str
    role: str
    vmid: int | None
    resource_type: str
    provision_status: str
    provision_error: str | None = None
    runtime_status: str = "unknown"
    proxmox_node: str | None = None
    cpu_usage_pct: float | None = None
    ram_usage_pct: float | None = None
    disk_usage_pct: float | None = None
    ip_address: str | None = None
    has_ssh_key: bool = False


class TeachingClassStudentMachinesPublic(BaseModel):
    student_id: uuid.UUID
    user_id: uuid.UUID
    name: str
    email: str
    machines: list[TeachingClassStudentMachinePublic] = Field(default_factory=list)


class TeachingClassMachineStatusResponse(BaseModel):
    class_id: uuid.UUID
    refreshed_at: datetime
    summary: TeachingClassMachineSummary
    students: list[TeachingClassStudentMachinesPublic] = Field(default_factory=list)
