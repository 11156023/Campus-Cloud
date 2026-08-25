"""Access rules shared by teaching-resource dependencies."""

from sqlmodel import Session

from app.core.authorizers import (
    can_bypass_resource_ownership,
    require_resource_access,
    require_teaching_access,
)
from app.exceptions import NotFoundError, PermissionDeniedError
from app.models import Resource, TeachingClass, TeachingClassStatus, User


def require_vm_teaching_access(
    session: Session,
    user: User,
    vmid: int,
) -> Resource:
    resource = session.get(Resource, vmid)
    if resource is None:
        raise NotFoundError(f"Resource {vmid} not found")
    if can_bypass_resource_ownership(user):
        return resource
    if resource.teaching_class_id is None:
        if resource.allocation_scope == "teaching_class":
            raise PermissionDeniedError(
                "This teaching-class resource has lost its class assignment"
            )
        require_resource_access(user, resource.user_id)
        return resource
    teaching_class = session.get(TeachingClass, resource.teaching_class_id)
    if teaching_class is None:
        raise PermissionDeniedError("Teaching class not found for this resource")
    if resource.user_id == user.id:
        if teaching_class.status != TeachingClassStatus.active:
            raise PermissionDeniedError(
                "This teaching-class resource is not available to students"
            )
        return resource
    require_teaching_access(user, teaching_class.owner_id)
    return resource


__all__ = ["require_vm_teaching_access"]
