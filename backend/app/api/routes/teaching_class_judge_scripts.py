"""Teaching-class Teacher Judge managed-script routes."""

import uuid

from fastapi import APIRouter, HTTPException

from app.ai.teacher_judge.schemas import (
    TeacherJudgeScriptArtifactPublic,
    TeacherJudgeScriptCreateRequest,
    TeacherJudgeScriptRegenerateRequest,
    TeacherJudgeScriptRunCreateRequest,
    TeacherJudgeScriptRunPublic,
)
from app.ai.teacher_judge.script_artifact_service import (
    approve_artifact,
    archive_artifact,
    create_artifact,
    delete_artifact,
    get_artifact_public,
    list_artifacts,
    regenerate_artifact,
)
from app.ai.teacher_judge.script_executor_service import execute_script_run
from app.ai.teacher_judge.script_run_service import (
    create_script_run,
    get_script_run_public,
)
from app.ai.teacher_judge.template_command_service import SUPPORTED_TEMPLATE_KEYS
from app.api.deps import InstructorUser, SessionDep
from app.infrastructure.worker import submit
from app.models import TeachingClass
from app.models.teacher_judge_script_run import TeacherJudgeScriptRunTargetScope

router = APIRouter(
    prefix="/teaching-classes/{class_id}/judge/scripts",
    tags=["teaching-class-teacher-judge"],
)


def _ensure_access(
    session: SessionDep, class_id: uuid.UUID, current_user: InstructorUser
) -> None:
    teaching_class = session.get(TeachingClass, class_id)
    if teaching_class is None:
        raise HTTPException(status_code=404, detail="Teaching class not found")
    if (
        teaching_class.owner_id != current_user.id
        and not current_user.is_superuser
        and current_user.role != "admin"
    ):
        raise HTTPException(status_code=403, detail="Not enough permissions")


def _template_key(value: str) -> str:
    normalized = value.strip().lower() or "linux"
    if normalized not in SUPPORTED_TEMPLATE_KEYS:
        raise HTTPException(status_code=400, detail="未知的評分環境 template。")
    return normalized


@router.get("/", response_model=list[TeacherJudgeScriptArtifactPublic])
def list_class_scripts(
    class_id: uuid.UUID, session: SessionDep, current_user: InstructorUser
) -> list[TeacherJudgeScriptArtifactPublic]:
    _ensure_access(session, class_id, current_user)
    return list_artifacts(session=session, class_id=class_id)


@router.post("/", response_model=TeacherJudgeScriptArtifactPublic)
async def create_class_script(
    class_id: uuid.UUID,
    payload: TeacherJudgeScriptCreateRequest,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeScriptArtifactPublic:
    _ensure_access(session, class_id, current_user)
    return await create_artifact(
        session=session,
        class_id=class_id,
        name=payload.name,
        template_key=_template_key(payload.template_key),
        rubric_analysis=payload.rubric_snapshot,
        created_by=current_user.id,
        source_file_id=payload.source_file_id,
    )


@router.get("/{script_id}", response_model=TeacherJudgeScriptArtifactPublic)
def get_class_script(
    class_id: uuid.UUID,
    script_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeScriptArtifactPublic:
    _ensure_access(session, class_id, current_user)
    return get_artifact_public(
        session=session, class_id=class_id, artifact_id=script_id
    )


@router.post("/{script_id}/regenerate", response_model=TeacherJudgeScriptArtifactPublic)
async def regenerate_class_script(
    class_id: uuid.UUID,
    script_id: uuid.UUID,
    payload: TeacherJudgeScriptRegenerateRequest,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeScriptArtifactPublic:
    _ensure_access(session, class_id, current_user)
    return await regenerate_artifact(
        session=session,
        class_id=class_id,
        artifact_id=script_id,
        rubric_analysis=payload.rubric_snapshot,
        created_by=current_user.id,
    )


@router.post("/{script_id}/approve", response_model=TeacherJudgeScriptArtifactPublic)
def approve_class_script(
    class_id: uuid.UUID,
    script_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeScriptArtifactPublic:
    _ensure_access(session, class_id, current_user)
    return approve_artifact(
        session=session,
        class_id=class_id,
        artifact_id=script_id,
        approved_by=current_user.id,
    )


@router.post("/{script_id}/runs", response_model=TeacherJudgeScriptRunPublic)
def create_class_run(
    class_id: uuid.UUID,
    script_id: uuid.UUID,
    payload: TeacherJudgeScriptRunCreateRequest,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeScriptRunPublic:
    _ensure_access(session, class_id, current_user)
    run = create_script_run(
        session=session,
        class_id=class_id,
        artifact_id=script_id,
        target_scope=TeacherJudgeScriptRunTargetScope(payload.target_scope),
        target_vmids=payload.target_vmids,
        started_by=current_user.id,
    )
    submit(
        execute_script_run(uuid.UUID(run.id)),
        name=f"teacher_judge_script_run:{run.id}",
        task_id=f"teacher_judge_script_run:{run.id}",
    )
    return run


@router.get(
    "/{script_id}/runs/{run_id}",
    response_model=TeacherJudgeScriptRunPublic,
)
def get_class_run(
    class_id: uuid.UUID,
    script_id: uuid.UUID,
    run_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeScriptRunPublic:
    _ensure_access(session, class_id, current_user)
    return get_script_run_public(
        session=session,
        class_id=class_id,
        artifact_id=script_id,
        run_id=run_id,
    )


@router.post("/{script_id}/archive", response_model=TeacherJudgeScriptArtifactPublic)
def archive_class_script(
    class_id: uuid.UUID,
    script_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeScriptArtifactPublic:
    _ensure_access(session, class_id, current_user)
    return archive_artifact(
        session=session, class_id=class_id, artifact_id=script_id
    )


@router.delete("/{script_id}", status_code=204)
def delete_class_script(
    class_id: uuid.UUID,
    script_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> None:
    _ensure_access(session, class_id, current_user)
    delete_artifact(session=session, class_id=class_id, artifact_id=script_id)
