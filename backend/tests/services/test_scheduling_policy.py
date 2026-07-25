"""Tests for pure helpers in app.services.scheduling.policy."""

from datetime import UTC, datetime, timedelta, timezone

from app.services.scheduling import policy as p


def test_utc_now_is_timezone_aware() -> None:
    now = p.utc_now()
    assert now.tzinfo is not None and now.utcoffset() == timedelta(0)


def test_normalize_datetime_attaches_utc_to_naive() -> None:
    naive = datetime(2026, 4, 23, 12, 0, 0)
    normalized = p.normalize_datetime(naive)
    assert normalized is not None
    assert normalized.tzinfo == UTC


def test_normalize_datetime_keeps_aware_unchanged() -> None:
    aware = datetime(2026, 4, 23, 12, 0, 0, tzinfo=timezone(timedelta(hours=8)))
    assert p.normalize_datetime(aware) is aware


def test_normalize_datetime_handles_none() -> None:
    assert p.normalize_datetime(None) is None
