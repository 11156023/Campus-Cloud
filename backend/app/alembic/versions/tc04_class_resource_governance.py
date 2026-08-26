"""Add formal teaching-class resource governance and schedule state.

Revision ID: tc04_class_resource_governance
Revises: gpumdev01
Create Date: 2026-08-25
"""

import sqlalchemy as sa
from alembic import op

revision = "tc04_class_resource_governance"
down_revision = "gpumdev01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resources",
        sa.Column("teaching_class_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "resources",
        sa.Column(
            "allocation_scope",
            sa.String(length=24),
            nullable=False,
            server_default="personal",
        ),
    )
    op.add_column(
        "resources",
        sa.Column(
            "control_policy",
            sa.String(length=32),
            nullable=False,
            server_default="owner",
        ),
    )
    op.create_foreign_key(
        "fk_resources_teaching_class_id",
        "resources",
        "teaching_classes",
        ["teaching_class_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_resources_teaching_class_id",
        "resources",
        ["teaching_class_id"],
    )

    op.add_column(
        "batch_provision_jobs",
        sa.Column("next_window_start", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "batch_provision_jobs",
        sa.Column("next_window_end", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_batch_provision_jobs_next_window_start",
        "batch_provision_jobs",
        ["next_window_start"],
    )

    op.add_column(
        "teaching_classes",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "teaching_classes",
        sa.Column("reclaim_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "teaching_classes",
        sa.Column("resources_reclaimed_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Backfill resources created by the existing formal-class batch pipeline.
    op.execute(
        sa.text(
            """
            UPDATE resources AS r
            SET teaching_class_id = j.teaching_class_id,
                allocation_scope = 'teaching_class',
                control_policy = 'class_member'
            FROM batch_provision_jobs AS j
            WHERE r.batch_job_id = j.id
              AND j.teaching_class_id IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_column("teaching_classes", "resources_reclaimed_at")
    op.drop_column("teaching_classes", "reclaim_requested_at")
    op.drop_column("teaching_classes", "archived_at")

    op.drop_index(
        "ix_batch_provision_jobs_next_window_start",
        table_name="batch_provision_jobs",
    )
    op.drop_column("batch_provision_jobs", "next_window_end")
    op.drop_column("batch_provision_jobs", "next_window_start")

    op.drop_index("ix_resources_teaching_class_id", table_name="resources")
    op.drop_constraint(
        "fk_resources_teaching_class_id", "resources", type_="foreignkey"
    )
    op.drop_column("resources", "control_policy")
    op.drop_column("resources", "allocation_scope")
    op.drop_column("resources", "teaching_class_id")
