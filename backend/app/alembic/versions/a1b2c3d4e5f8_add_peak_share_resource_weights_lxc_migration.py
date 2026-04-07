"""add peak share thresholds, resource weights, and lxc migration setting

Revision ID: a1b2c3d4e5f8
Revises: z7a8b9c0d1e2
Create Date: 2026-04-06 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "a1b2c3d4e5f8"
down_revision = "z7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "proxmox_config",
        sa.Column(
            "migration_lxc_live_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "proxmox_config",
        sa.Column(
            "rebalance_cpu_peak_warn_share",
            sa.Float(),
            nullable=False,
            server_default="0.7",
        ),
    )
    op.add_column(
        "proxmox_config",
        sa.Column(
            "rebalance_cpu_peak_high_share",
            sa.Float(),
            nullable=False,
            server_default="1.2",
        ),
    )
    op.add_column(
        "proxmox_config",
        sa.Column(
            "rebalance_memory_peak_warn_share",
            sa.Float(),
            nullable=False,
            server_default="0.8",
        ),
    )
    op.add_column(
        "proxmox_config",
        sa.Column(
            "rebalance_memory_peak_high_share",
            sa.Float(),
            nullable=False,
            server_default="0.85",
        ),
    )
    op.add_column(
        "proxmox_config",
        sa.Column(
            "rebalance_resource_weight_cpu",
            sa.Float(),
            nullable=False,
            server_default="1.0",
        ),
    )
    op.add_column(
        "proxmox_config",
        sa.Column(
            "rebalance_resource_weight_memory",
            sa.Float(),
            nullable=False,
            server_default="1.0",
        ),
    )
    op.add_column(
        "proxmox_config",
        sa.Column(
            "rebalance_resource_weight_disk",
            sa.Float(),
            nullable=False,
            server_default="1.0",
        ),
    )


def downgrade() -> None:
    op.drop_column("proxmox_config", "rebalance_resource_weight_disk")
    op.drop_column("proxmox_config", "rebalance_resource_weight_memory")
    op.drop_column("proxmox_config", "rebalance_resource_weight_cpu")
    op.drop_column("proxmox_config", "rebalance_memory_peak_high_share")
    op.drop_column("proxmox_config", "rebalance_memory_peak_warn_share")
    op.drop_column("proxmox_config", "rebalance_cpu_peak_high_share")
    op.drop_column("proxmox_config", "rebalance_cpu_peak_warn_share")
    op.drop_column("proxmox_config", "migration_lxc_live_enabled")
