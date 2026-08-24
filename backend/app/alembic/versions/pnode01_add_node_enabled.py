"""Add proxmox_nodes.enabled — 節點可停用（不參與放置）。

Revision ID: pnode01_node_enabled
Revises: pmc01_proxmox_connections
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "pnode01_node_enabled"
down_revision = "pmc01_proxmox_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {
        column["name"] for column in sa.inspect(bind).get_columns("proxmox_nodes")
    }
    if "enabled" not in columns:
        op.add_column(
            "proxmox_nodes",
            sa.Column(
                "enabled", sa.Boolean(), nullable=False, server_default=sa.true()
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {
        column["name"] for column in sa.inspect(bind).get_columns("proxmox_nodes")
    }
    if "enabled" in columns:
        op.drop_column("proxmox_nodes", "enabled")
