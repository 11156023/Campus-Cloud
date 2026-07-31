"""Persistent Teacher Judge session workflow."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlmodel import Session, desc, func, select

from app.ai.teacher_judge.schemas import (
    TeacherJudgeRubricChatMessage,
    TeacherJudgeSessionMessagePublic,
    TeacherJudgeSessionPublic,
)
from app.ai.teacher_judge.service import chat_with_rubric
from app.ai.teacher_judge.template_command_service import get_enabled_template_commands
from app.models.teacher_judge_file import TeacherJudgeFile, TeacherJudgeFileStatus
from app.models.teacher_judge_script_artifact import TeacherJudgeScriptArtifact
from app.models.teacher_judge_script_run import TeacherJudgeScriptRun
from app.models.teacher_judge_session import (
    TeacherJudgeMessageRole,
    TeacherJudgeMessageType,
    TeacherJudgeSession,
    TeacherJudgeSessionMessage,
    TeacherJudgeSessionStatus,
)

HISTORY_MESSAGE_LIMIT = 20
HISTORY_CHARACTER_LIMIT = 24000
SUMMARY_TURN_INTERVAL = 10
_SENSITIVE_PATTERNS = (
    re.compile(
        r"(?i)\b(password|passwd|token|secret|api[_-]?key|authorization)\b"
        r"(\s*[:=]\s*)([^\s,;]+)"
    ),
    re.compile(
        r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----", re.DOTALL
    ),
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def redact_message_content(value: str) -> str:
    redacted = value
    redacted = _SENSITIVE_PATTERNS[0].sub(r"\1\2[REDACTED]", redacted)
    redacted = _SENSITIVE_PATTERNS[1].sub("[REDACTED PRIVATE KEY]", redacted)
    return redacted


def require_selected_file(db: Session, item: TeacherJudgeSession) -> TeacherJudgeFile:
    if not item.selected_file_id:
        raise HTTPException(status_code=409, detail="Session 尚未選擇評分表。")
    file = db.get(TeacherJudgeFile, item.selected_file_id)
    if (
        not file
        or file.teaching_class_id != item.teaching_class_id
        or file.status != TeacherJudgeFileStatus.active
    ):
        raise HTTPException(status_code=409, detail="Session 選定的評分表已無法使用。")
    return file


def selected_file_for_chat(
    db: Session, item: TeacherJudgeSession
) -> TeacherJudgeFile | None:
    """Return the selected rubric when present; a chat can start without one."""
    if not item.selected_file_id:
        return None
    return require_selected_file(db, item)


def get_session(
    db: Session, class_id: uuid.UUID, session_id: uuid.UUID
) -> TeacherJudgeSession:
    item = db.get(TeacherJudgeSession, session_id)
    if not item or item.teaching_class_id != class_id:
        raise HTTPException(status_code=404, detail="Teacher Judge session not found")
    return item


def delete_session_data(db: Session, item: TeacherJudgeSession) -> None:
    """Delete a session and all session-owned messages, scripts, and runs.

    Rubric files are class-scoped library records and may be shared by multiple
    sessions, so the selected file itself is intentionally preserved.
    """
    artifacts = list(
        db.exec(
            select(TeacherJudgeScriptArtifact).where(
                TeacherJudgeScriptArtifact.session_id == item.id
            )
        )
    )
    for artifact in artifacts:
        runs = list(
            db.exec(
                select(TeacherJudgeScriptRun).where(
                    TeacherJudgeScriptRun.artifact_id == artifact.id
                )
            )
        )
        for run in runs:
            db.delete(run)

    messages = list(
        db.exec(
            select(TeacherJudgeSessionMessage).where(
                TeacherJudgeSessionMessage.session_id == item.id
            )
        )
    )
    for message in messages:
        db.delete(message)
    for artifact in artifacts:
        db.delete(artifact)

    db.delete(item)
    db.commit()


def ensure_active(item: TeacherJudgeSession) -> None:
    if item.status == TeacherJudgeSessionStatus.archived:
        raise HTTPException(status_code=409, detail="已封存的 session 為唯讀。")


def validate_selected_file(
    db: Session, class_id: uuid.UUID, file_id: uuid.UUID | None
) -> None:
    if file_id is None:
        return
    file = db.get(TeacherJudgeFile, file_id)
    if (
        not file
        or file.teaching_class_id != class_id
        or file.status != TeacherJudgeFileStatus.active
    ):
        raise HTTPException(
            status_code=400,
            detail="Selected rubric file does not belong to this teaching class",
        )


def session_public(db: Session, item: TeacherJudgeSession) -> TeacherJudgeSessionPublic:
    file = (
        db.get(TeacherJudgeFile, item.selected_file_id)
        if item.selected_file_id
        else None
    )
    message_count = db.exec(
        select(func.count())
        .select_from(TeacherJudgeSessionMessage)
        .where(TeacherJudgeSessionMessage.session_id == item.id)
    ).one()
    script_count = db.exec(
        select(func.count())
        .select_from(TeacherJudgeScriptArtifact)
        .where(TeacherJudgeScriptArtifact.session_id == item.id)
    ).one()
    run_count = db.exec(
        select(func.count())
        .select_from(TeacherJudgeScriptRun)
        .join(TeacherJudgeScriptArtifact)
        .where(TeacherJudgeScriptArtifact.session_id == item.id)
    ).one()
    return TeacherJudgeSessionPublic(
        id=str(item.id),
        teaching_class_id=str(item.teaching_class_id),
        title=item.title,
        status=item.status.value,
        selected_file_id=str(item.selected_file_id) if item.selected_file_id else None,
        selected_file_name=file.original_filename if file else None,
        template_key=file.template_key if file else None,
        summary=item.summary,
        message_count=message_count,
        script_count=script_count,
        run_count=run_count,
        created_by=str(item.created_by) if item.created_by else None,
        created_at=item.created_at.isoformat(),
        updated_at=item.updated_at.isoformat(),
        last_activity_at=item.last_activity_at.isoformat(),
    )


def message_public(
    item: TeacherJudgeSessionMessage,
) -> TeacherJudgeSessionMessagePublic:
    return TeacherJudgeSessionMessagePublic(
        id=str(item.id),
        session_id=str(item.session_id),
        role=item.role.value,
        content=item.content,
        message_type=item.message_type.value,
        metadata_json=item.metadata_json,
        created_by=str(item.created_by) if item.created_by else None,
        created_at=item.created_at.isoformat(),
    )


def bounded_history(
    db: Session, session_id: uuid.UUID
) -> list[TeacherJudgeRubricChatMessage]:
    rows = list(
        db.exec(
            select(TeacherJudgeSessionMessage)
            .where(
                TeacherJudgeSessionMessage.session_id == session_id,
                TeacherJudgeSessionMessage.message_type
                != TeacherJudgeMessageType.system_notice,
            )
            .order_by(
                desc(TeacherJudgeSessionMessage.created_at),
                desc(TeacherJudgeSessionMessage.id),
            )
            .limit(HISTORY_MESSAGE_LIMIT)
        )
    )
    rows.reverse()
    kept: list[TeacherJudgeSessionMessage] = []
    size = 0
    for row in reversed(rows):
        if kept and size + len(row.content) > HISTORY_CHARACTER_LIMIT:
            break
        kept.append(row)
        size += len(row.content)
    return [
        TeacherJudgeRubricChatMessage(role=row.role.value, content=row.content)
        for row in reversed(kept)
    ]


async def maybe_summarize(
    db: Session, item: TeacherJudgeSession, file: TeacherJudgeFile | None
) -> None:
    assistant_count = db.exec(
        select(func.count())
        .select_from(TeacherJudgeSessionMessage)
        .where(
            TeacherJudgeSessionMessage.session_id == item.id,
            TeacherJudgeSessionMessage.role == TeacherJudgeMessageRole.assistant,
            TeacherJudgeSessionMessage.message_type
            != TeacherJudgeMessageType.system_notice,
        )
    ).one()
    if not assistant_count or assistant_count % SUMMARY_TURN_INTERVAL:
        return
    messages = bounded_history(db, item.id)
    messages.append(
        TeacherJudgeRubricChatMessage(
            role="user",
            content="請將以上最近十輪對話與既有摘要壓縮為簡短繁體中文工作摘要，只回傳摘要文字。既有摘要："
            + item.summary,
        )
    )
    try:
        rubric_context = json.dumps(file.analysis_json, ensure_ascii=False) if file else "{}"
        template_key = file.template_key if file else "linux"
        reply, _, _ = await chat_with_rubric(
            messages,
            rubric_context,
            is_refine=False,
            template_key=template_key,
            template_commands=get_enabled_template_commands(db, template_key),
        )
    except Exception:
        return
    item.summary = reply[:12000]
    item.updated_at = _now()
    db.add(item)
    db.commit()
