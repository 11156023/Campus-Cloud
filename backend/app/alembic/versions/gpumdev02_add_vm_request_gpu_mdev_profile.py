"""VM request 新增 gpu_mdev_profile（使用者自選 vGPU 規格）。

Revision ID: gpumdev02
Revises: clonepw01_login_password
Create Date: 2026-08-27

原 fork 版 revision id 為 gpumdev01，與上游的同名 no-op 橋接版衝突，
故改以 gpumdev02 重新編號；upgrade 冪等以相容已套用過原版的 fork DB。
"""
import sqlalchemy as sa
from alembic import op

revision = "gpumdev02"
down_revision = "clonepw01_login_password"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade():
    if _has_column("vm_requests", "gpu_mdev_profile"):
        return
    op.add_column(
        "vm_requests",
        sa.Column("gpu_mdev_profile", sa.String(), nullable=True),
    )


def downgrade():
    op.drop_column("vm_requests", "gpu_mdev_profile")
