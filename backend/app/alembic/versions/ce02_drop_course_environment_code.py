"""Drop the unused course-environment code column.

Revision ID: ce02_drop_env_code
Revises: qp02_lifecycle
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ce02_drop_env_code"
down_revision = "qp02_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_course_environment_owner_code",
        "course_environments",
        type_="unique",
    )
    op.drop_column("course_environments", "code")


def downgrade() -> None:
    op.add_column(
        "course_environments",
        sa.Column("code", sa.String(length=80), nullable=True),
    )
    op.execute(
        "UPDATE course_environments "
        "SET code = 'ENV-' || upper(substr(replace(id::text, '-', ''), 1, 12)) "
        "WHERE code IS NULL"
    )
    op.alter_column("course_environments", "code", nullable=False)
    op.create_unique_constraint(
        "uq_course_environment_owner_code",
        "course_environments",
        ["owner_id", "code"],
    )
