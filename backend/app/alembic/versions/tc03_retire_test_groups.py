"""Retire test groups and move teaching features to formal classes.

Revision ID: tc03_retire_test_groups
Revises: ep04_retire_exec_profile_schema
Create Date: 2026-07-30 12:00:00.000000

The legacy group feature only contained test data.  This migration therefore
performs a direct cutover: Teacher Judge rows are cleared before their owning
foreign key is changed, and group-only records are discarded.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "tc03_retire_test_groups"
down_revision = "ep04_retire_exec_profile_schema"
branch_labels = None
depends_on = None


def _table_exists(bind: sa.Connection, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def _column_exists(bind: sa.Connection, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return any(
        column["name"] == column_name
        for column in sa.inspect(bind).get_columns(table_name)
    )


def _drop_column_dependencies(
    bind: sa.Connection, table_name: str, column_name: str
) -> None:
    inspector = sa.inspect(bind)
    for foreign_key in inspector.get_foreign_keys(table_name):
        if column_name in (foreign_key.get("constrained_columns") or []):
            name = foreign_key.get("name")
            if name:
                op.drop_constraint(name, table_name, type_="foreignkey")
    inspector = sa.inspect(bind)
    for unique in inspector.get_unique_constraints(table_name):
        if column_name in (unique.get("column_names") or []):
            name = unique.get("name")
            if name:
                op.drop_constraint(name, table_name, type_="unique")
    inspector = sa.inspect(bind)
    for index in inspector.get_indexes(table_name):
        if column_name in (index.get("column_names") or []):
            name = index.get("name")
            if name:
                op.drop_index(name, table_name=table_name)


def _rename_judge_owner(
    bind: sa.Connection,
    table_name: str,
    *,
    composite_indexes: tuple[tuple[str, tuple[str, ...], bool], ...],
) -> None:
    if not _column_exists(bind, table_name, "group_id"):
        return
    op.execute(sa.text(f"DELETE FROM {table_name}"))
    _drop_column_dependencies(bind, table_name, "group_id")
    op.alter_column(
        table_name,
        "group_id",
        new_column_name="teaching_class_id",
        existing_type=sa.Uuid(),
        existing_nullable=False,
    )
    op.create_foreign_key(
        f"fk_{table_name}_teaching_class_id",
        table_name,
        "teaching_classes",
        ["teaching_class_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        f"ix_{table_name}_teaching_class_id",
        table_name,
        ["teaching_class_id"],
    )
    for name, columns, unique in composite_indexes:
        kwargs: dict[str, object] = {"unique": unique}
        if name == "uq_teacher_judge_files_active_filename":
            kwargs["postgresql_where"] = sa.text("status = 'active'")
            kwargs["sqlite_where"] = sa.text("status = 'active'")
        op.create_index(name, table_name, list(columns), **kwargs)


def _rename_template_visibility(bind: sa.Connection, old: str, new: str) -> None:
    if bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                f"""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM pg_enum e
                        JOIN pg_type t ON t.oid = e.enumtypid
                        WHERE t.typname = 'vmtemplatevisibility'
                          AND e.enumlabel = '{old}'
                    ) AND NOT EXISTS (
                        SELECT 1
                        FROM pg_enum e
                        JOIN pg_type t ON t.oid = e.enumtypid
                        WHERE t.typname = 'vmtemplatevisibility'
                          AND e.enumlabel = '{new}'
                    ) THEN
                        ALTER TYPE vmtemplatevisibility
                        RENAME VALUE '{old}' TO '{new}';
                    END IF;
                END
                $$;
                """
            )
        )
    elif _table_exists(bind, "vm_templates"):
        op.execute(
            sa.text(
                "UPDATE vm_templates SET visibility = :new WHERE visibility = :old"
            ).bindparams(old=old, new=new)
        )


def upgrade() -> None:
    bind = op.get_bind()

    # Runs and artifacts reference their parent rows, so clear/rename children first.
    _rename_judge_owner(
        bind,
        "teacher_judge_script_runs",
        composite_indexes=(
            (
                "ix_teacher_judge_script_runs_class_status",
                ("teaching_class_id", "status"),
                False,
            ),
        ),
    )
    _rename_judge_owner(
        bind,
        "teacher_judge_script_artifacts",
        composite_indexes=(
            (
                "ix_teacher_judge_script_artifacts_class_status",
                ("teaching_class_id", "status"),
                False,
            ),
            (
                "ix_teacher_judge_script_artifacts_class_created",
                ("teaching_class_id", "created_at"),
                False,
            ),
        ),
    )
    _rename_judge_owner(
        bind,
        "teacher_judge_files",
        composite_indexes=(
            (
                "ix_teacher_judge_files_class_filename",
                ("teaching_class_id", "original_filename"),
                False,
            ),
            (
                "ix_teacher_judge_files_class_created",
                ("teaching_class_id", "created_at"),
                False,
            ),
            (
                "uq_teacher_judge_files_active_filename",
                ("teaching_class_id", "original_filename"),
                True,
            ),
        ),
    )

    if _column_exists(bind, "batch_provision_jobs", "group_id"):
        op.execute("DELETE FROM batch_provision_jobs WHERE teaching_class_id IS NULL")
        _drop_column_dependencies(bind, "batch_provision_jobs", "group_id")
        op.drop_column("batch_provision_jobs", "group_id")
        op.alter_column(
            "batch_provision_jobs",
            "teaching_class_id",
            existing_type=sa.Uuid(),
            nullable=False,
        )

    if _column_exists(bind, "resource_quotas", "group_id"):
        op.execute("DELETE FROM resource_quotas WHERE user_id IS NULL")
        op.execute("UPDATE resource_quotas SET scope = 'user'")
        _drop_column_dependencies(bind, "resource_quotas", "group_id")
        op.drop_column("resource_quotas", "group_id")
        op.alter_column(
            "resource_quotas",
            "user_id",
            existing_type=sa.Uuid(),
            nullable=False,
        )

    if _table_exists(bind, "vm_template_group_links"):
        op.drop_table("vm_template_group_links")
    if _table_exists(bind, "group_member"):
        op.drop_table("group_member")
    if _table_exists(bind, "group"):
        op.drop_table("group")

    _rename_template_visibility(bind, "groups", "private")


def downgrade() -> None:
    """Restore the retired schema without recreating discarded test data."""
    bind = op.get_bind()
    _rename_template_visibility(bind, "private", "groups")

    if not _table_exists(bind, "group"):
        op.create_table(
            "group",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.String(1000), nullable=True),
            sa.Column("owner_id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["owner_id"], ["user.id"]),
            sa.UniqueConstraint("owner_id", "name", name="uq_group_owner_name"),
        )
    if not _table_exists(bind, "group_member"):
        op.create_table(
            "group_member",
            sa.Column("group_id", sa.Uuid(), primary_key=True),
            sa.Column("user_id", sa.Uuid(), primary_key=True),
            sa.Column("added_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["group_id"], ["group.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        )

    if _column_exists(bind, "batch_provision_jobs", "teaching_class_id"):
        op.add_column(
            "batch_provision_jobs",
            sa.Column("group_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "fk_batch_provision_jobs_group_id",
            "batch_provision_jobs",
            "group",
            ["group_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.alter_column(
            "batch_provision_jobs",
            "teaching_class_id",
            existing_type=sa.Uuid(),
            nullable=True,
        )

    if _column_exists(bind, "resource_quotas", "user_id"):
        op.add_column(
            "resource_quotas",
            sa.Column("group_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "fk_resource_quotas_group_id",
            "resource_quotas",
            "group",
            ["group_id"],
            ["id"],
        )
        op.create_unique_constraint(
            "uq_resource_quotas_group_id",
            "resource_quotas",
            ["group_id"],
        )
        op.alter_column(
            "resource_quotas",
            "user_id",
            existing_type=sa.Uuid(),
            nullable=True,
        )

    if not _table_exists(bind, "vm_template_group_links"):
        op.create_table(
            "vm_template_group_links",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("template_id", sa.Uuid(), nullable=False),
            sa.Column("group_id", sa.Uuid(), nullable=False),
            sa.ForeignKeyConstraint(
                ["template_id"], ["vm_templates.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["group_id"], ["group.id"], ondelete="CASCADE"),
            sa.UniqueConstraint(
                "template_id",
                "group_id",
                name="uq_vm_template_group_links",
            ),
        )

    for table_name in (
        "teacher_judge_script_runs",
        "teacher_judge_script_artifacts",
        "teacher_judge_files",
    ):
        if not _column_exists(bind, table_name, "teaching_class_id"):
            continue
        op.execute(sa.text(f"DELETE FROM {table_name}"))
        _drop_column_dependencies(bind, table_name, "teaching_class_id")
        op.alter_column(
            table_name,
            "teaching_class_id",
            new_column_name="group_id",
            existing_type=sa.Uuid(),
            existing_nullable=False,
        )
        op.create_foreign_key(
            f"fk_{table_name}_group_id",
            table_name,
            "group",
            ["group_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_index(
            f"ix_{table_name}_group_id",
            table_name,
            ["group_id"],
        )
