"""add gateway_ip to proxmox_config

Revision ID: g7h8i9j0k1l2
Revises: f6a1b2c3d4e5
Create Date: 2026-03-22 12:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "g7h8i9j0k1l2"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "proxmox_config",
        sa.Column("gateway_ip", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("proxmox_config", "gateway_ip")
