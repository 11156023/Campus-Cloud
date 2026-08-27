"""Add multi-machine quick-practice sessions.

Revision ID: qp01_quick_practice
Revises: cpath01_link_class
Create Date: 2026-08-27
"""

import sqlalchemy as sa
from alembic import op

revision = "qp01_quick_practice"
down_revision = "cpath01_link_class"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "course_environments",
        sa.Column(
            "usage_scope",
            sa.String(length=24),
            nullable=False,
            server_default="course",
        ),
    )

    op.create_table(
        "quick_practice_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("environment_version_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["environment_version_id"],
            ["course_environment_versions.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_quick_practice_sessions_user_id",
        "quick_practice_sessions",
        ["user_id"],
    )
    op.create_index(
        "ix_quick_practice_sessions_environment_version_id",
        "quick_practice_sessions",
        ["environment_version_id"],
    )
    op.create_index(
        "ix_quick_practice_sessions_created_at",
        "quick_practice_sessions",
        ["created_at"],
    )
    op.create_index(
        "ix_quick_practice_sessions_expires_at",
        "quick_practice_sessions",
        ["expires_at"],
    )

    op.create_table(
        "quick_practice_session_machines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("vm_request_id", sa.Uuid(), nullable=False),
        sa.Column("node_key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=120), nullable=False),
        sa.Column("resource_type", sa.String(length=10), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["quick_practice_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["vm_request_id"],
            ["vm_requests.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id",
            "node_key",
            name="uq_quick_practice_session_node",
        ),
        sa.UniqueConstraint("vm_request_id"),
    )
    op.create_index(
        "ix_quick_practice_session_machines_session_id",
        "quick_practice_session_machines",
        ["session_id"],
    )
    op.create_index(
        "ix_quick_practice_session_machines_vm_request_id",
        "quick_practice_session_machines",
        ["vm_request_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_quick_practice_session_machines_vm_request_id",
        table_name="quick_practice_session_machines",
    )
    op.drop_index(
        "ix_quick_practice_session_machines_session_id",
        table_name="quick_practice_session_machines",
    )
    op.drop_table("quick_practice_session_machines")
    op.drop_index(
        "ix_quick_practice_sessions_expires_at",
        table_name="quick_practice_sessions",
    )
    op.drop_index(
        "ix_quick_practice_sessions_created_at",
        table_name="quick_practice_sessions",
    )
    op.drop_index(
        "ix_quick_practice_sessions_environment_version_id",
        table_name="quick_practice_sessions",
    )
    op.drop_index(
        "ix_quick_practice_sessions_user_id",
        table_name="quick_practice_sessions",
    )
    op.drop_table("quick_practice_sessions")
    op.drop_column("course_environments", "usage_scope")
