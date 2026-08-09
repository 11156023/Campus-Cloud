"""Regression checks for the formal-class cutover."""

from app.main import app
from app.models import SQLModel


def test_retired_group_pair_routes_are_not_registered() -> None:
    paths = {route.path for route in app.routes}

    assert not any(path.startswith("/api/v1/groups") for path in paths)
    assert not any(path.startswith("/api/v1/pair-sessions") for path in paths)
    assert not any(path.startswith("/api/v1/teaching/") for path in paths)


def test_ai_pve_is_registered_as_a_standalone_admin_tool() -> None:
    pve_routes = [
        route for route in app.routes if route.path.startswith("/api/v1/ai/pve-log")
    ]
    paths = {route.path for route in pve_routes}

    assert "/api/v1/ai/pve-log/chat" in paths
    assert "/api/v1/ai/pve-log/ssh/confirm" in paths
    assert all(
        "get_current_active_superuser"
        in {
            getattr(dependency.call, "__name__", "")
            for dependency in route.dependant.dependencies
        }
        for route in pve_routes
    )


def test_teacher_judge_routes_are_owned_by_formal_classes() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/v1/teaching-classes/{teaching_class_id}/judge/files/" in paths
    assert "/api/v1/teaching-classes/{teaching_class_id}/judge/scripts/" in paths


def test_group_tables_and_foreign_keys_are_absent_from_current_metadata() -> None:
    assert "group" not in SQLModel.metadata.tables
    assert "group_member" not in SQLModel.metadata.tables
    assert "vm_template_group_links" not in SQLModel.metadata.tables

    group_foreign_keys = [
        foreign_key.target_fullname
        for table in SQLModel.metadata.sorted_tables
        for foreign_key in table.foreign_keys
        if foreign_key.target_fullname.startswith(("group.", "group_member."))
    ]
    assert group_foreign_keys == []
