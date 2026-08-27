"""Link Course Lab paths to formal teaching classes.

Revision ID: cpath01_link_class
Revises: tjux01_teacher_judge_workspace
Create Date: 2026-08-26
"""

import sqlalchemy as sa
from alembic import op

revision = "cpath01_link_class"
down_revision = "tjux01_teacher_judge_workspace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "teaching_classes",
        sa.Column("location", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "course_paths",
        sa.Column("teaching_class_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_course_paths_teaching_class_id",
        "course_paths",
        "teaching_classes",
        ["teaching_class_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_course_paths_teaching_class_id",
        "course_paths",
        ["teaching_class_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_course_paths_teaching_class_id", table_name="course_paths")
    op.drop_constraint(
        "fk_course_paths_teaching_class_id",
        "course_paths",
        type_="foreignkey",
    )
    op.drop_column("course_paths", "teaching_class_id")
    op.drop_column("teaching_classes", "location")
