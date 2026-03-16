"""Extend courses with content pipeline fields + course_material_sources table.

Adds raw_description, platform_description, content_status, learning_objectives,
target_audience, syllabus, source_platform, source_id, source_url, semester, level,
school, department, image_url, completeness, license, last_scraped_at, updated_at.

Creates course_material_sources for tracking external course materials (MIT OCW etc.).

Backfills raw_description from existing description for csdiy courses.

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

# Valid content_status values (must match models/course.py)
_STATUS_VALUES = (
    "'raw','ai_rewritten','reviewed','published',"
    "'rejected','archived','draft','rewrite_failed'"
)


def upgrade() -> None:
    # --- Extend courses table ---
    op.add_column("courses", sa.Column(
        "raw_description", sa.Text(), nullable=False, server_default=""))
    op.add_column("courses", sa.Column(
        "platform_description", sa.Text(), nullable=False, server_default=""))
    op.add_column("courses", sa.Column(
        "content_status", sa.String(20), nullable=False, server_default="raw"))
    op.add_column("courses", sa.Column(
        "learning_objectives", JSONB(), nullable=True))
    op.add_column("courses", sa.Column(
        "target_audience", sa.Text(), nullable=True))
    op.add_column("courses", sa.Column(
        "syllabus", JSONB(), nullable=True))
    op.add_column("courses", sa.Column(
        "source_platform", sa.String(50), nullable=False, server_default="csdiy"))
    op.add_column("courses", sa.Column(
        "source_id", sa.String(200), nullable=True))
    op.add_column("courses", sa.Column(
        "source_url", sa.Text(), nullable=True))
    op.add_column("courses", sa.Column(
        "semester", sa.String(20), nullable=True))
    op.add_column("courses", sa.Column(
        "level", sa.String(20), nullable=True))
    op.add_column("courses", sa.Column(
        "school", sa.String(200), nullable=True))
    op.add_column("courses", sa.Column(
        "department", sa.String(200), nullable=True))
    op.add_column("courses", sa.Column(
        "image_url", sa.Text(), nullable=True))
    op.add_column("courses", sa.Column(
        "completeness", sa.Numeric(3, 2), nullable=True))
    op.add_column("courses", sa.Column(
        "license", sa.String(50), nullable=True))
    op.add_column("courses", sa.Column(
        "last_scraped_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("courses", sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=True))

    # CHECK constraints
    op.create_check_constraint(
        "ck_courses_content_status", "courses",
        f"content_status IN ({_STATUS_VALUES})",
    )
    op.create_check_constraint(
        "ck_courses_completeness_range", "courses",
        "completeness IS NULL OR (completeness >= 0 AND completeness <= 1)",
    )

    # Indexes
    op.create_index("ix_courses_content_status", "courses", ["content_status"])
    op.create_index("ix_courses_source_platform", "courses", ["source_platform"])

    # Unique constraint: (source_platform, source_id) for idempotent scraping
    op.create_unique_constraint(
        "uq_courses_source", "courses",
        ["source_platform", "source_id"],
    )

    # Backfill: copy description → raw_description for existing csdiy courses
    op.execute(
        "UPDATE courses SET raw_description = description "
        "WHERE raw_description = '' AND description != ''"
    )

    # --- Create course_material_sources table ---
    op.create_table(
        "course_material_sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("course_id", UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(50), nullable=False),
        sa.Column("content_feature", sa.String(100), nullable=True),
        sa.Column("file_extension", sa.String(10), nullable=True),
        sa.Column("ocw_content_id", sa.Integer(), nullable=True),
        sa.Column("download_url", sa.Text(), nullable=True),
        sa.Column("downloaded", sa.Boolean(), nullable=False,
                  server_default=sa.text("false")),
        sa.Column("s3_key", sa.String(1000), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("license", sa.String(50), nullable=True),
        sa.Column("attribution", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
    )

    # Indexes for course_material_sources
    op.create_index("ix_cms_course", "course_material_sources", ["course_id"])
    op.create_index("ix_cms_course_type", "course_material_sources",
                    ["course_id", "content_type"])
    op.create_index("ix_cms_not_downloaded", "course_material_sources",
                    ["downloaded"],
                    postgresql_where=sa.text("downloaded = false"))
    op.create_unique_constraint(
        "uq_cms_ocw_content", "course_material_sources",
        ["course_id", "ocw_content_id"],
    )


def downgrade() -> None:
    op.drop_table("course_material_sources")

    op.drop_constraint("uq_courses_source", "courses", type_="unique")
    op.drop_index("ix_courses_source_platform", table_name="courses")
    op.drop_index("ix_courses_content_status", table_name="courses")
    op.drop_constraint("ck_courses_completeness_range", "courses",
                       type_="check")
    op.drop_constraint("ck_courses_content_status", "courses", type_="check")

    for col in ("updated_at", "last_scraped_at", "license", "completeness",
                "image_url", "department", "school", "level", "semester",
                "source_url", "source_id", "source_platform", "syllabus",
                "target_audience", "learning_objectives", "content_status",
                "platform_description", "raw_description"):
        op.drop_column("courses", col)
