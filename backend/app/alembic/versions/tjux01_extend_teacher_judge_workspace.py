"""Extend Teacher Judge assets for the teacher workspace UX.

Revision ID: tjux01_teacher_judge_workspace
Revises: tc06_unique_active_delete
Create Date: 2026-08-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "tjux01_teacher_judge_workspace"
down_revision = "tc06_unique_active_delete"
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def _indexes(table_name: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)}


def _tighten_file_columns(bind: sa.engine.Connection) -> None:
    """Make the new fields non-null on both PostgreSQL and SQLite."""
    columns = (
        ("source_type", sa.String(length=20), "uploaded"),
        ("display_name", sa.String(length=255), "評分表"),
        (
            "environment_keys",
            sa.JSON(),
            sa.text("'[]'::json") if bind.dialect.name == "postgresql" else "[]",
        ),
        ("analysis_revision", sa.Integer(), "1"),
    )
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("teacher_judge_files", recreate="always") as batch:
            for name, column_type, server_default in columns:
                batch.alter_column(
                    name,
                    existing_type=column_type,
                    nullable=False,
                    server_default=server_default,
                )
            batch.alter_column(
                "original_filename",
                existing_type=sa.String(length=255),
                nullable=True,
            )
            batch.alter_column(
                "file_hash",
                existing_type=sa.String(length=64),
                nullable=True,
            )
        return

    for name, column_type, server_default in columns:
        op.alter_column(
            "teacher_judge_files",
            name,
            existing_type=column_type,
            nullable=False,
            server_default=server_default,
        )
    op.alter_column(
        "teacher_judge_files",
        "original_filename",
        existing_type=sa.String(length=255),
        nullable=True,
    )
    op.alter_column(
        "teacher_judge_files",
        "file_hash",
        existing_type=sa.String(length=64),
        nullable=True,
    )


def _clear_file_defaults(bind: sa.engine.Connection) -> None:
    names = ("source_type", "display_name", "environment_keys", "analysis_revision")
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("teacher_judge_files", recreate="always") as batch:
            for name in names:
                batch.alter_column(name, server_default=None)
        return
    for name in names:
        batch_type = {
            "source_type": sa.String(length=20),
            "display_name": sa.String(length=255),
            "environment_keys": sa.JSON(),
            "analysis_revision": sa.Integer(),
        }[name]
        op.alter_column(
            "teacher_judge_files",
            name,
            existing_type=batch_type,
            server_default=None,
        )


def upgrade() -> None:
    bind = op.get_bind()
    file_columns = _columns("teacher_judge_files")
    session_columns = _columns("teacher_judge_sessions")

    if "source_type" not in file_columns:
        op.add_column(
            "teacher_judge_files",
            sa.Column("source_type", sa.String(length=20), nullable=True),
        )
    if "display_name" not in file_columns:
        op.add_column(
            "teacher_judge_files",
            sa.Column("display_name", sa.String(length=255), nullable=True),
        )
    if "environment_keys" not in file_columns:
        op.add_column(
            "teacher_judge_files",
            sa.Column("environment_keys", sa.JSON(), nullable=True),
        )
    if "analysis_revision" not in file_columns:
        op.add_column(
            "teacher_judge_files",
            sa.Column("analysis_revision", sa.Integer(), nullable=True),
        )

    # Backfill existing uploads before tightening the new columns.  The
    # dialect-specific JSON literal keeps the migration usable in the SQLite
    # metadata tests as well as disposable PostgreSQL environments.
    op.execute(
        sa.text(
            "UPDATE teacher_judge_files "
            "SET source_type = COALESCE(source_type, 'uploaded'), "
            "display_name = COALESCE(display_name, original_filename, '評分表'), "
            "analysis_revision = COALESCE(analysis_revision, 1)"
        )
    )
    if bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                "UPDATE teacher_judge_files "
                "SET environment_keys = COALESCE(environment_keys, "
                "json_build_array(COALESCE(template_key, 'linux')))"
            )
        )
    else:
        op.execute(
            sa.text(
                "UPDATE teacher_judge_files SET environment_keys = "
                "COALESCE(environment_keys, json_array(COALESCE(template_key, 'linux')))"
            )
        )

    _tighten_file_columns(bind)
    _clear_file_defaults(bind)

    file_indexes = _indexes("teacher_judge_files")
    if "ix_teacher_judge_files_source_type" not in file_indexes:
        op.create_index(
            "ix_teacher_judge_files_source_type",
            "teacher_judge_files",
            ["source_type"],
        )
    if "uq_teacher_judge_files_active_filename" in file_indexes:
        op.drop_index("uq_teacher_judge_files_active_filename", table_name="teacher_judge_files")
    op.create_index(
        "uq_teacher_judge_files_active_filename",
        "teacher_judge_files",
        ["teaching_class_id", "original_filename"],
        unique=True,
        postgresql_where=sa.text(
            "status = 'active' AND original_filename IS NOT NULL"
        ),
        sqlite_where=sa.text(
            "status = 'active' AND original_filename IS NOT NULL"
        ),
    )

    if "pinned_at" not in session_columns:
        op.add_column(
            "teacher_judge_sessions",
            sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True),
        )
    session_indexes = _indexes("teacher_judge_sessions")
    if "ix_teacher_judge_sessions_pinned_at" not in session_indexes:
        op.create_index(
            "ix_teacher_judge_sessions_pinned_at",
            "teacher_judge_sessions",
            ["pinned_at"],
        )
    if "ix_teacher_judge_sessions_class_pinned_activity" not in session_indexes:
        op.create_index(
            "ix_teacher_judge_sessions_class_pinned_activity",
            "teacher_judge_sessions",
            ["teaching_class_id", "pinned_at", "last_activity_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    session_indexes = _indexes("teacher_judge_sessions")
    if "ix_teacher_judge_sessions_class_pinned_activity" in session_indexes:
        op.drop_index(
            "ix_teacher_judge_sessions_class_pinned_activity",
            table_name="teacher_judge_sessions",
        )
    if "ix_teacher_judge_sessions_pinned_at" in session_indexes:
        op.drop_index("ix_teacher_judge_sessions_pinned_at", table_name="teacher_judge_sessions")
    if "pinned_at" in _columns("teacher_judge_sessions"):
        op.drop_column("teacher_judge_sessions", "pinned_at")

    file_indexes = _indexes("teacher_judge_files")
    if "uq_teacher_judge_files_active_filename" in file_indexes:
        op.drop_index("uq_teacher_judge_files_active_filename", table_name="teacher_judge_files")
    if "ix_teacher_judge_files_source_type" in file_indexes:
        op.drop_index("ix_teacher_judge_files_source_type", table_name="teacher_judge_files")
    columns = _columns("teacher_judge_files")
    if "original_filename" in columns:
        if bind.dialect.name == "postgresql":
            op.execute(
                sa.text(
                    "UPDATE teacher_judge_files SET original_filename = "
                    "COALESCE(original_filename, left(COALESCE(display_name, '評分表'), 180) || '-' || "
                    "id::text || '.created')"
                )
            )
        else:
            op.execute(
                sa.text(
                    "UPDATE teacher_judge_files SET original_filename = "
                    "COALESCE(original_filename, substr(COALESCE(display_name, '評分表'), 1, 180) || '-' || "
                    "hex(id) || '.created')"
                )
            )
    if "file_hash" in columns:
        op.execute(
            sa.text(
                "UPDATE teacher_judge_files SET file_hash = COALESCE(file_hash, '')"
            )
        )
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("teacher_judge_files", recreate="always") as batch:
            if "original_filename" in columns:
                batch.alter_column(
                    "original_filename",
                    existing_type=sa.String(length=255),
                    nullable=False,
                )
            if "file_hash" in columns:
                batch.alter_column(
                    "file_hash",
                    existing_type=sa.String(length=64),
                    nullable=False,
                )
            for column_name in ("analysis_revision", "environment_keys", "display_name", "source_type"):
                if column_name in _columns("teacher_judge_files"):
                    batch.drop_column(column_name)
    else:
        if "original_filename" in columns:
            op.alter_column(
                "teacher_judge_files",
                "original_filename",
                existing_type=sa.String(length=255),
                nullable=False,
            )
        if "file_hash" in columns:
            op.alter_column(
                "teacher_judge_files",
                "file_hash",
                existing_type=sa.String(length=64),
                nullable=False,
            )
        for column_name in ("analysis_revision", "environment_keys", "display_name", "source_type"):
            if column_name in _columns("teacher_judge_files"):
                op.drop_column("teacher_judge_files", column_name)

    op.create_index(
        "uq_teacher_judge_files_active_filename",
        "teacher_judge_files",
        ["teaching_class_id", "original_filename"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
        sqlite_where=sa.text("status = 'active'"),
    )
