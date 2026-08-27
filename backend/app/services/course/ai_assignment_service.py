"""Student-safe projection of approved Teacher Judge assignments.

Teacher Judge artifacts and Course Lab paths are both linked to one teaching class.
A student can only see approved artifacts from the exact class linked to the path.

Only the rubric requirements are exposed.  Generated scripts, command keys,
detection methods, fallbacks, policy reviews, and other students' results stay
server-side.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, desc, select

from app.models.teacher_judge_script_artifact import (
    TeacherJudgeScriptArtifact,
    TeacherJudgeScriptStatus,
)
from app.models.teacher_judge_script_run import TeacherJudgeScriptRun
from app.models.teaching_class import TeachingClass, TeachingClassStudent
from app.schemas.course import (
    CourseAIAssignmentStudent,
    CourseAICheckItemStudent,
    CourseAICheckStudent,
    CourseAITaskItemStudent,
)
from app.services.course import course_service

_DETECTABLE_VALUES = {"auto", "partial", "manual"}


def _check_to_student(run: TeacherJudgeScriptRun) -> CourseAICheckStudent:
    """Project one run down to the feedback that belongs on a student page."""

    raw_targets = run.target_results_json.get("targets")
    target = raw_targets[0] if isinstance(raw_targets, list) and raw_targets else {}
    judgement = target.get("ai_judgement") if isinstance(target, dict) else {}
    if not isinstance(judgement, dict):
        judgement = {}
    raw_items = judgement.get("item_judgements")
    items = []
    if isinstance(raw_items, list):
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            items.append(
                CourseAICheckItemStudent(
                    item_id=str(raw.get("item_id") or ""),
                    title=str(raw.get("title") or ""),
                    status=str(raw.get("status") or "unknown"),
                    score=raw.get("score") if isinstance(raw.get("score"), int) else None,
                    max_score=(
                        raw.get("max_score")
                        if isinstance(raw.get("max_score"), int)
                        else None
                    ),
                    comment=str(raw.get("comment") or ""),
                )
            )

    target_error = target.get("error") if isinstance(target, dict) else ""
    return CourseAICheckStudent(
        run_id=run.id,
        status=run.status.value,
        submitted_at=run.created_at,
        finished_at=run.finished_at,
        score=(
            judgement.get("score")
            if isinstance(judgement.get("score"), int)
            else None
        ),
        max_score=(
            judgement.get("max_score")
            if isinstance(judgement.get("max_score"), int)
            else None
        ),
        summary=str(judgement.get("summary") or ""),
        error=str(judgement.get("error") or target_error or ""),
        items=items,
    )


def _latest_student_check(
    session: Session,
    *,
    artifact_id: uuid.UUID,
    user_id: uuid.UUID,
) -> CourseAICheckStudent | None:
    run = session.exec(
        select(TeacherJudgeScriptRun)
        .where(
            TeacherJudgeScriptRun.artifact_id == artifact_id,
            TeacherJudgeScriptRun.started_by == user_id,
        )
        .order_by(desc(TeacherJudgeScriptRun.created_at))
    ).first()
    return _check_to_student(run) if run else None


def _student_items(snapshot: dict[str, Any]) -> list[CourseAITaskItemStudent]:
    raw_items = snapshot.get("items")
    if not isinstance(raw_items, list):
        return []

    items: list[CourseAITaskItemStudent] = []
    for index, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "").strip()
        if not title:
            continue
        detectable = str(raw.get("detectable") or "manual").strip().lower()
        if detectable not in _DETECTABLE_VALUES:
            detectable = "manual"
        items.append(
            CourseAITaskItemStudent(
                id=str(raw.get("id") or f"item-{index + 1}"),
                title=title,
                description=str(raw.get("description") or "").strip(),
                detectable=detectable,  # type: ignore[arg-type]
                order=index,
            )
        )
    return items


def list_student_ai_assignments(
    session: Session,
    *,
    user_id: uuid.UUID,
    path_id: uuid.UUID,
) -> list[CourseAIAssignmentStudent]:
    """Return approved AI assignments visible to one student for a path."""

    teaching_class = course_service.get_student_class_for_path(
        session,
        user_id=user_id,
        path_id=path_id,
    )
    if teaching_class is None:
        return []

    rows = session.exec(
        select(TeacherJudgeScriptArtifact, TeachingClass)
        .join(
            TeachingClass,
            TeacherJudgeScriptArtifact.teaching_class_id == TeachingClass.id,
        )
        .join(
            TeachingClassStudent,
            TeachingClassStudent.class_id == TeachingClass.id,
        )
        .where(
            TeachingClass.id == teaching_class.id,
            TeachingClassStudent.user_id == user_id,
            TeachingClassStudent.status == "active",
            TeacherJudgeScriptArtifact.status == TeacherJudgeScriptStatus.approved,
        )
        .order_by(
            desc(TeacherJudgeScriptArtifact.approved_at),
            desc(TeacherJudgeScriptArtifact.updated_at),
        )
    ).all()

    assignments: list[CourseAIAssignmentStudent] = []
    seen_sources: set[tuple[uuid.UUID, str]] = set()
    for artifact, teaching_class in rows:
        # Regeneration creates a new version.  Show only the newest approved
        # version for the same source rubric (or name when no source exists).
        source_key = str(artifact.source_file_id or artifact.name)
        dedupe_key = (teaching_class.id, source_key)
        if dedupe_key in seen_sources:
            continue
        seen_sources.add(dedupe_key)

        snapshot = artifact.rubric_snapshot_json or {}
        items = _student_items(snapshot)
        if not items:
            continue
        assignments.append(
            CourseAIAssignmentStudent(
                id=artifact.id,
                teaching_class_id=teaching_class.id,
                teaching_class_name=teaching_class.name,
                title=artifact.name,
                summary=str(snapshot.get("summary") or "").strip(),
                template_key=artifact.template_key,
                version=artifact.version,
                approved_at=artifact.approved_at,
                items=items,
                latest_check=_latest_student_check(
                    session,
                    artifact_id=artifact.id,
                    user_id=user_id,
                ),
            )
        )
    return assignments


def get_student_ai_assignment(
    session: Session,
    *,
    user_id: uuid.UUID,
    path_id: uuid.UUID,
    assignment_id: uuid.UUID,
) -> CourseAIAssignmentStudent:
    """Return one visible assignment or hide it behind a 404."""

    from fastapi import HTTPException

    assignment = next(
        (
            item
            for item in list_student_ai_assignments(
                session,
                user_id=user_id,
                path_id=path_id,
            )
            if item.id == assignment_id
        ),
        None,
    )
    if assignment is None:
        raise HTTPException(status_code=404, detail="AI assignment not found")
    return assignment


def get_student_ai_check(
    session: Session,
    *,
    user_id: uuid.UUID,
    path_id: uuid.UUID,
    assignment_id: uuid.UUID,
    run_id: uuid.UUID,
) -> CourseAICheckStudent:
    """Return only the current student's own run for a visible assignment."""

    from fastapi import HTTPException

    assignment = get_student_ai_assignment(
        session,
        user_id=user_id,
        path_id=path_id,
        assignment_id=assignment_id,
    )
    run = session.get(TeacherJudgeScriptRun, run_id)
    if (
        run is None
        or run.artifact_id != assignment.id
        or run.teaching_class_id != assignment.teaching_class_id
        or run.started_by != user_id
    ):
        raise HTTPException(status_code=404, detail="AI check not found")
    return _check_to_student(run)


__all__ = [
    "get_student_ai_assignment",
    "get_student_ai_check",
    "list_student_ai_assignments",
]
