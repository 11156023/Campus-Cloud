"""align live-database schema drift with the migration chain

Revision ID: dbc01_align_drift
Revises: ce04_env_concurrency
Create Date: 2026-09-01 00:00:00.000000

Long-lived development databases drifted away from what the migration chain
produces on a fresh database: three constraints kept PostgreSQL's auto-generated
names, two columns kept an obsolete length limit, and one unique index kept a
redundant partial predicate.  None of it changes behaviour today, but a future
migration that references a constraint by its canonical name would fail on the
drifted databases only.

Every statement is idempotent so this is a no-op on databases built from the
chain, and a repair on the drifted ones.
"""

from alembic import op

revision = "dbc01_align_drift"
down_revision = "ce04_env_concurrency"
branch_labels = None
depends_on = None


# (table, legacy auto-generated name, canonical name used by the chain)
_CONSTRAINT_RENAMES = (
    (
        "ip_allocation",
        "ip_allocation_teaching_class_id_fkey",
        "fk_ip_allocation_teaching_class",
    ),
    (
        "teaching_classes",
        "teaching_classes_course_version_id_fkey",
        "fk_teaching_class_course_version",
    ),
    (
        "tunnel_proxies",
        "tunnel_proxies_proxy_name_key",
        "uq_tunnel_proxies_proxy_name",
    ),
)

# (table, column) pairs whose length limit is not declared by the model.
_UNBOUNDED_COLUMNS = (
    ("vm_requests", "recurrence_rule"),
    ("vm_requests", "schedule_timezone"),
    ("batch_provision_jobs", "recurrence_rule"),
    ("batch_provision_jobs", "schedule_timezone"),
)


def _rename_constraint(table: str, old: str, new: str) -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = '{old}'
            ) AND NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = '{new}'
            ) THEN
                ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new};
            END IF;
        END $$;
        """
    )


def upgrade():
    for table, old, new in _CONSTRAINT_RENAMES:
        _rename_constraint(table, old, new)

    # VARCHAR(n) -> VARCHAR widens the domain, so no value can be rejected.
    for table, column in _UNBOUNDED_COLUMNS:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE VARCHAR")

    # The partial predicate is redundant: PostgreSQL already treats NULLs as
    # distinct in a unique index, so the two forms accept the same rows.
    op.execute("DROP INDEX IF EXISTS ix_ip_allocation_reservation_key")
    op.execute(
        "CREATE UNIQUE INDEX ix_ip_allocation_reservation_key "
        "ON ip_allocation (reservation_key)"
    )


def downgrade():
    for table, old, new in _CONSTRAINT_RENAMES:
        _rename_constraint(table, new, old)

    op.execute("ALTER TABLE vm_requests ALTER COLUMN recurrence_rule TYPE VARCHAR(255)")
    op.execute("ALTER TABLE vm_requests ALTER COLUMN schedule_timezone TYPE VARCHAR(64)")
    op.execute(
        "ALTER TABLE batch_provision_jobs ALTER COLUMN recurrence_rule TYPE VARCHAR(255)"
    )
    op.execute(
        "ALTER TABLE batch_provision_jobs ALTER COLUMN schedule_timezone TYPE VARCHAR(64)"
    )

    op.execute("DROP INDEX IF EXISTS ix_ip_allocation_reservation_key")
    op.execute(
        "CREATE UNIQUE INDEX ix_ip_allocation_reservation_key "
        "ON ip_allocation (reservation_key) WHERE reservation_key IS NOT NULL"
    )
