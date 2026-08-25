"""Add quota_config — 全域預設資源配額（單列 singleton）。

不 seed 資料：那一列由 quota_service._global_quota_row 首次讀取時建立，
與 governance_config 的 lazy-create 慣例一致。

Revision ID: qc01_quota_config
Revises: mrg01_merge_heads
Create Date: 2026-08-03 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "qc01_quota_config"
down_revision = "mrg01_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "quota_config" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "quota_config",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "max_cpu_cores", sa.Integer(), nullable=False, server_default="8"
        ),
        sa.Column(
            "max_memory_mb", sa.Integer(), nullable=False, server_default="16384"
        ),
        sa.Column("max_disk_gb", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("max_instances", sa.Integer(), nullable=False, server_default="5"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "quota_config" in sa.inspect(bind).get_table_names():
        op.drop_table("quota_config")
