"""Retire VM movement and keep provisioning/capacity state.

Revision ID: ret01_remove_vm_movement
Revises: crs01_course_lab
Create Date: 2026-07-17 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "ret01_remove_vm_movement"
down_revision = "crs01_course_lab"
branch_labels = None
depends_on = None


_CAPACITY_COLUMN_RENAMES = {
    "rebalance_migration_cost": "placement_reassignment_cost",
    "rebalance_peak_cpu_margin": "placement_peak_cpu_margin",
    "rebalance_peak_memory_margin": "placement_peak_memory_margin",
    "rebalance_loadavg_warn_per_core": "placement_loadavg_warn_per_core",
    "rebalance_loadavg_max_per_core": "placement_loadavg_max_per_core",
    "rebalance_loadavg_penalty_weight": "placement_loadavg_penalty_weight",
    "rebalance_disk_contention_warn_share": "placement_disk_contention_warn_share",
    "rebalance_disk_contention_high_share": "placement_disk_contention_high_share",
    "rebalance_disk_penalty_weight": "placement_disk_penalty_weight",
    "rebalance_search_max_relocations": "placement_search_max_reassignments",
    "rebalance_search_depth": "placement_search_depth",
    "rebalance_cpu_peak_warn_share": "placement_cpu_peak_warn_share",
    "rebalance_cpu_peak_high_share": "placement_cpu_peak_high_share",
    "rebalance_memory_peak_warn_share": "placement_memory_peak_warn_share",
    "rebalance_memory_peak_high_share": "placement_memory_peak_high_share",
    "rebalance_resource_weight_cpu": "placement_resource_weight_cpu",
    "rebalance_resource_weight_memory": "placement_resource_weight_memory",
    "rebalance_resource_weight_disk": "placement_resource_weight_disk",
}

_REMOVED_CONFIG_COLUMNS = (
    "migration_enabled",
    "migration_max_per_rebalance",
    "migration_min_interval_minutes",
    "migration_retry_limit",
    "migration_worker_concurrency",
    "migration_job_claim_timeout_seconds",
    "migration_retry_backoff_seconds",
    "migration_lxc_live_enabled",
)


def upgrade() -> None:
    op.drop_table("vm_migration_jobs")
    op.execute("DROP TYPE IF EXISTS vmmigrationjobstatus")

    op.alter_column(
        "vm_requests", "migration_status", new_column_name="provisioning_status"
    )
    op.alter_column(
        "vm_requests", "migration_error", new_column_name="provisioning_error"
    )
    op.execute("ALTER TYPE vmmigrationstatus RENAME TO vmprovisioningstatus")
    op.drop_column("vm_requests", "migration_pinned")
    op.drop_column("vm_requests", "rebalance_epoch")
    op.drop_column("vm_requests", "last_rebalanced_at")
    op.drop_column("vm_requests", "last_migrated_at")

    for old_name, new_name in _CAPACITY_COLUMN_RENAMES.items():
        op.alter_column("proxmox_config", old_name, new_column_name=new_name)
    for column_name in _REMOVED_CONFIG_COLUMNS:
        op.drop_column("proxmox_config", column_name)


def downgrade() -> None:
    op.add_column(
        "proxmox_config",
        sa.Column("migration_enabled", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "proxmox_config",
        sa.Column("migration_max_per_rebalance", sa.Integer(), nullable=False, server_default="2"),
    )
    op.add_column(
        "proxmox_config",
        sa.Column("migration_min_interval_minutes", sa.Integer(), nullable=False, server_default="60"),
    )
    op.add_column(
        "proxmox_config",
        sa.Column("migration_retry_limit", sa.Integer(), nullable=False, server_default="3"),
    )
    op.add_column(
        "proxmox_config",
        sa.Column("migration_worker_concurrency", sa.Integer(), nullable=False, server_default="2"),
    )
    op.add_column(
        "proxmox_config",
        sa.Column("migration_job_claim_timeout_seconds", sa.Integer(), nullable=False, server_default="300"),
    )
    op.add_column(
        "proxmox_config",
        sa.Column("migration_retry_backoff_seconds", sa.Integer(), nullable=False, server_default="120"),
    )
    op.add_column(
        "proxmox_config",
        sa.Column("migration_lxc_live_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )
    for old_name, new_name in reversed(tuple(_CAPACITY_COLUMN_RENAMES.items())):
        op.alter_column("proxmox_config", new_name, new_column_name=old_name)

    op.add_column(
        "vm_requests",
        sa.Column("migration_pinned", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "vm_requests",
        sa.Column("rebalance_epoch", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("vm_requests", sa.Column("last_rebalanced_at", sa.DateTime(timezone=True)))
    op.add_column("vm_requests", sa.Column("last_migrated_at", sa.DateTime(timezone=True)))
    op.execute("ALTER TYPE vmprovisioningstatus RENAME TO vmmigrationstatus")
    op.alter_column(
        "vm_requests", "provisioning_status", new_column_name="migration_status"
    )
    op.alter_column(
        "vm_requests", "provisioning_error", new_column_name="migration_error"
    )

    job_status = postgresql.ENUM(
        "pending",
        "running",
        "completed",
        "failed",
        "blocked",
        "cancelled",
        name="vmmigrationjobstatus",
    )
    job_status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "vm_migration_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vm_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("vmid", sa.Integer()),
        sa.Column(
            "resource_vmid",
            sa.Integer(),
            sa.ForeignKey("resources.vmid", ondelete="SET NULL"),
        ),
        sa.Column("source_node", sa.String(length=255)),
        sa.Column("target_node", sa.String(length=255), nullable=False),
        sa.Column("status", job_status, nullable=False),
        sa.Column("rebalance_epoch", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=500)),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True)),
        sa.Column("claimed_by", sa.String(length=128)),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("claim_expires_at", sa.DateTime(timezone=True)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
