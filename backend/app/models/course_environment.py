"""Reusable, versioned per-student course environments."""

import enum
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlmodel import (
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    Field,
    SQLModel,
    UniqueConstraint,
)

from .base import get_datetime_utc


class CourseEnvironmentVersionStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    retired = "retired"


class CourseEnvironment(SQLModel, table=True):
    """Stable identity for a reusable course environment."""

    __tablename__ = "course_environments"
    __table_args__ = (
        UniqueConstraint("owner_id", "code", name="uq_course_environment_owner_code"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_id: uuid.UUID = Field(
        sa_column=Column(
            sa.Uuid,
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    code: str = Field(max_length=80)
    name: str = Field(max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    created_at: datetime = Field(
        default_factory=get_datetime_utc,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=get_datetime_utc,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class CourseEnvironmentVersion(SQLModel, table=True):
    """Immutable after publication; a class pins exactly one published version."""

    __tablename__ = "course_environment_versions"
    __table_args__ = (
        UniqueConstraint(
            "environment_id",
            "version",
            name="uq_course_environment_version",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    environment_id: uuid.UUID = Field(
        sa_column=Column(
            sa.Uuid,
            sa.ForeignKey("course_environments.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    version: int = Field(ge=1)
    status: CourseEnvironmentVersionStatus = Field(
        default=CourseEnvironmentVersionStatus.draft,
        sa_column=Column(
            Enum(CourseEnvironmentVersionStatus),
            nullable=False,
            default=CourseEnvironmentVersionStatus.draft,
            index=True,
        ),
    )
    configuration_hash: str | None = Field(default=None, max_length=64)
    created_at: datetime = Field(
        default_factory=get_datetime_utc,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    published_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class CourseEnvironmentNode(SQLModel, table=True):
    """One machine in the environment issued to every enrolled student."""

    __tablename__ = "course_environment_nodes"
    __table_args__ = (
        UniqueConstraint(
            "version_id",
            "node_key",
            name="uq_course_environment_version_node",
        ),
        CheckConstraint(
            "("
            "source_type = 'template' AND source_template_id IS NOT NULL "
            "AND custom_image_ref IS NULL"
            ") OR ("
            "source_type = 'custom' AND source_template_id IS NULL "
            "AND custom_image_ref IS NOT NULL"
            ")",
            name="ck_course_environment_node_source",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    version_id: uuid.UUID = Field(
        sa_column=Column(
            sa.Uuid,
            sa.ForeignKey("course_environment_versions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    node_key: str = Field(max_length=80)
    source_type: str = Field(default="template", max_length=16)
    source_template_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            sa.Uuid,
            sa.ForeignKey("vm_templates.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    custom_image_ref: str | None = Field(default=None, max_length=500)
    custom_storage: str | None = Field(default=None, max_length=120)
    custom_username: str | None = Field(default=None, max_length=32)
    custom_unprivileged: bool = Field(default=True)
    name: str = Field(max_length=255)
    role: str = Field(max_length=120)
    resource_type: str = Field(max_length=10)
    cpu: int = Field(ge=1, le=64)
    memory_mb: int = Field(ge=128, le=131072)
    disk_gb: int = Field(ge=1, le=2000)
    # Comma-separated logical segments. Students get independent instances of
    # segments with the same name; it is not a raw PVE bridge name.
    network: str = Field(default="lab-net", max_length=255)
    sort_order: int = Field(default=0)


class CourseEnvironmentEdge(SQLModel, table=True):
    """A firewall-style connection between two nodes in one course version."""

    __tablename__ = "course_environment_edges"
    __table_args__ = (
        UniqueConstraint(
            "version_id",
            "source_node_key",
            "target_node_key",
            "direction",
            "protocol",
            "port",
            name="uq_course_environment_edge",
        ),
        CheckConstraint(
            "source_node_key <> target_node_key",
            name="ck_course_environment_edge_distinct_nodes",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    version_id: uuid.UUID = Field(
        sa_column=Column(
            sa.Uuid,
            sa.ForeignKey("course_environment_versions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    source_node_key: str = Field(max_length=80)
    target_node_key: str = Field(max_length=80)
    direction: str = Field(default="bidirectional", max_length=16)
    protocol: str = Field(default="any", max_length=8)
    port: int | None = Field(default=None, ge=1, le=65535)


class ClassCapacityReservation(SQLModel, table=True):
    """Atomic whole-class capacity snapshot created before batch jobs."""

    __tablename__ = "class_capacity_reservations"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    class_id: uuid.UUID = Field(
        sa_column=Column(
            sa.Uuid,
            sa.ForeignKey("teaching_classes.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        )
    )
    course_version_id: uuid.UUID = Field(
        sa_column=Column(
            sa.Uuid,
            sa.ForeignKey("course_environment_versions.id", ondelete="RESTRICT"),
            nullable=False,
        )
    )
    student_count: int = Field(ge=1)
    machine_count: int = Field(ge=1)
    cpu_cores: int = Field(ge=1)
    memory_mb: int = Field(ge=1)
    disk_gb: int = Field(ge=1)
    ip_count: int = Field(ge=1)
    network_count: int = Field(ge=1)
    placement_plan: str = Field(
        default="{}",
        sa_column=Column(sa.Text, nullable=False),
    )
    status: str = Field(default="reserved", max_length=24)
    created_at: datetime = Field(
        default_factory=get_datetime_utc,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


__all__ = [
    "ClassCapacityReservation",
    "CourseEnvironment",
    "CourseEnvironmentEdge",
    "CourseEnvironmentNode",
    "CourseEnvironmentVersion",
    "CourseEnvironmentVersionStatus",
]
