"""Shared Proxmox usage serialization helpers."""

from typing import Any


def safe_usage_pct(used: Any, total: Any) -> float | None:
    """Convert used/total to a clamped percentage, or None when unavailable."""
    try:
        used_value = float(used)
        total_value = float(total)
    except (TypeError, ValueError):
        return None
    if total_value <= 0:
        return None
    return round(max(0.0, min(used_value / total_value * 100, 100.0)), 1)
