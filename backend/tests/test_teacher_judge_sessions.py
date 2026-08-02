from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from app.ai.teacher_judge import session_service
from app.ai.teacher_judge.schemas import (
    TeacherJudgeSessionMessageCreateRequest,
)
from app.api.routes import teacher_judge_sessions
from app.models.teacher_judge_file import TeacherJudgeFile
from app.models.teacher_judge_script_artifact import TeacherJudgeScriptArtifact
from app.models.teacher_judge_script_run import TeacherJudgeScriptRun
from app.models.teacher_judge_session import (
    TeacherJudgeMessageRole,
    TeacherJudgeSession,
    TeacherJudgeSessionMessage,
    TeacherJudgeSessionStatus,
)


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _file(db: Session, class_id: uuid.UUID) -> TeacherJudgeFile:
    item = TeacherJudgeFile(
        teaching_class_id=class_id,
        original_filename="rubric.pdf",
        file_hash="a" * 64,
        template_key="linux",
        analysis_json={"items": [], "summary": "rubric"},
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_selected_file_must_belong_to_same_teaching_class() -> None:
    db = _session()
    foreign_file = _file(db, uuid.uuid4())

    with pytest.raises(HTTPException) as exc_info:
        session_service.validate_selected_file(db, uuid.uuid4(), foreign_file.id)

    assert exc_info.value.status_code == 400


def test_archived_session_is_read_only() -> None:
    item = TeacherJudgeSession(
        teaching_class_id=uuid.uuid4(),
        title="Archived",
        status=TeacherJudgeSessionStatus.archived,
    )

    with pytest.raises(HTTPException) as exc_info:
        session_service.ensure_active(item)

    assert exc_info.value.status_code == 409


def test_chat_can_start_without_selected_file() -> None:
    db = _session()
    item = TeacherJudgeSession(teaching_class_id=uuid.uuid4(), title="Chat first")
    db.add(item)
    db.commit()
    db.refresh(item)

    assert session_service.selected_file_for_chat(db, item) is None


def test_delete_session_data_removes_owned_records_but_keeps_shared_file() -> None:
    db = _session()
    class_id = uuid.uuid4()
    rubric_file = _file(db, class_id)
    item = TeacherJudgeSession(
        teaching_class_id=class_id,
        title="Delete me",
        selected_file_id=rubric_file.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    artifact = TeacherJudgeScriptArtifact(
        teaching_class_id=class_id,
        session_id=item.id,
        name="Delete script",
        template_key="linux",
        script_content="print('ok')",
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)
    db.add_all(
        [
            TeacherJudgeScriptRun(
                teaching_class_id=class_id,
                artifact_id=artifact.id,
            ),
            TeacherJudgeSessionMessage(
                session_id=item.id,
                role=TeacherJudgeMessageRole.user,
                content="remove this",
            ),
        ]
    )
    db.commit()

    session_service.delete_session_data(db, item)

    assert db.get(TeacherJudgeSession, item.id) is None
    assert db.get(TeacherJudgeScriptArtifact, artifact.id) is None
    assert not db.exec(select(TeacherJudgeScriptRun)).all()
    assert not db.exec(select(TeacherJudgeSessionMessage)).all()
    assert db.get(TeacherJudgeFile, rubric_file.id) is not None


@pytest.mark.asyncio
async def test_message_without_rubric_is_saved_and_uses_general_chat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    class_id = uuid.uuid4()
    item = TeacherJudgeSession(teaching_class_id=class_id, title="Chat first")
    db.add(item)
    db.commit()
    db.refresh(item)

    async def fake_chat(messages, rubric_context, **kwargs):
        assert messages[-1].content == "先討論檢查需求"
        assert rubric_context == "{}"
        assert kwargs["template_key"] == "linux"
        return "可以，先描述目標環境。", None, {}

    monkeypatch.setattr(teacher_judge_sessions, "_access", lambda *args: None)
    monkeypatch.setattr(teacher_judge_sessions, "chat_with_rubric", fake_chat)
    monkeypatch.setattr(
        teacher_judge_sessions, "get_enabled_template_commands", lambda *args: []
    )

    result = await teacher_judge_sessions.create_message(
        class_id,
        item.id,
        TeacherJudgeSessionMessageCreateRequest(content="先討論檢查需求"),
        db,
        SimpleNamespace(id=uuid.uuid4()),
    )

    assert result.user_message.content == "先討論檢查需求"
    assert result.assistant_message.content == "可以，先描述目標環境。"
    assert result.rubric_proposal is None
    assert len(db.exec(select(TeacherJudgeSessionMessage)).all()) == 2


def test_message_content_redacts_common_secrets() -> None:
    content = session_service.redact_message_content(
        "token=abc123 password: hunter2\n"
        "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"
    )

    assert "abc123" not in content
    assert "hunter2" not in content
    assert "\nsecret\n" not in content
    assert content.count("[REDACTED]") == 2


def test_bounded_history_keeps_latest_messages_in_stable_order() -> None:
    db = _session()
    item = TeacherJudgeSession(teaching_class_id=uuid.uuid4(), title="History")
    db.add(item)
    db.commit()
    db.refresh(item)
    started_at = datetime(2026, 7, 31, tzinfo=timezone.utc)
    for index in range(25):
        db.add(
            TeacherJudgeSessionMessage(
                session_id=item.id,
                role=(
                    TeacherJudgeMessageRole.user
                    if index % 2 == 0
                    else TeacherJudgeMessageRole.assistant
                ),
                content=f"message-{index:02d}",
                created_at=started_at + timedelta(seconds=index),
            )
        )
    db.commit()

    history = session_service.bounded_history(db, item.id)

    assert len(history) == session_service.HISTORY_MESSAGE_LIMIT
    assert history[0].content == "message-05"
    assert history[-1].content == "message-24"


@pytest.mark.asyncio
async def test_summary_runs_only_on_tenth_completed_turn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    class_id = uuid.uuid4()
    rubric_file = _file(db, class_id)
    item = TeacherJudgeSession(
        teaching_class_id=class_id,
        title="Summary",
        selected_file_id=rubric_file.id,
        summary="old",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    calls = 0

    async def fake_chat(*args, **kwargs):
        nonlocal calls
        calls += 1
        return "new summary", None, {}

    monkeypatch.setattr(session_service, "chat_with_rubric", fake_chat)
    monkeypatch.setattr(
        session_service, "get_enabled_template_commands", lambda *args: []
    )

    for index in range(9):
        db.add(
            TeacherJudgeSessionMessage(
                session_id=item.id,
                role=TeacherJudgeMessageRole.assistant,
                content=f"assistant-{index}",
            )
        )
    db.commit()
    await session_service.maybe_summarize(db, item, rubric_file)
    assert calls == 0
    assert item.summary == "old"

    db.add(
        TeacherJudgeSessionMessage(
            session_id=item.id,
            role=TeacherJudgeMessageRole.assistant,
            content="assistant-10",
        )
    )
    db.commit()
    await session_service.maybe_summarize(db, item, rubric_file)

    assert calls == 1
    assert item.summary == "new summary"


@pytest.mark.asyncio
async def test_summary_failure_preserves_previous_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    class_id = uuid.uuid4()
    rubric_file = _file(db, class_id)
    item = TeacherJudgeSession(
        teaching_class_id=class_id,
        title="Summary failure",
        selected_file_id=rubric_file.id,
        summary="keep me",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    for index in range(10):
        db.add(
            TeacherJudgeSessionMessage(
                session_id=item.id,
                role=TeacherJudgeMessageRole.assistant,
                content=f"assistant-{index}",
            )
        )
    db.commit()

    async def fail_chat(*args, **kwargs):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(session_service, "chat_with_rubric", fail_chat)
    monkeypatch.setattr(
        session_service, "get_enabled_template_commands", lambda *args: []
    )
    await session_service.maybe_summarize(db, item, rubric_file)

    assert item.summary == "keep me"
