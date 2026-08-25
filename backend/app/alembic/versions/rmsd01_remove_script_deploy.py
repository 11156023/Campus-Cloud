"""Remove script deploy feature: drop script_deploy_logs table and
service_template columns on vm_requests / resources.

Revision ID: rmsd01_remove_script_deploy
Revises: vmexp01_expired
Create Date: 2026-08-04
"""

import sqlalchemy as sa
from alembic import op

revision = "rmsd01_remove_script_deploy"
down_revision = "vmexp01_expired"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("vm_requests", "service_template_script_path")
    op.drop_column("vm_requests", "service_template_slug")
    op.drop_column("resources", "service_template_slug")

    op.drop_index("ix_script_deploy_logs_created_at", table_name="script_deploy_logs")
    op.drop_index("ix_script_deploy_logs_status", table_name="script_deploy_logs")
    op.drop_index(
        "ix_script_deploy_logs_template_slug", table_name="script_deploy_logs"
    )
    op.drop_index("ix_script_deploy_logs_vmid", table_name="script_deploy_logs")
    op.drop_index("ix_script_deploy_logs_user_id", table_name="script_deploy_logs")
    op.drop_index("ix_script_deploy_logs_task_id", table_name="script_deploy_logs")
    op.drop_index(
        "ix_script_deploy_logs_resource_vmid", table_name="script_deploy_logs"
    )
    op.drop_table("script_deploy_logs")


def downgrade():
    op.create_table(
        "script_deploy_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("vmid", sa.Integer(), nullable=True),
        sa.Column("resource_vmid", sa.Integer(), nullable=True),
        sa.Column("template_slug", sa.String(length=120), nullable=False),
        sa.Column("template_name", sa.String(length=255), nullable=True),
        sa.Column("script_path", sa.String(length=500), nullable=True),
        sa.Column("hostname", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("progress", sa.String(length=255), nullable=True),
        sa.Column("message", sa.String(length=2000), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("output", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_script_deploy_logs_task_id", "script_deploy_logs", ["task_id"], unique=True
    )
    op.create_index("ix_script_deploy_logs_user_id", "script_deploy_logs", ["user_id"])
    op.create_index("ix_script_deploy_logs_vmid", "script_deploy_logs", ["vmid"])
    op.create_index(
        "ix_script_deploy_logs_resource_vmid", "script_deploy_logs", ["resource_vmid"]
    )
    op.create_index(
        "ix_script_deploy_logs_template_slug", "script_deploy_logs", ["template_slug"]
    )
    op.create_index("ix_script_deploy_logs_status", "script_deploy_logs", ["status"])
    op.create_index(
        "ix_script_deploy_logs_created_at", "script_deploy_logs", ["created_at"]
    )

    op.add_column(
        "resources",
        sa.Column("service_template_slug", sa.String(), nullable=True),
    )
    op.add_column(
        "vm_requests",
        sa.Column("service_template_slug", sa.String(), nullable=True),
    )
    op.add_column(
        "vm_requests",
        sa.Column("service_template_script_path", sa.String(), nullable=True),
    )
