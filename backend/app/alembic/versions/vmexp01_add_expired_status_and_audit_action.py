"""add expired to vmrequeststatus and vm_request_expired to auditaction

Revision ID: vmexp01_expired
Revises: qc01_quota_config
Create Date: 2026-08-03 00:00:00.000000

"""

from alembic import op

revision = "vmexp01_expired"
down_revision = "qc01_quota_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "ALTER TYPE vmrequeststatus ADD VALUE IF NOT EXISTS 'expired' AFTER 'cancelled'"
    )
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'vm_request_expired'")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # PostgreSQL 無法移除 enum 值；把資料映回 rejected 即可。
    op.execute("UPDATE vm_requests SET status = 'rejected' WHERE status = 'expired'")
