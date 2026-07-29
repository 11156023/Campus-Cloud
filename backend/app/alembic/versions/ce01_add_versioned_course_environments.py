"""Add versioned course environments and whole-class reservations.

Revision ID: ce01_course_environments
Revises: tc02_machine_job_idx
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "ce01_course_environments"
down_revision = "tc02_machine_job_idx"
branch_labels = None
depends_on = None


def upgrade():
    statuses = ("draft", "published", "retired")
    postgresql.ENUM(*statuses, name="courseenvironmentversionstatus").create(
        op.get_bind(), checkfirst=True
    )
    status_enum = postgresql.ENUM(
        *statuses,
        name="courseenvironmentversionstatus",
        create_type=False,
    )
    op.create_table(
        "course_environments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id",
            sa.Uuid(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code", sa.String(80), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.String(2000)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "owner_id", "code", name="uq_course_environment_owner_code"
        ),
    )
    op.create_index(
        "ix_course_environments_owner_id", "course_environments", ["owner_id"]
    )
    op.create_table(
        "course_environment_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "environment_id",
            sa.Uuid(),
            sa.ForeignKey("course_environments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", status_enum, nullable=False),
        sa.Column("configuration_hash", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint(
            "environment_id", "version", name="uq_course_environment_version"
        ),
    )
    op.create_index(
        "ix_course_environment_versions_environment_id",
        "course_environment_versions",
        ["environment_id"],
    )
    op.create_index(
        "ix_course_environment_versions_status",
        "course_environment_versions",
        ["status"],
    )
    op.create_table(
        "course_environment_nodes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "version_id",
            sa.Uuid(),
            sa.ForeignKey("course_environment_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_key", sa.String(80), nullable=False),
        sa.Column(
            "source_type", sa.String(16), nullable=False, server_default="template"
        ),
        sa.Column(
            "source_template_id",
            sa.Uuid(),
            sa.ForeignKey("vm_templates.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("custom_image_ref", sa.String(500)),
        sa.Column("custom_storage", sa.String(120)),
        sa.Column("custom_username", sa.String(32)),
        sa.Column(
            "custom_unprivileged",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(120), nullable=False),
        sa.Column("resource_type", sa.String(10), nullable=False),
        sa.Column("cpu", sa.Integer(), nullable=False),
        sa.Column("memory_mb", sa.Integer(), nullable=False),
        sa.Column("disk_gb", sa.Integer(), nullable=False),
        sa.Column("network", sa.String(255), nullable=False),
        sa.Column(
            "position_x", sa.Float(), nullable=False, server_default="80"
        ),
        sa.Column(
            "position_y", sa.Float(), nullable=False, server_default="120"
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "version_id", "node_key", name="uq_course_environment_version_node"
        ),
        sa.CheckConstraint(
            "("
            "source_type = 'template' AND source_template_id IS NOT NULL "
            "AND custom_image_ref IS NULL"
            ") OR ("
            "source_type = 'custom' AND source_template_id IS NULL "
            "AND custom_image_ref IS NOT NULL"
            ")",
            name="ck_course_environment_node_source",
        ),
    )
    op.create_index(
        "ix_course_environment_nodes_version_id",
        "course_environment_nodes",
        ["version_id"],
    )
    op.create_table(
        "course_environment_edges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "version_id",
            sa.Uuid(),
            sa.ForeignKey("course_environment_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_node_key", sa.String(80), nullable=False),
        sa.Column("target_node_key", sa.String(80), nullable=False),
        sa.Column(
            "direction",
            sa.String(16),
            nullable=False,
            server_default="one_way",
        ),
        sa.Column("protocol", sa.String(8), nullable=False, server_default="tcp"),
        sa.Column("port", sa.Integer(), server_default="22"),
        sa.UniqueConstraint(
            "version_id",
            "source_node_key",
            "target_node_key",
            "direction",
            "protocol",
            "port",
            name="uq_course_environment_edge",
        ),
        sa.CheckConstraint(
            "source_node_key <> target_node_key",
            name="ck_course_environment_edge_distinct_nodes",
        ),
    )
    op.create_index(
        "ix_course_environment_edges_version_id",
        "course_environment_edges",
        ["version_id"],
    )
    op.add_column(
        "teaching_classes",
        sa.Column("course_version_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "teaching_classes",
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_teaching_class_course_version",
        "teaching_classes",
        "course_environment_versions",
        ["course_version_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_teaching_classes_course_version_id",
        "teaching_classes",
        ["course_version_id"],
    )
    op.alter_column(
        "teaching_class_machine_nodes",
        "source_template_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )
    op.add_column(
        "teaching_class_machine_nodes",
        sa.Column(
            "source_type", sa.String(16), nullable=False, server_default="template"
        ),
    )
    op.add_column(
        "teaching_class_machine_nodes",
        sa.Column("custom_image_ref", sa.String(500), nullable=True),
    )
    op.add_column(
        "teaching_class_machine_nodes",
        sa.Column("custom_storage", sa.String(120), nullable=True),
    )
    op.add_column(
        "teaching_class_machine_nodes",
        sa.Column("custom_username", sa.String(32), nullable=True),
    )
    op.add_column(
        "teaching_class_machine_nodes",
        sa.Column(
            "custom_unprivileged",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.create_table(
        "class_capacity_reservations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "class_id",
            sa.Uuid(),
            sa.ForeignKey("teaching_classes.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "course_version_id",
            sa.Uuid(),
            sa.ForeignKey("course_environment_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("student_count", sa.Integer(), nullable=False),
        sa.Column("machine_count", sa.Integer(), nullable=False),
        sa.Column("cpu_cores", sa.Integer(), nullable=False),
        sa.Column("memory_mb", sa.Integer(), nullable=False),
        sa.Column("disk_gb", sa.Integer(), nullable=False),
        sa.Column("ip_count", sa.Integer(), nullable=False),
        sa.Column("network_count", sa.Integer(), nullable=False),
        sa.Column("placement_plan", sa.Text(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_class_capacity_reservations_class_id",
        "class_capacity_reservations",
        ["class_id"],
        unique=True,
    )
    op.add_column(
        "ip_allocation",
        sa.Column("reservation_key", sa.String(200), nullable=True),
    )
    op.add_column(
        "ip_allocation",
        sa.Column("teaching_class_id", sa.Uuid(), nullable=True),
    )
    op.create_unique_constraint(
        "uq_ip_allocation_reservation_key",
        "ip_allocation",
        ["reservation_key"],
    )
    op.create_foreign_key(
        "fk_ip_allocation_teaching_class",
        "ip_allocation",
        "teaching_classes",
        ["teaching_class_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_ip_allocation_reservation_key",
        "ip_allocation",
        ["reservation_key"],
        unique=True,
    )
    op.create_index(
        "ix_ip_allocation_teaching_class_id",
        "ip_allocation",
        ["teaching_class_id"],
    )


def downgrade():
    op.drop_index("ix_ip_allocation_teaching_class_id", table_name="ip_allocation")
    op.drop_index("ix_ip_allocation_reservation_key", table_name="ip_allocation")
    op.drop_constraint(
        "fk_ip_allocation_teaching_class", "ip_allocation", type_="foreignkey"
    )
    op.drop_constraint(
        "uq_ip_allocation_reservation_key", "ip_allocation", type_="unique"
    )
    op.drop_column("ip_allocation", "teaching_class_id")
    op.drop_column("ip_allocation", "reservation_key")
    op.drop_table("class_capacity_reservations")
    op.drop_column("teaching_class_machine_nodes", "custom_unprivileged")
    op.drop_column("teaching_class_machine_nodes", "custom_username")
    op.drop_column("teaching_class_machine_nodes", "custom_storage")
    op.drop_column("teaching_class_machine_nodes", "custom_image_ref")
    op.drop_column("teaching_class_machine_nodes", "source_type")
    op.alter_column(
        "teaching_class_machine_nodes",
        "source_template_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
    op.drop_index(
        "ix_teaching_classes_course_version_id", table_name="teaching_classes"
    )
    op.drop_constraint(
        "fk_teaching_class_course_version", "teaching_classes", type_="foreignkey"
    )
    op.drop_column("teaching_classes", "locked_at")
    op.drop_column("teaching_classes", "course_version_id")
    op.drop_table("course_environment_edges")
    op.drop_table("course_environment_nodes")
    op.drop_table("course_environment_versions")
    op.drop_table("course_environments")
    sa.Enum(name="courseenvironmentversionstatus").drop(op.get_bind(), checkfirst=True)
