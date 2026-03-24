"""add api_timeout and task_check_interval to proxmox_config

Revision ID: c3d4e5f6a1b2
Revises: b2c3d4e5f6a1
Create Date: 2026-03-21 01:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c3d4e5f6a1b2"
down_revision = "b2c3d4e5f6a1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "proxmox_config",
        sa.Column("api_timeout", sa.Integer(), nullable=False, server_default="30"),
    )
    op.add_column(
        "proxmox_config",
        sa.Column("task_check_interval", sa.Integer(), nullable=False, server_default="2"),
    )


def downgrade():
    op.drop_column("proxmox_config", "task_check_interval")
    op.drop_column("proxmox_config", "api_timeout")
