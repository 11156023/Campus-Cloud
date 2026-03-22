"""add proxmox_config table

Revision ID: b2c3d4e5f6a1
Revises: a1b2c3d4e5f6
Create Date: 2026-03-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes

# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a1"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "proxmox_config",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("host", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("user", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("encrypted_password", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=False),
        sa.Column("verify_ssl", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("iso_storage", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False, server_default="local"),
        sa.Column("data_storage", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False, server_default="local-lvm"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("proxmox_config")
