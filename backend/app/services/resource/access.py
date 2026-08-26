"""Operation-level access rules for personal and teaching-class resources."""

from typing import Any

from sqlmodel import Session

from app.core.authorizers import (
    can_bypass_resource_ownership,
    require_resource_access,
    require_teaching_access,
)
from app.exceptions import PermissionDeniedError
from app.models import TeachingClass
from app.repositories import resource as resource_repo


def require_resource_management(
    *, session: Session, user: Any, vmid: int
) -> None:
    """Require ownership-level control, not merely class-member use access."""
    if can_bypass_resource_ownership(user):
        return
    resource = resource_repo.get_resource_by_vmid(session=session, vmid=vmid)
    if resource is None:
        raise PermissionDeniedError(
            "You don't have permission to manage this resource"
        )
    if resource.teaching_class_id:
        teaching_class = session.get(TeachingClass, resource.teaching_class_id)
        if teaching_class is None:
            raise PermissionDeniedError(
                "This teaching-class resource is no longer assigned"
            )
        require_teaching_access(
            user,
            teaching_class.owner_id,
            detail="Only the class teacher or an administrator can manage this resource",
        )
        return
    if resource.allocation_scope == "teaching_class":
        raise PermissionDeniedError(
            "This teaching-class resource has lost its class assignment; "
            "an administrator must reclaim it"
        )
    require_resource_access(user, resource.user_id)


__all__ = ["require_resource_management"]
