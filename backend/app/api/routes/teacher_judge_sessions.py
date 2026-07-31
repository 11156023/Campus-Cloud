"""Class-scoped persistent Teacher Judge session APIs."""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import desc, select

from app.ai.teacher_judge.schemas import (
    TeacherJudgeRubricAnalysis,
    TeacherJudgeScriptArtifactPublic,
    TeacherJudgeScriptRunCreateRequest,
    TeacherJudgeScriptRunPublic,
    TeacherJudgeScriptRunSummary,
    TeacherJudgeSessionChatResponse,
    TeacherJudgeSessionCreateRequest,
    TeacherJudgeSessionMessageCreateRequest,
    TeacherJudgeSessionMessagePublic,
    TeacherJudgeSessionPublic,
    TeacherJudgeSessionUpdateRequest,
)
from app.ai.teacher_judge.script_artifact_service import create_artifact
from app.ai.teacher_judge.script_executor_service import execute_script_run
from app.ai.teacher_judge.script_run_service import _run_to_public, create_script_run
from app.ai.teacher_judge.service import chat_with_rubric
from app.ai.teacher_judge.session_service import (
    bounded_history,
    ensure_active,
    get_session,
    maybe_summarize,
    message_public,
    redact_message_content,
    require_selected_file,
    session_public,
    validate_selected_file,
)
from app.ai.teacher_judge.template_command_service import get_enabled_template_commands
from app.api.deps import InstructorUser, SessionDep
from app.core.authorizers import require_teaching_access
from app.infrastructure.worker import submit
from app.models import TeachingClass
from app.models.teacher_judge_script_artifact import TeacherJudgeScriptArtifact
from app.models.teacher_judge_script_run import (
    TeacherJudgeScriptRun,
    TeacherJudgeScriptRunTargetScope,
)
from app.models.teacher_judge_session import (
    TeacherJudgeMessageRole,
    TeacherJudgeMessageType,
    TeacherJudgeSession,
    TeacherJudgeSessionMessage,
    TeacherJudgeSessionStatus,
)

router = APIRouter(
    prefix="/teaching-classes/{teaching_class_id}/judge/sessions",
    tags=["teacher-judge"],
)


def _access(db: SessionDep, class_id: uuid.UUID, user: InstructorUser) -> None:
    teaching_class = db.get(TeachingClass, class_id)
    if not teaching_class:
        raise HTTPException(status_code=404, detail="Teaching class not found")
    require_teaching_access(user, teaching_class.owner_id)


@router.get("/", response_model=list[TeacherJudgeSessionPublic])
def list_sessions(
    teaching_class_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
    status: TeacherJudgeSessionStatus = TeacherJudgeSessionStatus.active,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> list[TeacherJudgeSessionPublic]:
    _access(session, teaching_class_id, current_user)
    rows = session.exec(
        select(TeacherJudgeSession)
        .where(
            TeacherJudgeSession.teaching_class_id == teaching_class_id,
            TeacherJudgeSession.status == status,
        )
        .order_by(
            desc(TeacherJudgeSession.last_activity_at), desc(TeacherJudgeSession.id)
        )
        .offset(skip)
        .limit(limit)
    ).all()
    return [session_public(session, row) for row in rows]


@router.post("/", response_model=TeacherJudgeSessionPublic)
def create_session(
    teaching_class_id: uuid.UUID,
    payload: TeacherJudgeSessionCreateRequest,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeSessionPublic:
    _access(session, teaching_class_id, current_user)
    validate_selected_file(session, teaching_class_id, payload.selected_file_id)
    item = TeacherJudgeSession(
        teaching_class_id=teaching_class_id,
        title=payload.title.strip(),
        selected_file_id=payload.selected_file_id,
        created_by=current_user.id,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return session_public(session, item)


@router.get("/{session_id}", response_model=TeacherJudgeSessionPublic)
def get_session_detail(
    teaching_class_id: uuid.UUID,
    session_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeSessionPublic:
    _access(session, teaching_class_id, current_user)
    return session_public(session, get_session(session, teaching_class_id, session_id))


@router.patch("/{session_id}", response_model=TeacherJudgeSessionPublic)
def update_session(
    teaching_class_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: TeacherJudgeSessionUpdateRequest,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeSessionPublic:
    _access(session, teaching_class_id, current_user)
    item = get_session(session, teaching_class_id, session_id)
    changes = payload.model_fields_set
    if item.status == TeacherJudgeSessionStatus.archived and changes - {"status"}:
        raise HTTPException(status_code=409, detail="已封存的 session 為唯讀。")
    if "title" in changes and payload.title is not None:
        item.title = payload.title.strip()
    if "selected_file_id" in changes:
        validate_selected_file(session, teaching_class_id, payload.selected_file_id)
        item.selected_file_id = payload.selected_file_id
    if payload.status is not None:
        item.status = TeacherJudgeSessionStatus(payload.status)
    from app.models.base import get_datetime_utc

    item.updated_at = get_datetime_utc()
    item.last_activity_at = item.updated_at
    session.add(item)
    session.commit()
    session.refresh(item)
    return session_public(session, item)


@router.post("/{session_id}/archive", response_model=TeacherJudgeSessionPublic)
def archive_session(
    teaching_class_id: uuid.UUID,
    session_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeSessionPublic:
    return update_session(
        teaching_class_id,
        session_id,
        TeacherJudgeSessionUpdateRequest(status="archived"),
        session,
        current_user,
    )


@router.get(
    "/{session_id}/messages", response_model=list[TeacherJudgeSessionMessagePublic]
)
def list_messages(
    teaching_class_id: uuid.UUID,
    session_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
    before: uuid.UUID | None = None,
    limit: int = Query(50, ge=1, le=100),
) -> list[TeacherJudgeSessionMessagePublic]:
    _access(session, teaching_class_id, current_user)
    get_session(session, teaching_class_id, session_id)
    query = select(TeacherJudgeSessionMessage).where(
        TeacherJudgeSessionMessage.session_id == session_id
    )
    if before:
        cursor = session.get(TeacherJudgeSessionMessage, before)
        if not cursor or cursor.session_id != session_id:
            raise HTTPException(status_code=400, detail="Invalid message cursor")
        query = query.where(
            (TeacherJudgeSessionMessage.created_at < cursor.created_at)
            | (
                (TeacherJudgeSessionMessage.created_at == cursor.created_at)
                & (TeacherJudgeSessionMessage.id < cursor.id)
            )
        )
    rows = list(
        session.exec(
            query.order_by(
                desc(TeacherJudgeSessionMessage.created_at),
                desc(TeacherJudgeSessionMessage.id),
            ).limit(limit)
        )
    )
    rows.reverse()
    return [message_public(row) for row in rows]


@router.post("/{session_id}/messages", response_model=TeacherJudgeSessionChatResponse)
async def create_message(
    teaching_class_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: TeacherJudgeSessionMessageCreateRequest,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeSessionChatResponse:
    _access(session, teaching_class_id, current_user)
    item = get_session(session, teaching_class_id, session_id)
    ensure_active(item)
    file = require_selected_file(session, item)
    user_message = TeacherJudgeSessionMessage(
        session_id=item.id,
        role=TeacherJudgeMessageRole.user,
        content=redact_message_content(payload.content.strip()),
        created_by=current_user.id,
    )
    session.add(user_message)
    session.commit()
    session.refresh(user_message)
    try:
        reply, proposal, metrics = await chat_with_rubric(
            bounded_history(session, item.id),
            json.dumps(file.analysis_json, ensure_ascii=False),
            is_refine=False,
            template_key=file.template_key,
            template_commands=get_enabled_template_commands(session, file.template_key),
        )
        assistant = TeacherJudgeSessionMessage(
            session_id=item.id,
            role=TeacherJudgeMessageRole.assistant,
            content=redact_message_content(reply),
            message_type=TeacherJudgeMessageType.rubric_proposal
            if proposal
            else TeacherJudgeMessageType.chat,
            metadata_json={"metrics": metrics, "rubric_proposal": proposal}
            if proposal
            else {"metrics": metrics},
        )
    except HTTPException as exc:
        assistant = TeacherJudgeSessionMessage(
            session_id=item.id,
            role=TeacherJudgeMessageRole.assistant,
            content=f"AI 回覆失敗：{exc.detail}",
            message_type=TeacherJudgeMessageType.system_notice,
            metadata_json={"status": "failed"},
        )
        session.add(assistant)
        session.commit()
        raise
    from app.models.base import get_datetime_utc

    item.last_activity_at = get_datetime_utc()
    item.updated_at = item.last_activity_at
    session.add_all([assistant, item])
    session.commit()
    session.refresh(assistant)
    await maybe_summarize(session, item, file)
    return TeacherJudgeSessionChatResponse(
        user_message=message_public(user_message),
        assistant_message=message_public(assistant),
        rubric_proposal=proposal,
    )


@router.post("/{session_id}/scripts", response_model=TeacherJudgeScriptArtifactPublic)
async def create_session_script(
    teaching_class_id: uuid.UUID,
    session_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeScriptArtifactPublic:
    _access(session, teaching_class_id, current_user)
    item = get_session(session, teaching_class_id, session_id)
    ensure_active(item)
    file = require_selected_file(session, item)
    artifact = await create_artifact(
        session=session,
        teaching_class_id=teaching_class_id,
        name=item.title,
        template_key=file.template_key,
        rubric_analysis=TeacherJudgeRubricAnalysis.model_validate(file.analysis_json),
        created_by=current_user.id,
        source_file_id=file.id,
        session_id=item.id,
    )
    from app.models.base import get_datetime_utc

    item.last_activity_at = get_datetime_utc()
    item.updated_at = item.last_activity_at
    session.add(item)
    session.commit()
    return artifact


@router.get("/{session_id}/runs", response_model=list[TeacherJudgeScriptRunSummary])
def list_session_runs(
    teaching_class_id: uuid.UUID,
    session_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
) -> list[TeacherJudgeScriptRunSummary]:
    _access(session, teaching_class_id, current_user)
    get_session(session, teaching_class_id, session_id)
    rows = session.exec(
        select(TeacherJudgeScriptRun)
        .join(TeacherJudgeScriptArtifact)
        .where(
            TeacherJudgeScriptArtifact.session_id == session_id,
            TeacherJudgeScriptRun.teaching_class_id == teaching_class_id,
        )
        .order_by(desc(TeacherJudgeScriptRun.created_at))
        .offset(skip)
        .limit(limit)
    ).all()
    return [
        TeacherJudgeScriptRunSummary(
            id=str(row.id),
            teaching_class_id=str(row.teaching_class_id),
            artifact_id=str(row.artifact_id),
            status=row.status.value,
            progress_json=row.progress_json,
            result_summary_json=row.result_summary_json,
            started_at=row.started_at.isoformat() if row.started_at else None,
            finished_at=row.finished_at.isoformat() if row.finished_at else None,
            created_at=row.created_at.isoformat(),
            updated_at=row.updated_at.isoformat(),
        )
        for row in rows
    ]


@router.get("/{session_id}/runs/{run_id}", response_model=TeacherJudgeScriptRunPublic)
def get_session_run(
    teaching_class_id: uuid.UUID,
    session_id: uuid.UUID,
    run_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeScriptRunPublic:
    _access(session, teaching_class_id, current_user)
    get_session(session, teaching_class_id, session_id)
    run = session.exec(
        select(TeacherJudgeScriptRun)
        .join(TeacherJudgeScriptArtifact)
        .where(
            TeacherJudgeScriptRun.id == run_id,
            TeacherJudgeScriptRun.teaching_class_id == teaching_class_id,
            TeacherJudgeScriptArtifact.session_id == session_id,
        )
    ).first()
    if not run:
        raise HTTPException(status_code=404, detail="Session run not found")
    return _run_to_public(run)


@router.post(
    "/{session_id}/scripts/{artifact_id}/runs",
    response_model=TeacherJudgeScriptRunPublic,
)
def create_session_run(
    teaching_class_id: uuid.UUID,
    session_id: uuid.UUID,
    artifact_id: uuid.UUID,
    payload: TeacherJudgeScriptRunCreateRequest,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeScriptRunPublic:
    _access(session, teaching_class_id, current_user)
    item = get_session(session, teaching_class_id, session_id)
    ensure_active(item)
    artifact = session.get(TeacherJudgeScriptArtifact, artifact_id)
    if (
        not artifact
        or artifact.teaching_class_id != teaching_class_id
        or artifact.session_id != session_id
    ):
        raise HTTPException(status_code=404, detail="Session script not found")
    run = create_script_run(
        session=session,
        teaching_class_id=teaching_class_id,
        artifact_id=artifact_id,
        target_scope=TeacherJudgeScriptRunTargetScope(payload.target_scope),
        target_vmids=payload.target_vmids,
        started_by=current_user.id,
    )
    from app.models.base import get_datetime_utc

    item.last_activity_at = get_datetime_utc()
    item.updated_at = item.last_activity_at
    session.add(item)
    session.commit()
    submit(
        execute_script_run(uuid.UUID(run.id)),
        name=f"teacher_judge_script_run:{run.id}",
        task_id=f"teacher_judge_script_run:{run.id}",
    )
    return run
