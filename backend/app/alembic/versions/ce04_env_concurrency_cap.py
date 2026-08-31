"""Cap how many quick-practice sessions one environment may run at once.

Revision ID: ce04_env_concurrency
Revises: tplcat01_student_catalog
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ce04_env_concurrency"
down_revision = "tplcat01_student_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "course_environments",
        sa.Column("max_concurrent_sessions", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("course_environments", "max_concurrent_sessions")
