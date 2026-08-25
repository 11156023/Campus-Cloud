"""VM request 新增 gpu_mdev_profile（使用者自選 vGPU 規格）

Revision ID: gpumdev01
Revises: clonepw01_login_password
Create Date: 2026-08-25
"""
import sqlalchemy as sa
from alembic import op

revision = "gpumdev01"
down_revision = "clonepw01_login_password"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "vm_requests",
        sa.Column("gpu_mdev_profile", sa.String(), nullable=True),
    )


def downgrade():
    op.drop_column("vm_requests", "gpu_mdev_profile")
