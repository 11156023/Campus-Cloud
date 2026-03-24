"""add ca_cert to proxmox_config

Revision ID: e5f6a1b2c3d4
Revises: d4e5f6a1b2c3
Create Date: 2026-03-22 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e5f6a1b2c3d4"
down_revision = "d4e5f6a1b2c3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "proxmox_config",
        sa.Column("ca_cert", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("proxmox_config", "ca_cert")
