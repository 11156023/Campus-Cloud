"""Link Teacher Judge sessions to an optional teaching-class week.

Revision ID: wkcp01
Revises: tjmerge03_all_heads
Create Date: 2026-08-31

This revision restores the migration already recorded by existing Campus Cloud
databases.  Keeping it in the repository preserves the real schema history and
lets later revisions upgrade normally without stamping over deployed state.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "wkcp01"
down_revision = "tjmerge03_all_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "teacher_judge_sessions",
        sa.Column("teaching_class_week_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_teacher_judge_sessions_week_id",
        "teacher_judge_sessions",
        "teaching_class_weeks",
        ["teaching_class_week_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_teacher_judge_sessions_teaching_class_week_id",
        "teacher_judge_sessions",
        ["teaching_class_week_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_teacher_judge_sessions_teaching_class_week_id",
        table_name="teacher_judge_sessions",
    )
    op.drop_constraint(
        "fk_teacher_judge_sessions_week_id",
        "teacher_judge_sessions",
        type_="foreignkey",
    )
    op.drop_column("teacher_judge_sessions", "teaching_class_week_id")
