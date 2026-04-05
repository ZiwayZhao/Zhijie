"""Add missing tables: user_llm_settings, knowledge_card_data, student_material_profiles.

These models were added after 0009 but never got a migration.

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-05
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── user_llm_settings ──
    op.create_table(
        "user_llm_settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True),
        sa.Column("llm_provider", sa.String(50), nullable=False, server_default="system"),
        sa.Column("llm_base_url", sa.Text, nullable=True),
        sa.Column("llm_api_key_encrypted", sa.Text, nullable=True),
        sa.Column("llm_model", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── knowledge_card_data ──
    op.create_table(
        "knowledge_card_data",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("task_id", UUID(as_uuid=True), sa.ForeignKey("disassembly_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_id", UUID(as_uuid=True), sa.ForeignKey("materials.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cards", JSONB, nullable=False),
        sa.Column("formula_sheet", sa.Text, nullable=False),
        sa.Column("error_taxonomy", sa.Text, nullable=False),
        sa.Column("model_used", sa.String(50), nullable=False),
        sa.Column("prompt_version", sa.String(20), nullable=False, server_default="cards_v1"),
        sa.Column("input_tokens", sa.Integer, nullable=False),
        sa.Column("output_tokens", sa.Integer, nullable=False),
        sa.Column("latency_ms", sa.Integer, nullable=False),
        sa.Column("run_id", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("task_id", name="uq_knowledge_card_task"),
    )

    # ── student_material_profiles ──
    op.create_table(
        "student_material_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("material_id", UUID(as_uuid=True), sa.ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("self_report", JSONB, nullable=False, server_default="{}"),
        sa.Column("ai_inference", JSONB, nullable=False, server_default="{}"),
        sa.Column("session_memories", JSONB, nullable=False, server_default="[]"),
        sa.Column("preferred_mode", sa.String(30), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "material_id", name="uq_student_material_profile"),
    )


def downgrade() -> None:
    op.drop_table("student_material_profiles")
    op.drop_table("knowledge_card_data")
    op.drop_table("user_llm_settings")
