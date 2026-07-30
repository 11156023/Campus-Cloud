"""Resolve the current valid machine scope for a teaching class."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlmodel import Session, col, select

from app.models import Resource
from app.models.teaching_class import (
    TeachingClassMachineNode,
    TeachingClassStudent,
    TeachingClassStudentMachine,
)

READY_PROVISION_STATUSES = {"completed", "ready"}


@dataclass(frozen=True)
class TeachingClassMachineTarget:
    mapping_id: uuid.UUID
    class_student_id: uuid.UUID
    machine_node_id: uuid.UUID
    user_id: uuid.UUID
    vmid: int
    resource_type: str
    provision_status: str
    has_ssh_key: bool


def resolve_teaching_class_machine_targets(
    *,
    session: Session,
    class_id: uuid.UUID,
) -> list[TeachingClassMachineTarget]:
    """Return active, provisioned mappings whose DB resource owner is still valid."""
    enrollments = session.exec(
        select(TeachingClassStudent).where(
            TeachingClassStudent.class_id == class_id,
            TeachingClassStudent.status == "active",
        )
    ).all()
    enrollment_by_id = {row.id: row for row in enrollments}
    if not enrollment_by_id:
        return []

    nodes = session.exec(
        select(TeachingClassMachineNode).where(
            TeachingClassMachineNode.class_id == class_id
        )
    ).all()
    nodes_by_id = {row.id: row for row in nodes}
    mappings = session.exec(
        select(TeachingClassStudentMachine).where(
            col(TeachingClassStudentMachine.class_student_id).in_(
                enrollment_by_id
            ),
            col(TeachingClassStudentMachine.vmid).is_not(None),
        )
    ).all()
    vmids = {
        int(mapping.vmid)
        for mapping in mappings
        if mapping.vmid is not None
        and mapping.status in READY_PROVISION_STATUSES
        and mapping.machine_node_id in nodes_by_id
    }
    resources = (
        session.exec(select(Resource).where(col(Resource.vmid).in_(vmids))).all()
        if vmids
        else []
    )
    resources_by_vmid = {resource.vmid: resource for resource in resources}

    targets: list[TeachingClassMachineTarget] = []
    seen_vmids: set[int] = set()
    duplicate_vmids: set[int] = set()
    for mapping in mappings:
        if (
            mapping.vmid is None
            or mapping.status not in READY_PROVISION_STATUSES
            or mapping.machine_node_id not in nodes_by_id
        ):
            continue
        enrollment = enrollment_by_id.get(mapping.class_student_id)
        resource = resources_by_vmid.get(int(mapping.vmid))
        if enrollment is None or resource is None or resource.user_id != enrollment.user_id:
            continue
        vmid = int(mapping.vmid)
        if vmid in seen_vmids:
            duplicate_vmids.add(vmid)
            continue
        seen_vmids.add(vmid)
        node = nodes_by_id[mapping.machine_node_id]
        targets.append(
            TeachingClassMachineTarget(
                mapping_id=mapping.id,
                class_student_id=enrollment.id,
                machine_node_id=node.id,
                user_id=enrollment.user_id,
                vmid=vmid,
                resource_type=node.resource_type,
                provision_status=mapping.status,
                has_ssh_key=bool(resource.ssh_private_key_encrypted),
            )
        )

    if duplicate_vmids:
        targets = [target for target in targets if target.vmid not in duplicate_vmids]
    return targets
