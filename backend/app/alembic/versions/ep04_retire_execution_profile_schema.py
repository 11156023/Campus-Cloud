"""Retire the unused resource-execution schema.

Revision ID: ep04_retire_exec_profile_schema
Revises: db02_remove_duplicate_uniques
Create Date: 2026-07-29 23:30:00.000000

The execution-profile branch was retired from the application, but some
databases still contain its tables and columns.  Remove those objects from
the maintained schema so Alembic metadata matches the current models.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ep04_retire_exec_profile_schema"
down_revision = "db02_remove_duplicate_uniques"
branch_labels = None
depends_on = None


def _table_exists(bind: sa.Connection, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def _column_exists(bind: sa.Connection, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return any(
        column.get("name") == column_name
        for column in sa.inspect(bind).get_columns(table_name)
    )


def _drop_foreign_keys_for_column(
    bind: sa.Connection,
    table_name: str,
    column_name: str,
    referred_table: str,
) -> None:
    if not _table_exists(bind, table_name):
        return
    for foreign_key in sa.inspect(bind).get_foreign_keys(table_name):
        if (
            foreign_key.get("referred_table") == referred_table
            and foreign_key.get("constrained_columns") == [column_name]
            and foreign_key.get("name")
        ):
            op.drop_constraint(
                foreign_key["name"],
                table_name,
                type_="foreignkey",
            )


def _drop_indexes_for_column(
    bind: sa.Connection,
    table_name: str,
    column_name: str,
) -> None:
    if not _table_exists(bind, table_name):
        return
    for index in sa.inspect(bind).get_indexes(table_name):
        if (
            index.get("name")
            and index.get("column_names") == [column_name]
        ):
            op.drop_index(index["name"], table_name=table_name)


def _drop_column_if_present(
    bind: sa.Connection,
    table_name: str,
    column_name: str,
) -> None:
    if _column_exists(bind, table_name, column_name):
        op.drop_column(table_name, column_name)


def upgrade() -> None:
    bind = op.get_bind()

    # Remove references before dropping the profile table.  The profile ID
    # columns are no longer part of the Resource or VMTemplate models.
    for table_name in ("resources", "vm_templates"):
        _drop_foreign_keys_for_column(
            bind,
            table_name,
            "execution_profile_id",
            "execution_profiles",
        )
        _drop_indexes_for_column(bind, table_name, "execution_profile_id")
        _drop_column_if_present(bind, table_name, "execution_profile_id")

    # resource_type was introduced by the same retired branch and is absent
    # from the current Resource model.
    _drop_indexes_for_column(bind, "resources", "resource_type")
    _drop_column_if_present(bind, "resources", "resource_type")

    # The child table must be removed before its parent because it owns the
    # profile_id foreign key.
    if _table_exists(bind, "execution_profile_commands"):
        op.drop_table("execution_profile_commands")
    if _table_exists(bind, "execution_profiles"):
        op.drop_table("execution_profiles")


def downgrade() -> None:
    raise NotImplementedError(
        "The retired execution-profile schema was intentionally deleted and "
        "cannot be restored by downgrade."
    )
