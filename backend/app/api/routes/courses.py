"""課程學習 API（學生端）。"""

import uuid

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from app.ai.teacher_judge.script_executor_service import execute_script_run
from app.ai.teacher_judge.script_run_service import create_script_run
from app.api.deps import CurrentUser, SessionDep
from app.infrastructure.worker import submit
from app.models.teacher_judge_script_run import TeacherJudgeScriptRunTargetScope
from app.models.teaching_class import (
    TeachingClass,
    TeachingClassMachineNode,
    TeachingClassStudent,
    TeachingClassStudentMachine,
)
from app.schemas.course import (
    CourseAIAssignmentStudent,
    CourseAICheckStudent,
    CourseAnswerResult,
    CourseAnswerSubmit,
    CourseDeploymentPublic,
    CoursePathDetail,
    CoursePathSummary,
    CoursePracticeMachineStudent,
    CourseReminderStudent,
    CourseRoomStudentDetail,
    CourseScheduleStudent,
)
from app.services.course import (
    ai_assignment_service,
    course_service,
    deployment_service,
    progress_service,
    reminder_service,
)
from app.services.course.progress_hub import course_progress_hub

router = APIRouter(prefix="/courses", tags=["courses"])


@router.get("/schedule", response_model=list[CourseScheduleStudent])
def list_schedule(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[CourseScheduleStudent]:
    """Return today's real classes linked to this student's course paths."""

    return course_service.list_student_schedule(
        session,
        user_id=current_user.id,
    )


@router.get("/reminders", response_model=list[CourseReminderStudent])
def list_reminders(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[CourseReminderStudent]:
    """Build the student's actionable reminders from current platform data."""

    return reminder_service.list_student_reminders(
        session,
        user_id=current_user.id,
    )


@router.get("/paths", response_model=list[CoursePathSummary])
def list_paths(
    session: SessionDep, current_user: CurrentUser
) -> list[CoursePathSummary]:
    return course_service.list_published_paths(session, user_id=current_user.id)


@router.get("/paths/{path_id}", response_model=CoursePathDetail)
def get_path(
    session: SessionDep, current_user: CurrentUser, path_id: uuid.UUID
) -> CoursePathDetail:
    return course_service.get_path_detail(
        session, user_id=current_user.id, path_id=path_id
    )


@router.get(
    "/paths/{path_id}/ai-assignments",
    response_model=list[CourseAIAssignmentStudent],
)
def list_ai_assignments(
    session: SessionDep, current_user: CurrentUser, path_id: uuid.UUID
) -> list[CourseAIAssignmentStudent]:
    return ai_assignment_service.list_student_ai_assignments(
        session,
        user_id=current_user.id,
        path_id=path_id,
    )


@router.get(
    "/paths/{path_id}/practice-machines",
    response_model=list[CoursePracticeMachineStudent],
)
def list_practice_machines(
    session: SessionDep,
    current_user: CurrentUser,
    path_id: uuid.UUID,
) -> list[CoursePracticeMachineStudent]:
    """List machines assigned in the exact class linked to this path."""

    teaching_class = course_service.get_student_class_for_path(
        session,
        user_id=current_user.id,
        path_id=path_id,
    )
    if teaching_class is None:
        return []
    rows = session.exec(
        select(
            TeachingClass,
            TeachingClassStudentMachine,
            TeachingClassMachineNode,
        )
        .join(
            TeachingClassStudent,
            TeachingClassStudent.class_id == TeachingClass.id,
        )
        .join(
            TeachingClassStudentMachine,
            TeachingClassStudentMachine.class_student_id == TeachingClassStudent.id,
        )
        .join(
            TeachingClassMachineNode,
            TeachingClassStudentMachine.machine_node_id == TeachingClassMachineNode.id,
        )
        .where(
            TeachingClass.id == teaching_class.id,
            TeachingClassStudent.user_id == current_user.id,
            TeachingClassStudent.status == "active",
        )
        .order_by(TeachingClass.name, TeachingClassMachineNode.sort_order)
    ).all()
    return [
        CoursePracticeMachineStudent(
            teaching_class_id=teaching_class.id,
            teaching_class_name=teaching_class.name,
            machine_node_id=node.id,
            node_key=node.node_key,
            name=node.name,
            role=node.role,
            resource_type=node.resource_type,
            vmid=machine.vmid,
            status=machine.status,
        )
        for teaching_class, machine, node in rows
    ]


@router.post(
    "/paths/{path_id}/ai-assignments/{assignment_id}/checks",
    response_model=CourseAICheckStudent,
)
def start_ai_check(
    session: SessionDep,
    current_user: CurrentUser,
    path_id: uuid.UUID,
    assignment_id: uuid.UUID,
) -> CourseAICheckStudent:
    """Run one approved assignment against the current student's own machine."""

    assignment = ai_assignment_service.get_student_ai_assignment(
        session,
        user_id=current_user.id,
        path_id=path_id,
        assignment_id=assignment_id,
    )
    if assignment.latest_check and assignment.latest_check.status in {
        "pending",
        "running",
    }:
        return assignment.latest_check

    enrollment = session.exec(
        select(TeachingClassStudent).where(
            TeachingClassStudent.class_id == assignment.teaching_class_id,
            TeachingClassStudent.user_id == current_user.id,
            TeachingClassStudent.status == "active",
        )
    ).first()
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Class enrollment not found")

    candidates = list(
        session.exec(
            select(TeachingClassStudentMachine, TeachingClassMachineNode)
            .join(
                TeachingClassMachineNode,
                TeachingClassStudentMachine.machine_node_id
                == TeachingClassMachineNode.id,
            )
            .where(
                TeachingClassStudentMachine.class_student_id == enrollment.id,
                TeachingClassStudentMachine.vmid.is_not(None),
            )
        ).all()
    )
    if not candidates:
        raise HTTPException(
            status_code=400,
            detail="你的課堂機器尚未建立完成，請先確認環境已就緒。",
        )

    template_key = assignment.template_key.strip().lower()

    def candidate_rank(candidate) -> tuple[int, int]:
        _, node = candidate
        searchable = f"{node.node_key} {node.name} {node.role}".lower()
        return (0 if template_key and template_key in searchable else 1, node.sort_order)

    machine, _ = sorted(candidates, key=candidate_rank)[0]
    run = create_script_run(
        session=session,
        teaching_class_id=assignment.teaching_class_id,
        artifact_id=assignment.id,
        target_scope=TeacherJudgeScriptRunTargetScope.manual,
        target_vmids=[int(machine.vmid)],
        started_by=current_user.id,
    )
    run_id = uuid.UUID(run.id)
    submit(
        execute_script_run(run_id),
        name=f"student_ai_check:{run.id}",
        task_id=f"teacher_judge_script_run:{run.id}",
    )
    return ai_assignment_service.get_student_ai_check(
        session,
        user_id=current_user.id,
        path_id=path_id,
        assignment_id=assignment_id,
        run_id=run_id,
    )


@router.get(
    "/paths/{path_id}/ai-assignments/{assignment_id}/checks/{run_id}",
    response_model=CourseAICheckStudent,
)
def get_ai_check(
    session: SessionDep,
    current_user: CurrentUser,
    path_id: uuid.UUID,
    assignment_id: uuid.UUID,
    run_id: uuid.UUID,
) -> CourseAICheckStudent:
    return ai_assignment_service.get_student_ai_check(
        session,
        user_id=current_user.id,
        path_id=path_id,
        assignment_id=assignment_id,
        run_id=run_id,
    )


@router.get("/rooms/{room_id}", response_model=CourseRoomStudentDetail)
def get_room(
    session: SessionDep, current_user: CurrentUser, room_id: uuid.UUID
) -> CourseRoomStudentDetail:
    detail = course_service.get_room_student_detail(
        session, user_id=current_user.id, room_id=room_id
    )
    detail.my_deployment = deployment_service.get_my_room_deployment(
        session, user_id=current_user.id, room_id=room_id
    )
    return detail


@router.post(
    "/rooms/{room_id}/deploy",
    response_model=CourseDeploymentPublic,
    status_code=202,
)
def deploy_room(
    session: SessionDep, current_user: CurrentUser, room_id: uuid.UUID
) -> CourseDeploymentPublic:
    return deployment_service.deploy(session, user=current_user, room_id=room_id)


@router.get(
    "/deployments/{deployment_id}", response_model=CourseDeploymentPublic
)
def get_deployment(
    session: SessionDep, current_user: CurrentUser, deployment_id: uuid.UUID
) -> CourseDeploymentPublic:
    return deployment_service.get_deployment(
        session, user=current_user, deployment_id=deployment_id
    )


@router.delete(
    "/deployments/{deployment_id}", response_model=CourseDeploymentPublic
)
def terminate_deployment(
    session: SessionDep, current_user: CurrentUser, deployment_id: uuid.UUID
) -> CourseDeploymentPublic:
    return deployment_service.terminate(
        session, user=current_user, deployment_id=deployment_id
    )


@router.post(
    "/questions/{question_id}/submit", response_model=CourseAnswerResult
)
async def submit_answer(
    session: SessionDep,
    current_user: CurrentUser,
    question_id: uuid.UUID,
    data: CourseAnswerSubmit,
) -> CourseAnswerResult:
    result, path_id, event = progress_service.submit_answer(
        session,
        user=current_user,
        question_id=question_id,
        answer=data.answer,
    )
    if event is not None and path_id is not None:
        await course_progress_hub.broadcast(path_id, event)
    return result
