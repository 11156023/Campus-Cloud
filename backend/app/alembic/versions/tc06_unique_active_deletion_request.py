"""Guarantee one active deletion request per VMID.

Revision ID: tc06_unique_active_delete
Revises: tc05_class_owner_restrict
Create Date: 2026-08-25
"""

import sqlalchemy as sa
from alembic import op

revision = "tc06_unique_active_delete"
down_revision = "tc05_class_owner_restrict"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_deletion_requests_active_vmid",
        "deletion_requests",
        ["vmid"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'running')"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_deletion_requests_active_vmid",
        table_name="deletion_requests",
    )
