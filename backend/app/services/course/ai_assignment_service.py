"""Student-safe projection of approved Teacher Judge assignments.

Teacher Judge artifacts are teaching-class-scoped while Course Lab paths are
owned by an instructor. Until the data model gains an explicit path-to-class link, a
student can see approved artifacts from teaching classes that both:

1. are owned by the instructor who created the published path; and
2. contain the current student as a member.

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
from app.models.teaching_class import TeachingClass, TeachingClassStudent
from app.schemas.course import (
    CourseAIAssignmentStudent,
    CourseAITaskItemStudent,
)
from app.services.course import course_service

_DETECTABLE_VALUES = {"auto", "partial", "manual"}


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

    path = course_service.get_published_path_or_404(session, path_id)
    if path.created_by is None:
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
            TeachingClass.owner_id == path.created_by,
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
            )
        )
    return assignments


__all__ = ["list_student_ai_assignments"]
