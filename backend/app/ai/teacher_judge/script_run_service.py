"""Teacher Judge managed script run service."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, cast

from fastapi import HTTPException
from sqlmodel import Session, col, select

from app.ai.teacher_judge.schemas import TeacherJudgeScriptRunPublic
from app.ai.teacher_judge.script_artifact_service import get_artifact
from app.ai.teacher_judge.target_ip_resolver import resolve_target_ip_address
from app.infrastructure.proxmox import operations as proxmox_ops
from app.models.teacher_judge_script_artifact import TeacherJudgeScriptStatus
from app.models.teacher_judge_script_run import (
    TeacherJudgeScriptRun,
    TeacherJudgeScriptRunStatus,
    TeacherJudgeScriptRunTargetScope,
)
from app.models.teaching_class import (
    TeachingClassStudent,
    TeachingClassStudentMachine,
)
from app.repositories import group as group_repo
from app.repositories import resource as resource_repo

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _run_to_public(run: TeacherJudgeScriptRun) -> TeacherJudgeScriptRunPublic:
    return TeacherJudgeScriptRunPublic(
        id=str(run.id),
        group_id=str(run.group_id) if run.group_id else None,
        class_id=str(run.class_id) if run.class_id else None,
        artifact_id=str(run.artifact_id),
        target_scope=run.target_scope.value,
        target_snapshot_json=run.target_snapshot_json,
        status=run.status.value,
        progress_json=run.progress_json,
        result_summary_json=run.result_summary_json,
        target_results_json=run.target_results_json,
        started_by=str(run.started_by) if run.started_by else None,
        started_at=run.started_at.isoformat() if run.started_at else None,
        finished_at=run.finished_at.isoformat() if run.finished_at else None,
        created_at=run.created_at.isoformat(),
        updated_at=run.updated_at.isoformat(),
    )


def get_script_run_public(
    *,
    session: Session,
    group_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
    artifact_id: uuid.UUID,
    run_id: uuid.UUID,
) -> TeacherJudgeScriptRunPublic:
    run = session.get(TeacherJudgeScriptRun, run_id)
    if (
        run is None
        or run.group_id != group_id
        or run.class_id != class_id
        or run.artifact_id != artifact_id
    ):
        raise HTTPException(status_code=404, detail="Script run not found")
    return _run_to_public(run)


def _group_member_by_vmid(
    *,
    session: Session,
    group_id: uuid.UUID,
) -> dict[int, dict[str, Any]]:
    member_vmids = group_repo.get_member_vmids(session=session, group_id=group_id)
    users = group_repo.get_group_members(session=session, group_id=group_id)
    users_by_id = {user.id: user for user in users}

    result: dict[int, dict[str, Any]] = {}
    for user_id, vmid in member_vmids.items():
        if vmid is None:
            continue
        user = users_by_id.get(user_id)
        if user is None:
            continue
        result[int(vmid)] = {
            "user_id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
        }
    return result


def _running_resources_by_vmid() -> dict[int, dict[str, Any]]:
    try:
        resources = proxmox_ops.list_all_resources()
    except Exception as exc:
        logger.warning("Teacher Judge run target status lookup failed", exc_info=True)
        raise HTTPException(
            status_code=503,
            detail="無法確認 VM/LXC 即時狀態，請稍後再試。",
        ) from exc

    result: dict[int, dict[str, Any]] = {}
    for resource in resources:
        try:
            raw_vmid = resource.get("vmid")
            if raw_vmid is None:
                continue
            vmid = int(raw_vmid)
        except (TypeError, ValueError):
            continue
        result[vmid] = dict(resource)
    return result


def _class_student_by_vmid(
    *,
    session: Session,
    class_id: uuid.UUID,
) -> dict[int, dict[str, Any]]:
    enrollments = session.exec(
        select(TeachingClassStudent).where(
            TeachingClassStudent.class_id == class_id,
            TeachingClassStudent.status == "active",
        )
    ).all()
    enrollment_by_id = {row.id: row for row in enrollments}
    if not enrollment_by_id:
        return {}
    mappings = session.exec(
        select(TeachingClassStudentMachine).where(
            col(TeachingClassStudentMachine.class_student_id).in_(enrollment_by_id),
            col(TeachingClassStudentMachine.vmid).is_not(None),
        )
    ).all()
    result: dict[int, dict[str, Any]] = {}
    for mapping in mappings:
        enrollment = enrollment_by_id.get(mapping.class_student_id)
        if enrollment is None or mapping.vmid is None:
            continue
        result[int(mapping.vmid)] = {
            "user_id": str(enrollment.user_id),
            "mapping_id": str(mapping.id),
            "machine_node_id": str(mapping.machine_node_id),
        }
    return result


def _resolve_running_targets(
    *,
    session: Session,
    group_id: uuid.UUID,
    target_vmids: list[int],
) -> list[dict[str, Any]]:
    member_by_vmid = _group_member_by_vmid(session=session, group_id=group_id)
    live_by_vmid = _running_resources_by_vmid()

    targets: list[dict[str, Any]] = []
    for vmid in target_vmids:
        member = member_by_vmid.get(vmid)
        if member is None:
            raise HTTPException(
                status_code=400,
                detail=f"VMID {vmid} 不屬於此群組或尚未建立可用機器。",
            )

        live = live_by_vmid.get(vmid)
        live_type = str(live.get("type") or "") if live else ""
        live_status = str(live.get("status") or "") if live else ""
        if live is None or live_type not in {"qemu", "lxc"}:
            raise HTTPException(
                status_code=400,
                detail=f"VMID {vmid} 不是可執行的 VM/LXC。",
            )
        if live_status != "running":
            raise HTTPException(
                status_code=400,
                detail=f"VMID {vmid} 目前不是運行中，不能執行腳本。",
            )

        resource = resource_repo.get_resource_by_vmid(session=session, vmid=vmid)
        if resource is None:
            raise HTTPException(
                status_code=400, detail=f"VMID {vmid} 未在資料庫中登記。"
            )
        if str(resource.user_id) != member["user_id"]:
            raise HTTPException(
                status_code=400,
                detail=f"VMID {vmid} 目前資源擁有者與群組成員不一致。",
            )
        ip_address = resolve_target_ip_address(
            session=session,
            vmid=vmid,
            live_resource=live,
        )
        if not ip_address:
            raise HTTPException(status_code=400, detail=f"VMID {vmid} 沒有可用 IP。")
        if not resource.ssh_private_key_encrypted:
            raise HTTPException(
                status_code=400, detail=f"VMID {vmid} 沒有可用 SSH 金鑰。"
            )

        targets.append(
            {
                "vmid": vmid,
                "name": str(vmid),
                "resource_type": live_type,
                "status_at_selection": live_status,
                "proxmox_node": live.get("node"),
                "ip_address": ip_address,
                "ssh_user": "root",
                "has_ssh_key": True,
                "user": {
                    "id": member["user_id"],
                    "email": member["email"],
                    "full_name": member["full_name"],
                },
            }
        )

    return targets


def _resolve_class_running_targets(
    *,
    session: Session,
    class_id: uuid.UUID,
    target_vmids: list[int],
) -> list[dict[str, Any]]:
    student_by_vmid = _class_student_by_vmid(session=session, class_id=class_id)
    live_by_vmid = _running_resources_by_vmid()
    targets: list[dict[str, Any]] = []
    for vmid in target_vmids:
        student = student_by_vmid.get(vmid)
        if student is None:
            raise HTTPException(
                status_code=400,
                detail=f"VMID {vmid} 不屬於此班級的有效學生機器。",
            )
        live = live_by_vmid.get(vmid)
        live_type = str(live.get("type") or "") if live else ""
        if live is None or live_type not in {"qemu", "lxc"}:
            raise HTTPException(status_code=400, detail=f"VMID {vmid} 不是可執行的 VM/LXC。")
        if str(live.get("status") or "") != "running":
            raise HTTPException(status_code=400, detail=f"VMID {vmid} 目前不是運行中。")
        resource = resource_repo.get_resource_by_vmid(session=session, vmid=vmid)
        if resource is None or str(resource.user_id) != student["user_id"]:
            raise HTTPException(
                status_code=400,
                detail=f"VMID {vmid} 資源擁有者與班級學生不一致。",
            )
        ip_address = resolve_target_ip_address(
            session=session, vmid=vmid, live_resource=live
        )
        if not ip_address:
            raise HTTPException(status_code=400, detail=f"VMID {vmid} 沒有可用 IP。")
        if not resource.ssh_private_key_encrypted:
            raise HTTPException(status_code=400, detail=f"VMID {vmid} 沒有可用 SSH 金鑰。")
        targets.append(
            {
                "vmid": vmid,
                "mapping_id": student["mapping_id"],
                "machine_node_id": student["machine_node_id"],
                "name": str(vmid),
                "resource_type": live_type,
                "status_at_selection": "running",
                "proxmox_node": live.get("node"),
                "ip_address": ip_address,
                "ssh_user": "root",
                "has_ssh_key": True,
                "user": {"id": student["user_id"], "email": "", "full_name": None},
            }
        )
    return targets


def create_script_run(
    *,
    session: Session,
    group_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
    artifact_id: uuid.UUID,
    target_scope: TeacherJudgeScriptRunTargetScope,
    target_vmids: list[int],
    started_by: uuid.UUID | None,
) -> TeacherJudgeScriptRunPublic:
    if target_scope != TeacherJudgeScriptRunTargetScope.manual:
        raise HTTPException(status_code=400, detail="第一版只支援手動選擇執行機器。")

    artifact = get_artifact(
        session=session,
        group_id=group_id,
        class_id=class_id,
        artifact_id=artifact_id,
    )
    if artifact.status != TeacherJudgeScriptStatus.approved:
        raise HTTPException(status_code=400, detail="只有已核准的腳本可以執行。")

    if (group_id is None) == (class_id is None):
        raise ValueError("Exactly one Teacher Judge scope is required")
    targets = (
        _resolve_running_targets(
            session=session,
            group_id=group_id,
            target_vmids=target_vmids,
        )
        if group_id is not None
        else _resolve_class_running_targets(
            session=session,
            class_id=cast("uuid.UUID", class_id),
            target_vmids=target_vmids,
        )
    )
    if not targets:
        raise HTTPException(status_code=400, detail="請至少選擇一台運行中的 VM/LXC。")
    if len(targets) > 5:
        raise HTTPException(status_code=400, detail="單次最多只能選擇 5 台 VM/LXC。")

    run = TeacherJudgeScriptRun(
        group_id=group_id,
        class_id=class_id,
        artifact_id=artifact.id,
        target_scope=target_scope,
        target_snapshot_json={
            "script": {
                "id": str(artifact.id),
                "name": artifact.name,
                "version": artifact.version,
                "template_key": artifact.template_key,
            },
            "targets": targets,
        },
        status=TeacherJudgeScriptRunStatus.pending,
        progress_json={
            "stage": "pending_executor",
            "total": len(targets),
            "done": 0,
            "targets": [
                {
                    "vmid": target["vmid"],
                    "name": target["name"],
                    "proxmox_node": target["proxmox_node"],
                    "resource_type": target["resource_type"],
                    "user": target["user"],
                    "status": "queued",
                    "reason_code": None,
                }
                for target in targets
            ],
        },
        result_summary_json={},
        target_results_json={},
        started_by=started_by,
        started_at=None,
        updated_at=_now(),
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return _run_to_public(run)
