from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlmodel import Session, SQLModel, create_engine

from app import models
from app.services.teaching_class_machine_scope import (
    resolve_teaching_class_machine_targets,
)


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _class_scope(
    session: Session,
    *,
    enrollment_status: str = "active",
    mapping_status: str = "completed",
    resource_owner_matches: bool = True,
) -> tuple[uuid.UUID, int]:
    owner_id = uuid.uuid4()
    student_user_id = uuid.uuid4()
    teaching_class = models.TeachingClass(
        owner_id=owner_id,
        name="Class",
        code="C1",
        term="2026",
        start_date=datetime.now(timezone.utc).date(),
        end_date=datetime.now(timezone.utc).date(),
        weekday=1,
        start_time=datetime.now(timezone.utc).time(),
        end_time=datetime.now(timezone.utc).time(),
    )
    session.add(teaching_class)
    session.flush()
    enrollment = models.TeachingClassStudent(
        class_id=teaching_class.id,
        user_id=student_user_id,
        status=enrollment_status,
    )
    node = models.TeachingClassMachineNode(
        class_id=teaching_class.id,
        node_key="worker",
        name="Worker",
        role="student",
        resource_type="qemu",
        cpu=1,
        memory_mb=512,
        disk_gb=10,
    )
    session.add(enrollment)
    session.add(node)
    session.flush()
    vmid = 101
    session.add(
        models.TeachingClassStudentMachine(
            class_student_id=enrollment.id,
            machine_node_id=node.id,
            vmid=vmid,
            status=mapping_status,
        )
    )
    session.add(
        models.Resource(
            vmid=vmid,
            user_id=student_user_id if resource_owner_matches else uuid.uuid4(),
            environment_type="linux",
            ssh_private_key_encrypted="encrypted",
            created_at=datetime.now(timezone.utc),
        )
    )
    session.commit()
    return teaching_class.id, vmid


def test_machine_scope_returns_only_current_valid_mapping() -> None:
    session = _session()
    class_id, vmid = _class_scope(session)

    targets = resolve_teaching_class_machine_targets(
        session=session,
        class_id=class_id,
    )

    assert [target.vmid for target in targets] == [vmid]
    assert targets[0].has_ssh_key is True


def test_machine_scope_rejects_inactive_unready_and_owner_mismatch() -> None:
    cases = [
        {"enrollment_status": "inactive"},
        {"mapping_status": "failed"},
        {"resource_owner_matches": False},
    ]
    for kwargs in cases:
        session = _session()
        class_id, _ = _class_scope(session, **kwargs)
        assert resolve_teaching_class_machine_targets(
            session=session,
            class_id=class_id,
        ) == []
