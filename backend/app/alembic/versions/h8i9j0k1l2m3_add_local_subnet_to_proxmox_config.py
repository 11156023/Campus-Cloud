"""add local_subnet to proxmox_config

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-03-22 13:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "h8i9j0k1l2m3"
down_revision = "g7h8i9j0k1l2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "proxmox_config",
        sa.Column("local_subnet", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("proxmox_config", "local_subnet")
