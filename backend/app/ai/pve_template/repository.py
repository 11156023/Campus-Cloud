"""Persistence helpers for AI PVE templates."""

from __future__ import annotations

import uuid
from typing import Any, cast

from sqlmodel import Session, select

from app.models import AIPVETemplate


def list_enabled(*, session: Session) -> list[AIPVETemplate]:
    """Return selectable templates in a stable display order."""
    statement = (
        select(AIPVETemplate)
        .where(cast(Any, AIPVETemplate.enabled).is_(True))
        .order_by(AIPVETemplate.display_name, AIPVETemplate.template_key)
    )
    return list(session.exec(statement).all())


def get_by_key(*, session: Session, template_key: str) -> AIPVETemplate | None:
    return session.exec(
        select(AIPVETemplate).where(AIPVETemplate.template_key == template_key)
    ).first()


def get_by_id(*, session: Session, template_id: uuid.UUID) -> AIPVETemplate | None:
    return session.get(AIPVETemplate, template_id)
