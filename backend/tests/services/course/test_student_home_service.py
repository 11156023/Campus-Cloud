from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time, timedelta

from sqlmodel import Session, SQLModel, create_engine

from app import models  # noqa: F401
from app.models import (
    CoursePath,
    CoursePathStatus,
    Resource,
    TeachingClass,
    TeachingClassStatus,
    TeachingClassStudent,
    TeachingClassWeek,
    User,
    UserRole,
    VMRequest,
    VMRequestStatus,
)
from app.services.course.course_service import list_student_schedule
from app.services.course.reminder_service import list_student_reminders


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _user(email: str, role: UserRole) -> User:
    return User(
        email=email,
        role=role,
        full_name="陳老師" if role == UserRole.teacher else "王同學",
        hashed_password="test",
    )


def _linked_class(
    session: Session,
    *,
    teacher: User,
    student: User,
    session_date: date,
) -> tuple[TeachingClass, CoursePath]:
    teaching_class = TeachingClass(
        name="Linux 系統管理實務",
        code="linux-a",
        term="2026-1",
        location="電腦教室 A",
        owner_id=teacher.id,
        start_date=session_date - timedelta(days=7),
        end_date=session_date + timedelta(days=30),
        weekday=session_date.weekday(),
        start_time=time(9),
        end_time=time(11),
        status=TeachingClassStatus.active,
    )
    path = CoursePath(
        title="Linux 系統管理實務",
        description="練習 Linux 權限與常用指令。",
        created_by=teacher.id,
        teaching_class_id=teaching_class.id,
        status=CoursePathStatus.published,
    )
    session.add(teacher)
    session.add(student)
    session.add(teaching_class)
    session.add(path)
    session.commit()
    session.add(TeachingClassStudent(class_id=teaching_class.id, user_id=student.id))
    session.commit()
    return teaching_class, path


def test_schedule_uses_real_class_time_teacher_and_location() -> None:
    session = _session()
    teacher = _user("teacher@example.edu", UserRole.teacher)
    student = _user("student@example.edu", UserRole.student)
    local_date = date(2026, 8, 25)
    _, path = _linked_class(
        session,
        teacher=teacher,
        student=student,
        session_date=local_date,
    )

    rows = list_student_schedule(
        session,
        user_id=student.id,
        now=datetime(2026, 8, 25, 1, 30, tzinfo=UTC),
    )

    assert len(rows) == 1
    assert rows[0].id == path.id
    assert rows[0].state == "now"
    assert rows[0].teacher == "陳老師"
    assert rows[0].location == "電腦教室 A"
    assert rows[0].start_at.hour == 9


def test_reminders_derive_expiry_review_and_class_task() -> None:
    session = _session()
    teacher = _user("teacher@example.edu", UserRole.teacher)
    student = _user("student@example.edu", UserRole.student)
    today = date(2026, 8, 25)
    teaching_class, _ = _linked_class(
        session,
        teacher=teacher,
        student=student,
        session_date=today,
    )
    reviewed_at = datetime(2026, 8, 25, 0, 30, tzinfo=UTC)
    request = VMRequest(
        user_id=student.id,
        reason="研究",
        resource_type="lxc",
        hostname="student-lab",
        password="test-password",
        status=VMRequestStatus.approved,
        reviewed_at=reviewed_at,
        created_at=reviewed_at - timedelta(days=1),
    )
    session.add(request)
    session.commit()
    session.add(
        Resource(
            vmid=201,
            request_id=request.id,
            user_id=student.id,
            environment_type="LXC",
            expiry_date=today + timedelta(days=2),
            created_at=reviewed_at,
        )
    )
    session.add(
        TeachingClassWeek(
            class_id=teaching_class.id,
            week_number=1,
            session_date=today,
            title="完成檔案權限 Checkpoint",
        )
    )
    session.commit()

    rows = list_student_reminders(
        session,
        user_id=student.id,
        now=datetime(2026, 8, 25, 1, 0, tzinfo=UTC),
    )

    assert {row.kind for row in rows} == {
        "resource_expiry",
        "request_review",
        "class_task",
    }
    assert next(row for row in rows if row.kind == "resource_expiry").target == "/my-resources"
    assert next(row for row in rows if row.kind == "request_review").tone == "success"
    assert "Checkpoint" in next(row for row in rows if row.kind == "class_task").title
