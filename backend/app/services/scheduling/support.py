from __future__ import annotations

from sqlmodel import Session, select

from app.infrastructure.proxmox import get_proxmox_settings
from app.models import VMProvisioningStatus, VMRequest, VMRequestStatus
from app.repositories import vm_request as vm_request_repo
from app.services.proxmox import proxmox_service
from app.services.scheduling import policy as scheduling_policy


def find_existing_resource_for_request(
    *,
    session: Session,
    request: VMRequest,
) -> dict | None:
    """Find an unclaimed Proxmox guest matching an approved request."""
    expected_type = scheduling_policy.resource_type_for_request(request)
    pool_name = get_proxmox_settings().pool_name
    claimed_vmids = {
        int(item.vmid)
        for item in session.exec(
            select(VMRequest).where(
                VMRequest.status == VMRequestStatus.approved,
                VMRequest.vmid.is_not(None),
                VMRequest.id != request.id,
            )
        ).all()
        if item.vmid is not None
    }
    expected_hostname = str(request.hostname or "")
    for resource in proxmox_service.list_all_resources():
        if str(resource.get("type") or "") != expected_type:
            continue
        if str(resource.get("name") or "") != expected_hostname:
            continue
        vmid = int(resource.get("vmid"))
        if vmid in claimed_vmids:
            continue
        pool = str(resource.get("pool") or "")
        if pool and pool != pool_name:
            continue
        return resource
    return None


def mark_request_runtime_error(
    *,
    session: Session,
    request_id,
    message: str,
) -> None:
    """Persist a provisioning failure while retaining capacity warnings."""
    request = vm_request_repo.get_vm_request_by_id(
        session=session,
        request_id=request_id,
        for_update=True,
    )
    if not request:
        return
    vm_request_repo.update_vm_request_provisioning(
        session=session,
        db_request=request,
        vmid=request.vmid,
        assigned_node=request.assigned_node,
        desired_node=request.desired_node,
        actual_node=request.actual_node,
        placement_strategy_used=request.placement_strategy_used,
        provisioning_status=VMProvisioningStatus.failed,
        provisioning_error=message[:500],
        commit=False,
    )
    if any(
        keyword in message.lower()
        for keyword in ("no feasible", "capacity", "no node", "cannot fit")
    ):
        request.resource_warning = message[:500]
        session.add(request)
    session.commit()


__all__ = ["find_existing_resource_for_request", "mark_request_runtime_error"]
