from __future__ import annotations

import uuid
from datetime import date, time

from sqlmodel import Session, SQLModel, create_engine

from app import models  # noqa: F401
from app.models.course import CoursePath, CoursePathStatus
from app.models.teacher_judge_script_artifact import (
    TeacherJudgeScriptArtifact,
    TeacherJudgeScriptStatus,
)
from app.models.teaching_class import TeachingClass, TeachingClassStudent
from app.services.course.ai_assignment_service import list_student_ai_assignments


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _artifact(
    *,
    teaching_class_id: uuid.UUID,
    status: TeacherJudgeScriptStatus,
    name: str,
) -> TeacherJudgeScriptArtifact:
    return TeacherJudgeScriptArtifact(
        teaching_class_id=teaching_class_id,
        name=name,
        template_key="linux",
        rubric_snapshot_json={
            "summary": "完成 Linux 權限設定。",
            "items": [
                {
                    "id": "permissions",
                    "title": "設定檔案權限",
                    "description": "讓指定使用者可以讀寫檔案。",
                    "detectable": "auto",
                    "detection_method": "secret command",
                    "check_steps": [{"command_key": "do-not-leak"}],
                }
            ],
        },
        script_content="print('{}')",
        status=status,
    )


def test_student_sees_only_approved_assignments_from_own_teacher_group() -> None:
    session = _session()
    teacher_id = uuid.uuid4()
    other_teacher_id = uuid.uuid4()
    student_id = uuid.uuid4()
    path = CoursePath(
        title="Linux",
        status=CoursePathStatus.published,
        created_by=teacher_id,
    )
    own_class = TeachingClass(
        name="Linux A 班",
        code="linux-a",
        term="2026-1",
        owner_id=teacher_id,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 12, 31),
        weekday=1,
        start_time=time(9),
        end_time=time(11),
    )
    other_class = TeachingClass(
        name="其他老師班級",
        code="other-a",
        term="2026-1",
        owner_id=other_teacher_id,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 12, 31),
        weekday=2,
        start_time=time(9),
        end_time=time(11),
    )
    session.add(path)
    session.add(own_class)
    session.add(other_class)
    session.commit()

    session.add(TeachingClassStudent(class_id=own_class.id, user_id=student_id))
    session.add(TeachingClassStudent(class_id=other_class.id, user_id=student_id))
    session.add(
        _artifact(
            teaching_class_id=own_class.id,
            status=TeacherJudgeScriptStatus.approved,
            name="Linux 權限任務",
        )
    )
    session.add(
        _artifact(
            teaching_class_id=own_class.id,
            status=TeacherJudgeScriptStatus.reviewed,
            name="尚未核准",
        )
    )
    session.add(
        _artifact(
            teaching_class_id=other_class.id,
            status=TeacherJudgeScriptStatus.approved,
            name="其他老師任務",
        )
    )
    session.commit()

    assignments = list_student_ai_assignments(
        session,
        user_id=student_id,
        path_id=path.id,
    )

    assert len(assignments) == 1
    assignment = assignments[0]
    assert assignment.title == "Linux 權限任務"
    assert assignment.teaching_class_name == "Linux A 班"
    assert assignment.items[0].title == "設定檔案權限"
    assert assignment.items[0].detectable == "auto"
    assert not hasattr(assignment.items[0], "detection_method")
    assert not hasattr(assignment.items[0], "check_steps")
