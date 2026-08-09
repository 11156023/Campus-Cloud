"""add persistent teacher judge sessions

Revision ID: tjs01_teacher_judge_sessions
Revises: aipve01_ai_pve_templates
Create Date: 2026-07-31
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "tjs01_teacher_judge_sessions"
down_revision = "aipve01_ai_pve_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session_status = postgresql.ENUM(
        "active", "archived", name="teacherjudgesessionstatus", create_type=False
    )
    message_role = postgresql.ENUM(
        "user", "assistant", name="teacherjudgemessagerole", create_type=False
    )
    message_type = postgresql.ENUM(
        "chat",
        "rubric_proposal",
        "system_notice",
        name="teacherjudgemessagetype",
        create_type=False,
    )
    session_status.create(op.get_bind(), checkfirst=True)
    message_role.create(op.get_bind(), checkfirst=True)
    message_type.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "teacher_judge_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("teaching_class_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("status", session_status, nullable=False),
        sa.Column("selected_file_id", sa.Uuid(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["selected_file_id"], ["teacher_judge_files.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["teaching_class_id"], ["teaching_classes.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_teacher_judge_sessions_class_activity",
        "teacher_judge_sessions",
        ["teaching_class_id", "last_activity_at"],
    )
    op.create_index(
        "ix_teacher_judge_sessions_teaching_class_id",
        "teacher_judge_sessions",
        ["teaching_class_id"],
    )
    op.create_index(
        "ix_teacher_judge_sessions_status", "teacher_judge_sessions", ["status"]
    )
    op.create_index(
        "ix_teacher_judge_sessions_selected_file_id",
        "teacher_judge_sessions",
        ["selected_file_id"],
    )
    op.create_index(
        "ix_teacher_judge_sessions_created_by", "teacher_judge_sessions", ["created_by"]
    )
    op.create_index(
        "ix_teacher_judge_sessions_last_activity_at",
        "teacher_judge_sessions",
        ["last_activity_at"],
    )
    op.create_table(
        "teacher_judge_session_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("role", message_role, nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("message_type", message_type, nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["session_id"], ["teacher_judge_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_teacher_judge_session_messages_session_created",
        "teacher_judge_session_messages",
        ["session_id", "created_at", "id"],
    )
    op.create_index(
        "ix_teacher_judge_session_messages_session_id",
        "teacher_judge_session_messages",
        ["session_id"],
    )
    op.create_index(
        "ix_teacher_judge_session_messages_created_by",
        "teacher_judge_session_messages",
        ["created_by"],
    )
    op.create_index(
        "ix_teacher_judge_session_messages_created_at",
        "teacher_judge_session_messages",
        ["created_at"],
    )
    op.add_column(
        "teacher_judge_script_artifacts",
        sa.Column("session_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_teacher_judge_script_artifacts_session_id",
        "teacher_judge_script_artifacts",
        "teacher_judge_sessions",
        ["session_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_teacher_judge_script_artifacts_session_id",
        "teacher_judge_script_artifacts",
        ["session_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_teacher_judge_script_artifacts_session_id",
        table_name="teacher_judge_script_artifacts",
    )
    op.drop_constraint(
        "fk_teacher_judge_script_artifacts_session_id",
        "teacher_judge_script_artifacts",
        type_="foreignkey",
    )
    op.drop_column("teacher_judge_script_artifacts", "session_id")
    op.drop_table("teacher_judge_session_messages")
    op.drop_table("teacher_judge_sessions")
    for name in (
        "teacherjudgemessagetype",
        "teacherjudgemessagerole",
        "teacherjudgesessionstatus",
    ):
        sa.Enum(name=name).drop(op.get_bind(), checkfirst=True)
