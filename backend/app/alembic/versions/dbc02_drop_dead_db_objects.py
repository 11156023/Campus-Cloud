"""drop dead database objects surfaced by the schema audit

Revision ID: dbc02_drop_dead
Revises: dbc01_align_drift
Create Date: 2026-09-01 00:00:00.000000

Four independent cleanups, none of which changes application behaviour:

1. ``ai_api_rate_limit`` — rate limiting moved to a Redis sliding window
   (``app/api/routes/ai_proxy.py``); the table has no reader or writer left.
2. ``resources.ip_address`` / ``ip_address_cached_at`` — superseded by
   ``resource_networks``.  ``ed01_resource_norm`` already dropped these once;
   ``fdb02_resource_ip_cache`` added them back because development databases
   had drifted, and they have been write-dead ever since.  This time the model
   and the repository fallbacks go with them.
3. ``resource_networks`` gains ``UNIQUE (resource_vmid)`` — the repository has
   always assumed one row per resource (it calls ``.first()``), but nothing
   enforced it.
4. ``resource_quotas.scope`` — the Python enum has exactly one member
   (``user``), so the column carries no information.  The PostgreSQL enum type
   also still holds a ``group`` value left over from the retired test-groups
   feature, so the type goes too.

Every step is idempotent.  Databases in this project have drifted before --
``fdb02_resource_ip_cache`` exists only because one was stamped past the
migration that added ``resources.ip_address`` -- so a revision that drops
things has to survive being replayed against a database that already has them
dropped.
"""

import sqlalchemy as sa
from alembic import op

revision = "dbc02_drop_dead"
down_revision = "dbc01_align_drift"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    return column in {
        col["name"] for col in sa.inspect(op.get_bind()).get_columns(table)
    }


def upgrade():
    # 1. Final backfill before the legacy IP cache columns disappear for good.
    #    resource_networks.ip_address is unique, so collisions resolve to the
    #    row we are about to write.  Skipped when the source columns are already
    #    gone, which is the case on a replay.
    if _has_column("resources", "ip_address"):
        op.execute(
            """
        WITH source_rows AS (
            SELECT DISTINCT ON (ip_address)
                vmid,
                ip_address,
                ip_address_cached_at,
                created_at
            FROM resources
            WHERE ip_address IS NOT NULL
              AND btrim(ip_address) <> ''
            ORDER BY
                ip_address,
                ip_address_cached_at DESC NULLS LAST,
                created_at DESC
        )
        INSERT INTO resource_networks (
            id, resource_vmid, ip_address, source, cached_at, created_at, updated_at
        )
        SELECT
            gen_random_uuid(),
            vmid,
            ip_address,
            'resource_cache',
            ip_address_cached_at,
            COALESCE(ip_address_cached_at, created_at, now()),
            now()
        FROM source_rows
        ON CONFLICT (ip_address) DO UPDATE
        SET resource_vmid = EXCLUDED.resource_vmid,
            source        = EXCLUDED.source,
            cached_at     = EXCLUDED.cached_at,
            updated_at    = now()
        """
        )

    # 2. Collapse any pre-existing duplicates, keeping the freshest row, so the
    #    unique constraint below can be created.
    op.execute(
        """
        DELETE FROM resource_networks
        WHERE id IN (
            SELECT id
            FROM (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY resource_vmid
                        ORDER BY
                            cached_at  DESC NULLS LAST,
                            updated_at DESC NULLS LAST,
                            id         DESC
                    ) AS row_rank
                FROM resource_networks
            ) ranked
            WHERE ranked.row_rank > 1
        )
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_resource_networks_resource_vmid'
            ) THEN
                ALTER TABLE resource_networks
                ADD CONSTRAINT uq_resource_networks_resource_vmid
                UNIQUE (resource_vmid);
            END IF;
        END $$;
        """
    )

    # 3. The legacy per-resource IP cache.
    op.execute("ALTER TABLE resources DROP COLUMN IF EXISTS ip_address_cached_at")
    op.execute("ALTER TABLE resources DROP COLUMN IF EXISTS ip_address")

    # 4. The single-valued quota scope and its orphaned enum type.
    op.execute("ALTER TABLE resource_quotas DROP COLUMN IF EXISTS scope")
    op.execute("DROP TYPE IF EXISTS quotascope")

    # 5. The table replaced by Redis-backed rate limiting.
    op.execute("DROP TABLE IF EXISTS ai_api_rate_limit")


def downgrade():
    # Mirrors upgrade(): every statement tolerates the object already being in
    # the state it is meant to reach.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_api_rate_limit (
            user_id       UUID        NOT NULL REFERENCES "user"(id),
            minute_key    VARCHAR(20) NOT NULL,
            request_count INTEGER     NOT NULL,
            updated_at    TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_id, minute_key)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ai_api_rate_limit_updated_at "
        "ON ai_api_rate_limit (updated_at)"
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quotascope') THEN
                CREATE TYPE quotascope AS ENUM ('group', 'user');
            END IF;
        END $$;
        """
    )
    op.execute(
        "ALTER TABLE resource_quotas "
        "ADD COLUMN IF NOT EXISTS scope quotascope NOT NULL DEFAULT 'user'"
    )
    op.execute("ALTER TABLE resource_quotas ALTER COLUMN scope DROP DEFAULT")

    op.execute(
        "ALTER TABLE resources ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64)"
    )
    op.execute(
        "ALTER TABLE resources "
        "ADD COLUMN IF NOT EXISTS ip_address_cached_at TIMESTAMPTZ"
    )
    op.execute(
        """
        UPDATE resources r
        SET ip_address = rn.ip_address,
            ip_address_cached_at = rn.cached_at
        FROM resource_networks rn
        WHERE rn.resource_vmid = r.vmid
          AND rn.ip_address IS NOT NULL
        """
    )

    op.execute(
        "ALTER TABLE resource_networks "
        "DROP CONSTRAINT IF EXISTS uq_resource_networks_resource_vmid"
    )
