"""Add teaching-class scope to Teacher Judge records.

Revision ID: tjcs01
Revises: ep04_retire_exec_profile_schema
"""

import sqlalchemy as sa
from alembic import op

revision = "tjcs01"
down_revision = "ep04_retire_exec_profile_schema"
branch_labels = None
depends_on = None

TABLES = (
    "teacher_judge_files",
    "teacher_judge_script_artifacts",
    "teacher_judge_script_runs",
)


def upgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.alter_column("group_id", existing_type=sa.Uuid(), nullable=True)
            batch_op.add_column(sa.Column("class_id", sa.Uuid(), nullable=True))
            batch_op.create_foreign_key(
                f"fk_{table}_class_id_teaching_classes",
                "teaching_classes",
                ["class_id"],
                ["id"],
                ondelete="CASCADE",
            )
            batch_op.create_index(f"ix_{table}_class_id", ["class_id"])
            batch_op.create_check_constraint(
                f"ck_{table}_exactly_one_scope",
                "(group_id IS NOT NULL AND class_id IS NULL) OR "
                "(group_id IS NULL AND class_id IS NOT NULL)",
            )

    op.create_index(
        "uq_teacher_judge_files_class_active_filename",
        "teacher_judge_files",
        ["class_id", "original_filename"],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND class_id IS NOT NULL"),
        sqlite_where=sa.text("status = 'active' AND class_id IS NOT NULL"),
    )
    op.create_index(
        "ix_teacher_judge_script_artifacts_class_status",
        "teacher_judge_script_artifacts",
        ["class_id", "status"],
    )
    op.create_index(
        "ix_teacher_judge_script_runs_class_status",
        "teacher_judge_script_runs",
        ["class_id", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_teacher_judge_script_runs_class_status",
        table_name="teacher_judge_script_runs",
    )
    op.drop_index(
        "ix_teacher_judge_script_artifacts_class_status",
        table_name="teacher_judge_script_artifacts",
    )
    op.drop_index(
        "uq_teacher_judge_files_class_active_filename",
        table_name="teacher_judge_files",
    )
    for table in reversed(TABLES):
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_constraint(f"ck_{table}_exactly_one_scope", type_="check")
            batch_op.drop_index(f"ix_{table}_class_id")
            batch_op.drop_constraint(
                f"fk_{table}_class_id_teaching_classes",
                type_="foreignkey",
            )
            batch_op.drop_column("class_id")
            batch_op.alter_column("group_id", existing_type=sa.Uuid(), nullable=False)
