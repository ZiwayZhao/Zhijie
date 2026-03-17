"""Gaoling Life posts table — campus life information platform

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gaoling_life_posts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column(
            "category", sa.String(20), nullable=False,
            comment="sport | medical | lecture | dining | study",
        ),
        sa.Column("is_official", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "status", sa.String(20), nullable=False, server_default="published",
            comment="draft | pending | published | rejected",
        ),
        sa.Column("likes", sa.Integer(), server_default="0", nullable=False),
        sa.Column("view_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("author_name", sa.String(100), nullable=True),
        sa.Column("cover_image", sa.String(500), nullable=True),
        sa.Column("images", ARRAY(sa.String()), server_default="{}", nullable=True),
        sa.Column("source_url", sa.String(500), unique=True, nullable=True),
        sa.Column("publish_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_index("ix_gaoling_life_posts_category", "gaoling_life_posts", ["category"])
    op.create_index("ix_gaoling_life_posts_publish_time", "gaoling_life_posts", ["publish_time"])


def downgrade() -> None:
    op.drop_index("ix_gaoling_life_posts_publish_time")
    op.drop_index("ix_gaoling_life_posts_category")
    op.drop_table("gaoling_life_posts")
