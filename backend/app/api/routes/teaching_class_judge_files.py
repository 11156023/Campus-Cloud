"""Teaching-class Teacher Judge rubric routes."""

import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.ai.monitoring import CALL_TJ_RUBRIC, record_ai_template_call
from app.ai.teacher_judge.config import settings
from app.ai.teacher_judge.file_service import (
    delete_file,
    get_file_download,
    list_files,
    parse_conflict_strategy,
    prepare_file_payload,
    raise_if_file_name_conflict,
    save_analyzed_file,
    update_file_analysis,
)
from app.ai.teacher_judge.schemas import (
    TeacherJudgeFileAnalysisUpdateRequest,
    TeacherJudgeFilePublic,
    TeacherJudgeFileUploadResponse,
)
from app.ai.teacher_judge.service import analyze_rubric
from app.ai.teacher_judge.template_command_service import (
    SUPPORTED_TEMPLATE_KEYS,
    get_enabled_template_commands,
)
from app.api.deps import InstructorUser, SessionDep
from app.services.teaching_class_access import get_authorized_teaching_class

router = APIRouter(
    prefix="/teaching-classes/{class_id}/judge/files",
    tags=["teaching-class-teacher-judge"],
)


def _ensure_access(
    session: SessionDep, class_id: uuid.UUID, current_user: InstructorUser
) -> None:
    get_authorized_teaching_class(
        session=session,
        current_user=current_user,
        class_id=class_id,
    )


def _template_key(value: str) -> str:
    normalized = value.strip().lower() or "linux"
    if normalized not in SUPPORTED_TEMPLATE_KEYS:
        raise HTTPException(status_code=400, detail="未知的評分環境 template。")
    return normalized


@router.get("/", response_model=list[TeacherJudgeFilePublic])
def list_class_files(
    class_id: uuid.UUID, session: SessionDep, current_user: InstructorUser
) -> list[TeacherJudgeFilePublic]:
    _ensure_access(session, class_id, current_user)
    return list_files(session=session, class_id=class_id)


@router.post("/", response_model=TeacherJudgeFileUploadResponse)
async def upload_class_file(
    class_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
    file: UploadFile = File(...),
    template_key: str = Form(default="linux"),
    conflict_strategy: str | None = Form(default=None),
) -> TeacherJudgeFileUploadResponse:
    _ensure_access(session, class_id, current_user)
    template_key = _template_key(template_key)
    conflict_strategy = parse_conflict_strategy(conflict_strategy)
    file_bytes = await file.read()
    try:
        original_filename, file_hash, raw_text = prepare_file_payload(
            filename=file.filename or "unknown",
            file_bytes=file_bytes,
            allowed_suffixes={".docx", ".pdf"},
            max_upload_size_bytes=settings.VLLM_MAX_UPLOAD_SIZE_MB * 1024 * 1024,
        )
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    raise_if_file_name_conflict(
        session=session,
        class_id=class_id,
        original_filename=original_filename,
        conflict_strategy=conflict_strategy,
    )
    try:
        analysis, metrics = await analyze_rubric(
            raw_text,
            template_key=template_key,
            template_commands=get_enabled_template_commands(session, template_key),
        )
    except HTTPException as exc:
        record_ai_template_call(
            session=session,
            user_id=current_user.id,
            call_type=CALL_TJ_RUBRIC,
            model_name=settings.VLLM_MODEL_NAME,
            preset=template_key,
            status="error",
            error_message=str(exc.detail),
        )
        raise
    saved = save_analyzed_file(
        session=session,
        class_id=class_id,
        uploaded_by=current_user.id,
        original_filename=original_filename,
        file_hash=file_hash,
        template_key=template_key,
        file_bytes=file_bytes,
        analysis=analysis,
        conflict_strategy=conflict_strategy,
    )
    record_ai_template_call(
        session=session,
        user_id=current_user.id,
        call_type=CALL_TJ_RUBRIC,
        model_name=settings.VLLM_MODEL_NAME,
        preset=template_key,
        metrics=metrics,
    )
    return TeacherJudgeFileUploadResponse(
        file=saved,
        analysis=analysis,
        ai_metrics=dict(metrics),
        template_key=template_key,
    )


@router.get("/{file_id}/download")
def download_class_file(
    class_id: uuid.UUID,
    file_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> FileResponse:
    _ensure_access(session, class_id, current_user)
    path, filename = get_file_download(
        session=session, class_id=class_id, file_id=file_id
    )
    return FileResponse(path, filename=filename)


@router.patch("/{file_id}/analysis", response_model=TeacherJudgeFilePublic)
def update_class_file(
    class_id: uuid.UUID,
    file_id: uuid.UUID,
    payload: TeacherJudgeFileAnalysisUpdateRequest,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeacherJudgeFilePublic:
    _ensure_access(session, class_id, current_user)
    return update_file_analysis(
        session=session, class_id=class_id, file_id=file_id, analysis=payload.analysis
    )


@router.delete("/{file_id}", status_code=204)
def delete_class_file(
    class_id: uuid.UUID,
    file_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> None:
    _ensure_access(session, class_id, current_user)
    delete_file(session=session, class_id=class_id, file_id=file_id)
