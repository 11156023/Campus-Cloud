"""Shared teaching-class authorization boundary."""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session

from app.core.authorizers import require_group_access
from app.exceptions import NotFoundError
from app.models import TeachingClass


def get_authorized_teaching_class(
    *,
    session: Session,
    current_user: Any,
    class_id: uuid.UUID,
) -> TeachingClass:
    teaching_class = session.get(TeachingClass, class_id)
    if teaching_class is None:
        raise NotFoundError("Teaching class not found")
    require_group_access(
        current_user,
        teaching_class.owner_id,
        detail="Not authorized to access this teaching class",
    )
    return teaching_class
