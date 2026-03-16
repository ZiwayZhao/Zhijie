"""Initial schema: users, refresh_tokens, materials

Revision ID: 0001
Revises:
Create Date: 2026-03-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Users
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=True, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("auth_provider", sa.String(20), nullable=False, server_default="email"),
        sa.Column("provider_id", sa.String(200), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "(auth_provider = 'email' AND email IS NOT NULL AND password_hash IS NOT NULL) "
            "OR (auth_provider != 'email' AND provider_id IS NOT NULL)",
            name="ck_users_auth_integrity",
        ),
        sa.UniqueConstraint("auth_provider", "provider_id", name="uq_users_provider"),
    )

    # Refresh tokens
    op.create_table(
        "refresh_tokens",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("token_family", sa.String(64), nullable=False, index=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Materials
    op.create_table(
        "materials",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("course_id", UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("s3_key", sa.String(1000), nullable=False, unique=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("material_type", sa.String(50), nullable=False, server_default="pdf"),
        sa.Column("semester", sa.String(20), nullable=True),
        sa.Column("analysis_status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("analysis_task_id", sa.String(100), nullable=True),
        sa.Column("download_count", sa.Integer(), server_default=sa.text("0")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("materials")
    op.drop_table("refresh_tokens")
    op.drop_table("users")
