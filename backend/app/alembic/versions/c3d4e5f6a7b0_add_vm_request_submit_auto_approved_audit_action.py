"""add vm_request_submit_auto_approved audit action

Revision ID: c3d4e5f6a7b0
Revises: b2c3d4e5f6a9
Create Date: 2026-04-07 11:00:00.000000

"""

from alembic import op

revision = "c3d4e5f6a7b0"
down_revision = "b2c3d4e5f6a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'vm_request_submit_auto_approved'"
    )


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; downgrade is a no-op
    pass
