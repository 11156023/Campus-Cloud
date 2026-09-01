"""Keep one private rubric source per Teacher Judge session.

Revision ID: tjsrc01_session_rubric_isolate
Revises: tjpg01_postgresql_commands
Create Date: 2026-08-26
"""

from __future__ import annotations

from copy import deepcopy

import sqlalchemy as sa
from alembic import op

revision = "tjsrc01_session_rubric_isolate"
down_revision = "tjpg01_postgresql_commands"
branch_labels = None
depends_on = None


def _index_exists(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(index["name"] == index_name for index in inspector.get_indexes(table_name))


def _clone_without_original_bytes(db, source, created_by):
    """Preserve a duplicated rubric when an old upload's bytes are missing."""
    from app.models.teacher_judge_file import TeacherJudgeFile, TeacherJudgeFileStatus

    clone = TeacherJudgeFile(
        teaching_class_id=source.teaching_class_id,
        uploaded_by=created_by,
        original_filename=None,
        file_hash=None,
        template_key=source.template_key,
        source_type="created",
        display_name=f"{source.display_name or source.original_filename or '評分表'}（副本）",
        environment_keys=list(source.environment_keys or [source.template_key]),
        analysis_json=deepcopy(source.analysis_json),
        analysis_revision=1,
        status=TeacherJudgeFileStatus.active,
        updated_at=source.updated_at,
    )
    db.add(clone)
    db.flush()
    return clone


def _repair_duplicate_sources(bind) -> None:
    """Copy legacy shared rows before adding the one-to-one unique index."""
    from fastapi import HTTPException
    from sqlmodel import Session, func, select

    from app.ai.teacher_judge.file_service import clone_file_asset
    from app.models.teacher_judge_file import TeacherJudgeFile
    from app.models.teacher_judge_session import TeacherJudgeSession

    with Session(bind=bind) as db:
        duplicate_file_ids = db.exec(
            select(TeacherJudgeSession.selected_file_id)
            .where(TeacherJudgeSession.selected_file_id.is_not(None))
            .group_by(TeacherJudgeSession.selected_file_id)
            .having(func.count() > 1)
        ).all()
        for file_id in duplicate_file_ids:
            sessions = db.exec(
                select(TeacherJudgeSession)
                .where(TeacherJudgeSession.selected_file_id == file_id)
                .order_by(TeacherJudgeSession.created_at, TeacherJudgeSession.id)
            ).all()
            source = db.get(TeacherJudgeFile, file_id)
            if source is None or len(sessions) < 2:
                continue
            for duplicate_session in sessions[1:]:
                try:
                    clone = clone_file_asset(
                        session=db,
                        source=source,
                        teaching_class_id=source.teaching_class_id,
                        created_by=duplicate_session.created_by,
                    )
                except HTTPException as exc:
                    if exc.status_code != 404:
                        raise
                    # Fall through to the structured-copy fallback below.
                    clone = _clone_without_original_bytes(
                        db, source, duplicate_session.created_by
                    )
                duplicate_session.selected_file_id = clone.id
                db.add(duplicate_session)
        db.flush()


def upgrade() -> None:
    bind = op.get_bind()
    _repair_duplicate_sources(bind)
    if not _index_exists(
        "teacher_judge_sessions", "uq_teacher_judge_sessions_selected_file"
    ):
        op.create_index(
            "uq_teacher_judge_sessions_selected_file",
            "teacher_judge_sessions",
            ["selected_file_id"],
            unique=True,
            postgresql_where=sa.text("selected_file_id IS NOT NULL"),
            sqlite_where=sa.text("selected_file_id IS NOT NULL"),
        )


def downgrade() -> None:
    if _index_exists(
        "teacher_judge_sessions", "uq_teacher_judge_sessions_selected_file"
    ):
        op.drop_index(
            "uq_teacher_judge_sessions_selected_file",
            table_name="teacher_judge_sessions",
        )
