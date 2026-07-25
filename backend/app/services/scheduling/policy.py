from __future__ import annotations

from datetime import UTC, datetime

from app.models import VMRequest

SCHEDULER_POLL_SECONDS = 60


def utc_now() -> datetime:
    return datetime.now(UTC)


def normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def resource_type_for_request(request: VMRequest) -> str:
    return "lxc" if request.resource_type == "lxc" else "qemu"
