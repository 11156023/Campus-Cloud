"""Add independent teaching-class orchestration tables.

Revision ID: tc01_teaching_class
Revises: ret01_remove_vm_movement
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "tc01_teaching_class"
down_revision = "ret01_remove_vm_movement"
branch_labels = None
depends_on = None


def upgrade():
    status_values = (
        "planning",
        "pending_review",
        "provisioning",
        "partial_failed",
        "active",
        "archived",
    )
    postgresql.ENUM(*status_values, name="teachingclassstatus").create(
        op.get_bind(), checkfirst=True
    )
    status = postgresql.ENUM(
        *status_values, name="teachingclassstatus", create_type=False
    )
    op.create_table(
        "teaching_classes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id",
            sa.Uuid(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(80), nullable=False),
        sa.Column("term", sa.String(80), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("boot_lead_minutes", sa.Integer(), nullable=False),
        sa.Column("shutdown_grace_minutes", sa.Integer(), nullable=False),
        sa.Column("status", status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_teaching_classes_owner_id", "teaching_classes", ["owner_id"])
    op.create_index("ix_teaching_classes_status", "teaching_classes", ["status"])

    op.alter_column("batch_provision_jobs", "group_id", nullable=True)
    op.add_column(
        "batch_provision_jobs", sa.Column("teaching_class_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_batch_provision_teaching_class",
        "batch_provision_jobs",
        "teaching_classes",
        ["teaching_class_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_batch_provision_jobs_teaching_class_id",
        "batch_provision_jobs",
        ["teaching_class_id"],
    )

    op.create_table(
        "teaching_class_students",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "class_id",
            sa.Uuid(),
            sa.ForeignKey("teaching_classes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("class_id", "user_id", name="uq_teaching_class_student"),
    )
    op.create_index(
        "ix_teaching_class_students_class_id", "teaching_class_students", ["class_id"]
    )
    op.create_index(
        "ix_teaching_class_students_user_id", "teaching_class_students", ["user_id"]
    )

    op.create_table(
        "teaching_class_machine_nodes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "class_id",
            sa.Uuid(),
            sa.ForeignKey("teaching_classes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_key", sa.String(80), nullable=False),
        sa.Column(
            "source_template_id",
            sa.Uuid(),
            sa.ForeignKey("vm_templates.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(120), nullable=False),
        sa.Column("resource_type", sa.String(10), nullable=False),
        sa.Column("cpu", sa.Integer(), nullable=False),
        sa.Column("memory_mb", sa.Integer(), nullable=False),
        sa.Column("disk_gb", sa.Integer(), nullable=False),
        sa.Column("network", sa.String(255)),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column(
            "batch_job_id",
            sa.Uuid(),
            sa.ForeignKey("batch_provision_jobs.id", ondelete="SET NULL"),
        ),
        sa.UniqueConstraint(
            "class_id", "node_key", name="uq_teaching_class_machine_node"
        ),
    )
    op.create_index(
        "ix_teaching_class_machine_nodes_class_id",
        "teaching_class_machine_nodes",
        ["class_id"],
    )
    op.create_table(
        "teaching_class_weeks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "class_id",
            sa.Uuid(),
            sa.ForeignKey("teaching_classes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("week_number", sa.Integer(), nullable=False),
        sa.Column("session_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("target_node_key", sa.String(80)),
        sa.Column("status", sa.String(24), nullable=False),
        sa.UniqueConstraint("class_id", "week_number", name="uq_teaching_class_week"),
    )
    op.create_index(
        "ix_teaching_class_weeks_class_id", "teaching_class_weeks", ["class_id"]
    )
    op.create_table(
        "teaching_class_task_files",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "week_id",
            sa.Uuid(),
            sa.ForeignKey("teaching_class_weeks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("storage_key", sa.String(500)),
        sa.Column("target_path", sa.String(500)),
    )
    op.create_index(
        "ix_teaching_class_task_files_week_id", "teaching_class_task_files", ["week_id"]
    )
    op.create_table(
        "teaching_class_student_machines",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "class_student_id",
            sa.Uuid(),
            sa.ForeignKey("teaching_class_students.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "machine_node_id",
            sa.Uuid(),
            sa.ForeignKey("teaching_class_machine_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "batch_task_id",
            sa.Uuid(),
            sa.ForeignKey("batch_provision_tasks.id", ondelete="SET NULL"),
        ),
        sa.Column("vmid", sa.Integer()),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("error", sa.String(500)),
        sa.UniqueConstraint(
            "class_student_id",
            "machine_node_id",
            name="uq_teaching_class_student_machine",
        ),
    )
    op.create_index(
        "ix_teaching_class_student_machines_class_student_id",
        "teaching_class_student_machines",
        ["class_student_id"],
    )


def downgrade():
    for table in (
        "teaching_class_student_machines",
        "teaching_class_task_files",
        "teaching_class_weeks",
        "teaching_class_machine_nodes",
        "teaching_class_students",
    ):
        op.drop_table(table)
    op.execute("DELETE FROM batch_provision_jobs WHERE teaching_class_id IS NOT NULL")
    op.drop_index(
        "ix_batch_provision_jobs_teaching_class_id", table_name="batch_provision_jobs"
    )
    op.drop_constraint(
        "fk_batch_provision_teaching_class", "batch_provision_jobs", type_="foreignkey"
    )
    op.drop_column("batch_provision_jobs", "teaching_class_id")
    op.alter_column("batch_provision_jobs", "group_id", nullable=False)
    op.drop_table("teaching_classes")
    sa.Enum(name="teachingclassstatus").drop(op.get_bind(), checkfirst=True)
