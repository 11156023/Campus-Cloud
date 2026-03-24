import logging
from typing import Annotated

from fastapi import Depends

from app.api.deps.auth import CurrentUser
from app.api.deps.database import SessionDep
from app.exceptions import PermissionDeniedError
from app.repositories import resource as resource_repo
from app.services import proxmox_service

logger = logging.getLogger(__name__)


def check_resource_ownership(
    vmid: int,
    current_user: CurrentUser,
    session: SessionDep,
) -> None:
    """
    Check if the current user owns the resource or is a superuser.
    Raises PermissionDeniedError if the user doesn't have permission.
    """
    # Superusers can access all resources
    if current_user.is_superuser:
        return

    # Check if the resource exists in the database
    db_resource = resource_repo.get_resource_by_vmid(session=session, vmid=vmid)

    if not db_resource:
        # Resource not in database - deny access for non-superusers
        logger.warning(
            f"User {current_user.email} attempted to access unregistered resource {vmid}"
        )
        raise PermissionDeniedError(
            "You don't have permission to access this resource"
        )

    # Check if the user owns this resource
    if db_resource.user_id != current_user.id:
        logger.warning(
            f"User {current_user.email} attempted to access resource {vmid} "
            f"owned by user {db_resource.user_id}"
        )
        raise PermissionDeniedError(
            "You don't have permission to access this resource"
        )


def get_vm_info(
    vmid: int,
    current_user: CurrentUser,
    session: SessionDep,
) -> dict:
    """Get VM info with permission check (requires ownership or admin)."""
    check_resource_ownership(vmid, current_user, session)
    return proxmox_service.find_resource(vmid)


VmInfoDep = Annotated[dict, Depends(get_vm_info)]


def get_lxc_info(
    vmid: int,
    current_user: CurrentUser,
    session: SessionDep,
) -> dict:
    """Get LXC info with permission check (requires ownership or admin)."""
    check_resource_ownership(vmid, current_user, session)
    return proxmox_service.find_lxc(vmid)


LxcInfoDep = Annotated[dict, Depends(get_lxc_info)]


def get_resource_info(
    vmid: int,
    current_user: CurrentUser,
    session: SessionDep,
) -> dict:
    """Get resource info with permission check (requires ownership or admin)."""
    check_resource_ownership(vmid, current_user, session)
    return proxmox_service.find_resource(vmid)


ResourceInfoDep = Annotated[dict, Depends(get_resource_info)]


def check_firewall_access(
    vmid: int,
    current_user: CurrentUser,
    session: SessionDep,
) -> None:
    """防火牆權限檢查：允許 superuser、資源擁有者、以及管理該使用者所在群組的老師。"""
    from app.repositories import group as group_repo

    if current_user.is_superuser:
        return

    db_resource = resource_repo.get_resource_by_vmid(session=session, vmid=vmid)
    if not db_resource:
        raise PermissionDeniedError("您沒有此資源的存取權限")

    # 擁有者
    if db_resource.user_id == current_user.id:
        return

    # 老師：檢查資源擁有者是否在其管理的群組中
    if current_user.is_instructor:
        if group_repo.is_user_in_any_owned_group(
            session=session,
            instructor_id=current_user.id,
            member_user_id=db_resource.user_id,
        ):
            return

    raise PermissionDeniedError("您沒有此資源的存取權限")
