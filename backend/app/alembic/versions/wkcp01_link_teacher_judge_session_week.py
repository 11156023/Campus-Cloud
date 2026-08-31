"""Link Teacher Judge checks to one teaching-class week.

Revision ID: wkcp01
Revises: tjpy01_python_entrypoint
Create Date: 2026-08-30
"""

import sqlalchemy as sa
from alembic import op

revision = "wkcp01"
down_revision = "tjpy01_python_entrypoint"
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
        unique=False,
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
