"""Reconcile schema after the retired resource-execution branch.

Revision ID: db01_schema_reconcile
Revises: ep03_resource_execution
Create Date: 2026-07-29 20:46:00.000000

"""

from app.alembic.versions.tjtc01_add_teacher_judge_template_commands import (
    upgrade as ensure_teacher_judge_template_commands,
)

revision = "db01_schema_reconcile"
down_revision = "ep03_resource_execution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The original migration is idempotent: it creates missing objects,
    # creates missing indexes, and inserts defaults with ON CONFLICT DO NOTHING.
    ensure_teacher_judge_template_commands()


def downgrade() -> None:
    # The table may predate this repair on healthy databases.  Never remove it.
    pass
