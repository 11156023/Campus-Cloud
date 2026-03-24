"""add proxmox_nodes table

Revision ID: f6a1b2c3d4e5
Revises: e5f6a1b2c3d4
Create Date: 2026-03-22 01:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f6a1b2c3d4e5"
down_revision = "e5f6a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "proxmox_nodes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="8006"),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_online", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_checked", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("proxmox_nodes")
