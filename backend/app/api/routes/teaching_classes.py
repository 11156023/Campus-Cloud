"""Teacher-facing classes, weekly content and multi-machine orchestration."""

import csv
import io
import uuid
from datetime import date, datetime, time, timedelta
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import delete, select

from app.api.deps import InstructorUser, SessionDep
from app.core.authorizers import require_group_access
from app.exceptions import BadRequestError, NotFoundError
from app.models import (
    BatchProvisionJob,
    BatchProvisionJobStatus,
    BatchProvisionTask,
    BatchProvisionTaskStatus,
    ClassCapacityReservation,
    CourseEnvironment,
    CourseEnvironmentEdge,
    CourseEnvironmentNode,
    CourseEnvironmentVersion,
    CourseEnvironmentVersionStatus,
    TeachingClass,
    TeachingClassMachineNode,
    TeachingClassStatus,
    TeachingClassStudent,
    TeachingClassStudentMachine,
    TeachingClassTaskFile,
    TeachingClassWeek,
    User,
)
from app.models.base import get_datetime_utc
from app.repositories.user import get_user_by_email
from app.schemas.teaching_class_machine import TeachingClassMachineStatusResponse
from app.services.teaching import class_capacity_service, class_network_service
from app.services.teaching_class_access import get_authorized_teaching_class
from app.services.teaching_class_machine_status import (
    get_teaching_class_machine_status,
)
from app.services.vm import batch_provision_service

router = APIRouter(prefix="/teaching-classes", tags=["teaching-classes"])

DAY_CODE = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
TASK_FILE_ROOT = Path(__file__).resolve().parents[3] / "data" / "teaching-class-tasks"
MAX_TASK_FILE_BYTES = 100 * 1024 * 1024


class ClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=80)
    term: str = Field(min_length=1, max_length=80)
    start_date: date
    end_date: date
    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time
    timezone: str = "Asia/Taipei"
    boot_lead_minutes: int = Field(default=10, ge=0, le=120)


class ClassPatch(BaseModel):
    name: str | None = None
    code: str | None = None
    term: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    weekday: int | None = Field(default=None, ge=0, le=6)
    start_time: time | None = None
    end_time: time | None = None
    timezone: str | None = None
    boot_lead_minutes: int | None = Field(default=None, ge=0, le=120)


class StudentAdd(BaseModel):
    emails: list[str]


class MachineNodeIn(BaseModel):
    node_key: str
    source_type: str = "template"
    source_template_id: uuid.UUID | None = None
    custom_image_ref: str | None = None
    custom_storage: str | None = None
    custom_username: str | None = None
    custom_unprivileged: bool = True
    name: str
    role: str
    resource_type: str
    cpu: int
    memory_mb: int
    disk_gb: int
    network: str | None = None


class CourseSelect(BaseModel):
    course_version_id: uuid.UUID


class WeekFileIn(BaseModel):
    filename: str
    storage_key: str | None = None
    target_path: str | None = None


class WeekIn(BaseModel):
    week_number: int
    session_date: date
    title: str = ""
    target_node_key: str | None = None
    status: str = "draft"
    files: list[WeekFileIn] = Field(default_factory=list)


def _get_class(session: SessionDep, current_user, class_id: uuid.UUID) -> TeachingClass:
    return get_authorized_teaching_class(
        session=session,
        current_user=current_user,
        class_id=class_id,
    )


def _students(session: SessionDep, class_id: uuid.UUID) -> list[TeachingClassStudent]:
    return list(
        session.exec(
            select(TeachingClassStudent)
            .where(TeachingClassStudent.class_id == class_id)
            .order_by(TeachingClassStudent.joined_at)
        ).all()
    )


def _serialize(session: SessionDep, item: TeachingClass) -> dict:
    nodes = list(
        session.exec(
            select(TeachingClassMachineNode)
            .where(TeachingClassMachineNode.class_id == item.id)
            .order_by(TeachingClassMachineNode.sort_order)
        ).all()
    )
    weeks = list(
        session.exec(
            select(TeachingClassWeek)
            .where(TeachingClassWeek.class_id == item.id)
            .order_by(TeachingClassWeek.week_number)
        ).all()
    )
    week_rows = []
    for week in weeks:
        files = session.exec(
            select(TeachingClassTaskFile).where(
                TeachingClassTaskFile.week_id == week.id
            )
        ).all()
        week_rows.append(
            {**week.model_dump(), "files": [row.model_dump() for row in files]}
        )

    enrollments = _students(session, item.id)
    enrollment_ids = [row.id for row in enrollments]
    user_ids = [row.user_id for row in enrollments]
    users = (
        {
            row.id: row
            for row in session.exec(select(User).where(User.id.in_(user_ids))).all()
        }
        if user_ids
        else {}
    )
    machine_rows = (
        list(
            session.exec(
                select(TeachingClassStudentMachine).where(
                    TeachingClassStudentMachine.class_student_id.in_(enrollment_ids)
                )
            ).all()
        )
        if enrollment_ids
        else []
    )
    machines_by_student: dict[uuid.UUID, list[dict]] = {}
    for row in machine_rows:
        machines_by_student.setdefault(row.class_student_id, []).append(
            row.model_dump()
        )
    student_rows = []
    for enrollment in enrollments:
        user = users.get(enrollment.user_id)
        student_rows.append(
            {
                **enrollment.model_dump(),
                "email": user.email if user else None,
                "full_name": user.full_name if user else None,
                "machines": machines_by_student.get(enrollment.id, []),
            }
        )

    jobs = [
        session.get(BatchProvisionJob, node.batch_job_id)
        for node in nodes
        if node.batch_job_id
    ]
    ready = sum(
        1 for row in machine_rows if row.status == "completed" and row.vmid is not None
    )
    course_environment = None
    topology_edges = []
    if item.course_version_id:
        version = session.get(CourseEnvironmentVersion, item.course_version_id)
        environment = (
            session.get(CourseEnvironment, version.environment_id) if version else None
        )
        if version and environment:
            topology_edges = [
                row.model_dump()
                for row in session.exec(
                    select(CourseEnvironmentEdge).where(
                        CourseEnvironmentEdge.version_id == version.id
                    )
                ).all()
            ]
            course_environment = {
                "id": environment.id,
                "version_id": version.id,
                "name": environment.name,
                "code": environment.code,
                "version": version.version,
                "status": version.status,
            }
    capacity = class_capacity_service.preview(
        session, nodes=nodes, students=enrollments
    )
    reservation = session.exec(
        select(ClassCapacityReservation).where(
            ClassCapacityReservation.class_id == item.id
        )
    ).first()
    return {
        **item.model_dump(),
        "member_count": len(enrollments),
        "machine_nodes": [row.model_dump() for row in nodes],
        "weeks": week_rows,
        "students": student_rows,
        "ready_machines": ready,
        "total_machines": len(enrollments) * len(nodes),
        "provision_jobs": [
            {
                "id": job.id,
                "status": job.status,
                "total": job.total,
                "done": job.done,
                "failed_count": job.failed_count,
            }
            for job in jobs
            if job
        ],
        "course_environment": course_environment,
        "topology_edges": topology_edges,
        "capacity_preview": capacity,
        "capacity_reservation": reservation.model_dump() if reservation else None,
    }


def _validate_schedule(item) -> None:
    if item.end_date < item.start_date or item.end_time <= item.start_time:
        raise BadRequestError("結束日期與時間必須晚於開始時間")


@router.post("")
def create_class(body: ClassCreate, session: SessionDep, current_user: InstructorUser):
    item = TeachingClass(owner_id=current_user.id, **body.model_dump())
    _validate_schedule(item)
    session.add(item)
    session.commit()
    session.refresh(item)
    _generate_weeks(session, item)
    return _serialize(session, item)


@router.get("")
def list_classes(session: SessionDep, current_user: InstructorUser):
    query = select(TeachingClass).order_by(TeachingClass.updated_at.desc())
    if not current_user.is_superuser and current_user.role != "admin":
        query = query.where(TeachingClass.owner_id == current_user.id)
    return [_serialize(session, row) for row in session.exec(query).all()]


@router.get("/{class_id}")
def get_class(class_id: uuid.UUID, session: SessionDep, current_user: InstructorUser):
    return _serialize(session, _get_class(session, current_user, class_id))


@router.get(
    "/{class_id}/student-machines",
    response_model=TeachingClassMachineStatusResponse,
)
def get_class_student_machines(
    class_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> TeachingClassMachineStatusResponse:
    _get_class(session, current_user, class_id)
    return get_teaching_class_machine_status(session=session, class_id=class_id)


@router.patch("/{class_id}")
def update_class(
    class_id: uuid.UUID,
    body: ClassPatch,
    session: SessionDep,
    current_user: InstructorUser,
):
    item = _get_class(session, current_user, class_id)
    if item.status != TeachingClassStatus.planning:
        raise BadRequestError("已送出建機後不可修改固定課表")
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(item, key, value)
    _validate_schedule(item)
    item.updated_at = get_datetime_utc()
    session.add(item)
    session.commit()
    _generate_weeks(session, item, preserve=True)
    return _serialize(session, item)


@router.post("/{class_id}/students")
def add_students(
    class_id: uuid.UUID,
    body: StudentAdd,
    session: SessionDep,
    current_user: InstructorUser,
):
    item = _get_class(session, current_user, class_id)
    if item.status != TeachingClassStatus.planning:
        raise BadRequestError("已送出建機後不可變更學生名單")
    existing = {row.user_id for row in _students(session, class_id)}
    added, not_found = 0, []
    for raw in body.emails:
        email = raw.strip().lower()
        user = get_user_by_email(session=session, email=email)
        if not user:
            not_found.append(email)
        elif user.id not in existing:
            session.add(TeachingClassStudent(class_id=class_id, user_id=user.id))
            existing.add(user.id)
            added += 1
    session.commit()
    return {"added": added, "not_found": not_found, "class": _serialize(session, item)}


@router.delete("/{class_id}/students/{student_id}")
def remove_student(
    class_id: uuid.UUID,
    student_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
):
    item = _get_class(session, current_user, class_id)
    if item.status != TeachingClassStatus.planning:
        raise BadRequestError("已送出建機後不可變更學生名單")
    row = session.get(TeachingClassStudent, student_id)
    if not row or row.class_id != class_id:
        raise NotFoundError("Class student not found")
    session.delete(row)
    session.commit()
    return _serialize(session, item)


@router.post("/{class_id}/students/import-csv")
async def import_students(
    class_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
    file: UploadFile = File(...),
):
    item = _get_class(session, current_user, class_id)
    if item.status != TeachingClassStatus.planning:
        raise BadRequestError("已送出建機後不可變更學生名單")
    raw = await file.read()
    content = None
    for encoding in ("cp950", "utf-8-sig", "utf-8"):
        try:
            content = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if content is None:
        raise BadRequestError("無法解析 CSV 檔案編碼")
    emails = []
    for index, row in enumerate(csv.reader(io.StringIO(content))):
        if not row:
            continue
        value = row[0].strip()
        if index == 0 and value.lower() in {"email", "學號", "帳號"}:
            continue
        if value:
            emails.append(value if "@" in value else f"{value}@ntub.edu.tw")
    return add_students(class_id, StudentAdd(emails=emails), session, current_user)


def _generate_weeks(session, item: TeachingClass, preserve=False):
    existing = (
        {
            row.session_date: row
            for row in session.exec(
                select(TeachingClassWeek).where(TeachingClassWeek.class_id == item.id)
            ).all()
        }
        if preserve
        else {}
    )
    if not preserve:
        session.exec(
            delete(TeachingClassWeek).where(TeachingClassWeek.class_id == item.id)
        )
    current = item.start_date + timedelta(
        days=(item.weekday - item.start_date.weekday()) % 7
    )
    number, keep = 1, set()
    while current <= item.end_date:
        keep.add(current)
        row = existing.get(current)
        if row:
            row.week_number = number
            session.add(row)
        else:
            session.add(
                TeachingClassWeek(
                    class_id=item.id, week_number=number, session_date=current
                )
            )
        current += timedelta(days=7)
        number += 1
    if preserve:
        for day, row in existing.items():
            if day not in keep:
                session.delete(row)
    session.commit()


@router.post("/{class_id}/generate-weeks")
def generate_weeks(
    class_id: uuid.UUID, session: SessionDep, current_user: InstructorUser
):
    item = _get_class(session, current_user, class_id)
    _generate_weeks(session, item, preserve=True)
    return _serialize(session, item)


@router.put("/{class_id}/machines")
def replace_machines(
    class_id: uuid.UUID,
    body: list[MachineNodeIn],
    session: SessionDep,
    current_user: InstructorUser,
):
    _get_class(session, current_user, class_id)
    raise BadRequestError("請從課程環境發布版本，並在班級管理選擇課程環境")


@router.put("/{class_id}/course")
def select_course(
    class_id: uuid.UUID,
    body: CourseSelect,
    session: SessionDep,
    current_user: InstructorUser,
):
    item = _get_class(session, current_user, class_id)
    if item.status != TeachingClassStatus.planning or item.locked_at is not None:
        raise BadRequestError("班級已鎖定，不能更換課程")
    version = session.get(CourseEnvironmentVersion, body.course_version_id)
    if version is None or version.status != CourseEnvironmentVersionStatus.published:
        raise BadRequestError("只能選擇已發布的課程版本")
    environment = session.get(CourseEnvironment, version.environment_id)
    if environment is None:
        raise NotFoundError("Course environment not found")
    require_group_access(current_user, environment.owner_id)
    source_nodes = list(
        session.exec(
            select(CourseEnvironmentNode)
            .where(CourseEnvironmentNode.version_id == version.id)
            .order_by(CourseEnvironmentNode.sort_order)
        ).all()
    )
    if not source_nodes:
        raise BadRequestError("課程版本沒有可派發的機器")
    session.exec(
        delete(TeachingClassMachineNode).where(
            TeachingClassMachineNode.class_id == class_id
        )
    )
    for node in source_nodes:
        session.add(
            TeachingClassMachineNode(
                class_id=class_id,
                node_key=node.node_key,
                source_type=node.source_type,
                source_template_id=node.source_template_id,
                custom_image_ref=node.custom_image_ref,
                custom_storage=None,
                custom_username=node.custom_username,
                custom_unprivileged=node.custom_unprivileged,
                name=node.name,
                role=node.role,
                resource_type=node.resource_type,
                cpu=node.cpu,
                memory_mb=node.memory_mb,
                disk_gb=node.disk_gb,
                network=node.network,
                sort_order=node.sort_order,
            )
        )
    item.course_version_id = version.id
    item.updated_at = get_datetime_utc()
    session.add(item)
    session.commit()
    return _serialize(session, item)


@router.put("/{class_id}/weeks")
def replace_weeks(
    class_id: uuid.UUID,
    body: list[WeekIn],
    session: SessionDep,
    current_user: InstructorUser,
):
    item = _get_class(session, current_user, class_id)
    if item.status == TeachingClassStatus.archived:
        raise BadRequestError("已結束的班級不可修改每週內容")
    expected = {
        row.session_date
        for row in session.exec(
            select(TeachingClassWeek).where(TeachingClassWeek.class_id == class_id)
        ).all()
    }
    received = {row.session_date for row in body}
    if expected != received:
        raise BadRequestError("週次日期必須由班級固定課表產生，不可手動新增或刪除")
    session.exec(
        delete(TeachingClassWeek).where(TeachingClassWeek.class_id == class_id)
    )
    session.commit()
    for row in body:
        week = TeachingClassWeek(class_id=class_id, **row.model_dump(exclude={"files"}))
        session.add(week)
        session.flush()
        for file in row.files:
            session.add(TeachingClassTaskFile(week_id=week.id, **file.model_dump()))
    session.commit()
    return _serialize(session, item)


@router.post("/{class_id}/weeks/{week_id}/files")
async def upload_week_file(
    class_id: uuid.UUID,
    week_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
    file: UploadFile = File(...),
):
    item = _get_class(session, current_user, class_id)
    if item.status == TeachingClassStatus.archived:
        raise BadRequestError("已結束的班級不可修改每週內容")
    week = session.get(TeachingClassWeek, week_id)
    if not week or week.class_id != class_id:
        raise NotFoundError("找不到指定週次")

    filename = (file.filename or "task-file").replace("\\", "/").split("/")[-1].strip()
    if not filename or filename in {".", ".."}:
        raise BadRequestError("檔案名稱無效")
    if len(filename) > 255:
        raise BadRequestError("Task file name must be 255 characters or fewer")

    file_id = uuid.uuid4()
    storage_key = f"{file_id.hex}.task"
    destination = TASK_FILE_ROOT / storage_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_TASK_FILE_BYTES:
                    raise BadRequestError("任務檔案不可超過 100 MB")
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    session.add(
        TeachingClassTaskFile(
            id=file_id,
            week_id=week_id,
            filename=filename,
            storage_key=storage_key,
        )
    )
    session.commit()
    return _serialize(session, item)


@router.delete("/{class_id}/weeks/{week_id}/files/{file_id}")
def delete_week_file(
    class_id: uuid.UUID,
    week_id: uuid.UUID,
    file_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
):
    item = _get_class(session, current_user, class_id)
    if item.status == TeachingClassStatus.archived:
        raise BadRequestError("已結束的班級不可修改每週內容")
    week = session.get(TeachingClassWeek, week_id)
    task_file = session.get(TeachingClassTaskFile, file_id)
    if (
        not week
        or week.class_id != class_id
        or not task_file
        or task_file.week_id != week_id
    ):
        raise NotFoundError("找不到指定任務檔案")

    storage_key = task_file.storage_key
    session.delete(task_file)
    session.commit()
    if storage_key:
        root = TASK_FILE_ROOT.resolve()
        stored_path = (root / storage_key).resolve()
        if stored_path.is_relative_to(root):
            stored_path.unlink(missing_ok=True)
    return _serialize(session, item)


def _recurrence(item: TeachingClass):
    start = datetime.combine(item.start_date, item.start_time) - timedelta(
        minutes=item.boot_lead_minutes
    )
    duration = (
        int(
            (
                datetime.combine(item.start_date, item.end_time)
                - datetime.combine(item.start_date, item.start_time)
            ).total_seconds()
            / 60
        )
        + item.boot_lead_minutes
        + int(getattr(item, "shutdown_grace_minutes", 0) or 0)
    )
    return (
        f"FREQ=WEEKLY;BYDAY={DAY_CODE[start.weekday()]};BYHOUR={start.hour};BYMINUTE={start.minute}",
        duration,
    )


def _node_source_params(node: TeachingClassMachineNode) -> dict:
    if node.source_type == "template" and node.source_template_id:
        return {"vm_template_id": str(node.source_template_id)}
    if node.resource_type.lower() == "lxc":
        return {
            "ostemplate": node.custom_image_ref,
            "storage": "local-lvm",
            "unprivileged": node.custom_unprivileged,
        }
    return {
        "template_id": int(node.custom_image_ref or "0"),
        "storage": "local-lvm",
        "username": node.custom_username or "student",
    }


def _submit_node_job(
    session: SessionDep,
    *,
    item: TeachingClass,
    node: TeachingClassMachineNode,
    member_user_ids: list[uuid.UUID],
    retry: bool = False,
) -> uuid.UUID:
    rule, duration = _recurrence(item)
    retry_suffix = f"-r{uuid.uuid4().hex[:8]}" if retry else ""
    return batch_provision_service.submit_batch_job_for_users(
        session=session,
        member_user_ids=member_user_ids,
        teaching_class_id=item.id,
        initiated_by_id=item.owner_id,
        resource_type="lxc" if node.resource_type.lower() == "lxc" else "qemu",
        hostname_prefix=(
            f"{item.code.lower().replace('_', '-')[:35]}-"
            f"{node.sort_order + 1}{retry_suffix}"
        ),
        params={
            **_node_source_params(node),
            "cores": node.cpu,
            "memory": node.memory_mb,
            "disk_size": node.disk_gb,
            "rootfs_size": node.disk_gb,
            "environment_type": f"{item.code}-{node.role}",
            "expiry_date": item.end_date.isoformat(),
            "ip_reservation_prefix": f"{item.id}:{node.node_key}",
        },
        recurrence_rule=rule,
        recurrence_duration_minutes=duration,
        schedule_timezone=item.timezone,
        capacity_reserved=True,
    )


@router.get("/{class_id}/capacity-preview")
def capacity_preview(
    class_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
):
    item = _get_class(session, current_user, class_id)
    if item.status != TeachingClassStatus.planning:
        raise BadRequestError("只有準備中的班級可以重新執行容量預檢")
    nodes = list(
        session.exec(
            select(TeachingClassMachineNode)
            .where(TeachingClassMachineNode.class_id == class_id)
            .order_by(TeachingClassMachineNode.sort_order)
        ).all()
    )
    students = _students(session, class_id)
    return class_capacity_service.preview(
        session,
        nodes=nodes,
        students=students,
        check_cluster=True,
    )


@router.post("/{class_id}/provision")
def provision_class(
    class_id: uuid.UUID, session: SessionDep, current_user: InstructorUser
):
    item = _get_class(session, current_user, class_id)
    nodes = list(
        session.exec(
            select(TeachingClassMachineNode)
            .where(TeachingClassMachineNode.class_id == class_id)
            .order_by(TeachingClassMachineNode.sort_order)
        ).all()
    )
    students = _students(session, class_id)
    if not nodes or not students:
        raise BadRequestError("學生名單與課程機器必須完成")
    if item.status != TeachingClassStatus.planning or item.locked_at is not None:
        raise BadRequestError("班級已鎖定或已送出建機")
    if item.course_version_id is None:
        raise BadRequestError("請先選擇已發布的課程版本")
    class_capacity_service.reserve(
        session,
        class_id=item.id,
        course_version_id=item.course_version_id,
        nodes=nodes,
        students=students,
    )
    item.locked_at = get_datetime_utc()
    session.add(item)
    session.commit()
    for node in nodes:
        if node.batch_job_id:
            continue
        node.batch_job_id = _submit_node_job(
            session=session,
            item=item,
            node=node,
            member_user_ids=[row.user_id for row in students],
        )
        session.add(node)
        session.commit()
    item.status = TeachingClassStatus.pending_review
    item.updated_at = get_datetime_utc()
    session.add(item)
    session.commit()
    return _serialize(session, item)


@router.post("/{class_id}/retry-failed")
def retry_failed_class(
    class_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
):
    item = _get_class(session, current_user, class_id)
    if item.status != TeachingClassStatus.partial_failed:
        raise BadRequestError("只有建立失敗的班級可以重試")
    nodes = list(
        session.exec(
            select(TeachingClassMachineNode)
            .where(TeachingClassMachineNode.class_id == class_id)
            .order_by(TeachingClassMachineNode.sort_order)
        ).all()
    )
    submitted = 0
    for node in nodes:
        job = session.get(BatchProvisionJob, node.batch_job_id) if node.batch_job_id else None
        if not job:
            continue
        tasks = list(
            session.exec(
                select(BatchProvisionTask).where(BatchProvisionTask.job_id == job.id)
            ).all()
        )
        retry_user_ids = [
            task.user_id
            for task in tasks
            if task.status != BatchProvisionTaskStatus.completed
            and (
                task.status == BatchProvisionTaskStatus.failed
                or job.status
                in {
                    BatchProvisionJobStatus.failed,
                    BatchProvisionJobStatus.rejected,
                    BatchProvisionJobStatus.cancelled,
                }
            )
        ]
        if not retry_user_ids:
            continue
        node.batch_job_id = _submit_node_job(
            session=session,
            item=item,
            node=node,
            member_user_ids=retry_user_ids,
            retry=True,
        )
        session.add(node)
        session.commit()
        submitted += 1

    if submitted:
        item.status = TeachingClassStatus.pending_review
    else:
        topology_errors = class_network_service.apply_class_topology(
            session, class_id=class_id
        )
        if topology_errors:
            raise BadRequestError("網路拓撲重試失敗：" + "；".join(topology_errors))
        item.status = TeachingClassStatus.active
        reservation = session.exec(
            select(ClassCapacityReservation).where(
                ClassCapacityReservation.class_id == class_id
            )
        ).first()
        if reservation:
            reservation.status = "consumed"
            session.add(reservation)
    item.updated_at = get_datetime_utc()
    session.add(item)
    session.commit()
    return _serialize(session, item)


@router.post("/{class_id}/reset-failed")
def reset_failed_class(
    class_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
):
    item = _get_class(session, current_user, class_id)
    if item.status != TeachingClassStatus.partial_failed:
        raise BadRequestError("只有建立失敗的班級可以返回編輯")
    enrollment_ids = [row.id for row in _students(session, class_id)]
    machine_rows = (
        list(
            session.exec(
                select(TeachingClassStudentMachine).where(
                    TeachingClassStudentMachine.class_student_id.in_(enrollment_ids)
                )
            ).all()
        )
        if enrollment_ids
        else []
    )
    if any(row.vmid is not None for row in machine_rows):
        raise BadRequestError("已有部分機器建立完成，請使用「重試失敗機器」")
    for row in machine_rows:
        session.delete(row)
    nodes = session.exec(
        select(TeachingClassMachineNode).where(
            TeachingClassMachineNode.class_id == class_id
        )
    ).all()
    for node in nodes:
        node.batch_job_id = None
        session.add(node)
    class_capacity_service.release(session, class_id=class_id)
    item.status = TeachingClassStatus.planning
    item.locked_at = None
    item.updated_at = get_datetime_utc()
    session.add(item)
    session.commit()
    return _serialize(session, item)


@router.get("/{class_id}/provision-status")
def provision_status(
    class_id: uuid.UUID, session: SessionDep, current_user: InstructorUser
):
    item = _get_class(session, current_user, class_id)
    nodes = list(
        session.exec(
            select(TeachingClassMachineNode).where(
                TeachingClassMachineNode.class_id == class_id
            )
        ).all()
    )
    students = _students(session, class_id)
    enrollment_by_user = {row.user_id: row for row in students}
    jobs = []
    for node in nodes:
        job = (
            session.get(BatchProvisionJob, node.batch_job_id)
            if node.batch_job_id
            else None
        )
        if not job:
            continue
        jobs.append(job)
        tasks = session.exec(
            select(BatchProvisionTask).where(BatchProvisionTask.job_id == job.id)
        ).all()
        for task in tasks:
            enrollment = enrollment_by_user.get(task.user_id)
            if not enrollment:
                continue
            mapping = session.exec(
                select(TeachingClassStudentMachine).where(
                    TeachingClassStudentMachine.class_student_id == enrollment.id,
                    TeachingClassStudentMachine.machine_node_id == node.id,
                )
            ).first()
            if not mapping:
                mapping = TeachingClassStudentMachine(
                    class_student_id=enrollment.id, machine_node_id=node.id
                )
            mapping.batch_task_id = task.id
            mapping.vmid = task.vmid
            mapping.status = (
                task.status.value if hasattr(task.status, "value") else str(task.status)
            )
            mapping.error = task.error
            session.add(mapping)
    values = [
        job.status.value if hasattr(job.status, "value") else str(job.status)
        for job in jobs
    ]
    any_failed = any(job.failed_count > 0 for job in jobs) or any(
        value in {"failed", "rejected", "cancelled"} for value in values
    )
    all_ready = (
        bool(jobs)
        and len(jobs) == len(nodes)
        and all(
            value == "completed" and job.failed_count == 0 and job.done == job.total
            for value, job in zip(values, jobs, strict=True)
        )
    )
    if all_ready:
        session.flush()
        topology_errors = class_network_service.apply_class_topology(
            session, class_id=class_id
        )
        if topology_errors:
            item.status = TeachingClassStatus.partial_failed
        else:
            item.status = TeachingClassStatus.active
            reservation = session.exec(
                select(ClassCapacityReservation).where(
                    ClassCapacityReservation.class_id == class_id
                )
            ).first()
            if reservation:
                reservation.status = "consumed"
                session.add(reservation)
    elif any_failed:
        item.status = TeachingClassStatus.partial_failed
    elif any(
        value in {"approved", "pending", "running", "completed"} for value in values
    ):
        item.status = TeachingClassStatus.provisioning
    elif values:
        item.status = TeachingClassStatus.pending_review
    item.updated_at = get_datetime_utc()
    session.add(item)
    session.commit()
    return _serialize(session, item)
