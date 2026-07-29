"""Install the course-environment schema without changing Alembic history.

This is intentionally separate from Alembic.  It supports deployments whose
database points at a migration revision that is not present in this checkout.
All operations are additive/idempotent and the alembic_version row is untouched.
"""

import logging

from sqlalchemy import inspect, text
from sqlmodel import SQLModel

import app.models  # noqa: F401 - register SQLModel tables
from app.core.db import engine

NEW_TABLE_NAMES = [
    "course_environments",
    "course_environment_versions",
    "course_environment_nodes",
    "course_environment_edges",
    "class_capacity_reservations",
]
logger = logging.getLogger(__name__)


def _column_names(table: str) -> set[str]:
    return {row["name"] for row in inspect(engine).get_columns(table)}


def _add_column(table: str, name: str, definition: str) -> None:
    if name in _column_names(table):
        return
    with engine.begin() as connection:
        connection.execute(text(f'ALTER TABLE "{table}" ADD COLUMN {definition}'))


def apply() -> None:
    new_tables = [SQLModel.metadata.tables[name] for name in NEW_TABLE_NAMES]
    SQLModel.metadata.create_all(engine, tables=new_tables, checkfirst=True)

    _add_column(
        "teaching_classes",
        "course_version_id",
        "course_version_id UUID NULL REFERENCES "
        '"course_environment_versions"(id) ON DELETE RESTRICT',
    )
    _add_column(
        "teaching_classes",
        "locked_at",
        "locked_at TIMESTAMP WITH TIME ZONE NULL",
    )
    _add_column(
        "teaching_class_machine_nodes",
        "source_type",
        "source_type VARCHAR(16) NOT NULL DEFAULT 'template'",
    )
    _add_column(
        "teaching_class_machine_nodes",
        "custom_image_ref",
        "custom_image_ref VARCHAR(500) NULL",
    )
    _add_column(
        "teaching_class_machine_nodes",
        "custom_storage",
        "custom_storage VARCHAR(120) NULL",
    )
    _add_column(
        "teaching_class_machine_nodes",
        "custom_username",
        "custom_username VARCHAR(32) NULL",
    )
    _add_column(
        "teaching_class_machine_nodes",
        "custom_unprivileged",
        "custom_unprivileged BOOLEAN NOT NULL DEFAULT TRUE",
    )
    _add_column(
        "ip_allocation",
        "reservation_key",
        "reservation_key VARCHAR(200) NULL",
    )
    _add_column(
        "ip_allocation",
        "teaching_class_id",
        'teaching_class_id UUID NULL REFERENCES "teaching_classes"(id) '
        "ON DELETE CASCADE",
    )

    with engine.begin() as connection:
        connection.execute(
            text(
                'ALTER TABLE "teaching_class_machine_nodes" '
                "ALTER COLUMN source_template_id DROP NOT NULL"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS "
                "ix_teaching_classes_course_version_id "
                'ON "teaching_classes" (course_version_id)'
            )
        )
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "ix_ip_allocation_reservation_key "
                'ON "ip_allocation" (reservation_key) '
                "WHERE reservation_key IS NOT NULL"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS "
                "ix_ip_allocation_teaching_class_id "
                'ON "ip_allocation" (teaching_class_id)'
            )
        )

    logger.info("Course environment compatibility schema is ready.")
    logger.info("Alembic history was not changed.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    apply()
