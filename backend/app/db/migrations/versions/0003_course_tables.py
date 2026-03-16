"""Course categories and courses tables for csdiy.wiki knowledge network

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Course categories
    op.create_table(
        "course_categories",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(200), nullable=False, unique=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "parent_id",
            UUID(as_uuid=True),
            sa.ForeignKey("course_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # Courses
    op.create_table(
        "courses",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "category_id",
            UUID(as_uuid=True),
            sa.ForeignKey("course_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("slug", sa.String(500), nullable=False, unique=True),
        sa.Column("university", sa.String(200), nullable=True),
        sa.Column("instructor", sa.String(200), nullable=True),
        sa.Column("language", sa.String(10), nullable=False, server_default="en"),
        sa.Column("programming_lang", sa.String(50), nullable=True),
        sa.Column("difficulty", sa.SmallInteger(), nullable=False, server_default="3"),
        sa.Column("estimated_hours", sa.Integer(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("prerequisites", sa.Text(), nullable=True),
        sa.Column("website_url", sa.String(1000), nullable=True),
        sa.Column("video_url", sa.String(1000), nullable=True),
        sa.Column("csdiy_source", sa.String(500), nullable=False, server_default=""),
        sa.Column(
            "tags",
            ARRAY(sa.String(100)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("student_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("material_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_index("ix_courses_category_id", "courses", ["category_id"])
    op.create_index("ix_courses_slug", "courses", ["slug"])
    op.create_index("ix_courses_university", "courses", ["university"])

    # Also add FK from materials.course_id → courses.id
    # (materials.course_id was previously unlinked UUID)
    # Skip this for now — material course_id will be linked in a later migration
    # after existing materials are migrated to real course IDs


def downgrade() -> None:
    op.drop_table("courses")
    op.drop_table("course_categories")
