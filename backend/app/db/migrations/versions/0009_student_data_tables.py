"""Add student data tables for localStorage→backend sync.

New tables:
  - student_profiles: BKT learning profile
  - module_masteries: per-module mastery state
  - flashcard_notes: card content
  - flashcard_cards: FSRS scheduling state
  - flashcard_review_logs: review audit trail
  - pdf_annotations: highlight/comment data
  - tutor_sessions: chat history
  - agenda_todos: user tasks
  - exam_profiles: exam metadata (replaces in-memory dict)
  - sse_tickets: short-lived SSE auth tokens

Revision ID: 0009
Revises: 0008
Create Date: 2026-03-21
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID, ARRAY
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── student_profiles ────────────────────────────────────
    op.create_table(
        "student_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("goal", sa.String(20), nullable=True),
        sa.Column("total_study_minutes", sa.Integer, nullable=False,
                  server_default="0"),
        sa.Column("streak_days", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_active_date", sa.String(10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", name="uq_student_profile_user"),
    )

    # ── module_masteries ────────────────────────────────────
    op.create_table(
        "module_masteries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("profile_id", UUID(as_uuid=True),
                  sa.ForeignKey("student_profiles.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("module_id", sa.String(200), nullable=False),
        sa.Column("module_name", sa.String(500), nullable=False),
        sa.Column("course_id", sa.String(200), nullable=False),
        sa.Column("mastery", sa.Float, nullable=False, server_default="0.3"),
        sa.Column("total_attempts", sa.Integer, nullable=False,
                  server_default="0"),
        sa.Column("correct_attempts", sa.Integer, nullable=False,
                  server_default="0"),
        sa.Column("last_updated", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.UniqueConstraint("profile_id", "module_id",
                            name="uq_mastery_profile_module"),
    )

    # ── flashcard_notes ─────────────────────────────────────
    op.create_table(
        "flashcard_notes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", sa.String(200), nullable=False),
        sa.Column("card_type", sa.String(30), nullable=False,
                  server_default="basic"),
        sa.Column("front", sa.Text, nullable=False),
        sa.Column("back", sa.Text, nullable=False),
        sa.Column("extra", sa.Text, nullable=True),
        sa.Column("tags", ARRAY(sa.String(100)), nullable=False,
                  server_default="{}"),
        sa.Column("generated_by", sa.String(20), nullable=False,
                  server_default="ai"),
        sa.Column("source_material_id", sa.String(200), nullable=True),
        sa.Column("source_module_id", sa.String(200), nullable=True),
        sa.Column("source_page", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
    )
    op.create_index("idx_flashcard_notes_user_course", "flashcard_notes",
                    ["user_id", "course_id"])

    # ── flashcard_cards ─────────────────────────────────────
    op.create_table(
        "flashcard_cards",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("note_id", UUID(as_uuid=True),
                  sa.ForeignKey("flashcard_notes.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("due", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("stability", sa.Float, nullable=False, server_default="0"),
        sa.Column("difficulty", sa.Float, nullable=False, server_default="0"),
        sa.Column("state", sa.String(20), nullable=False,
                  server_default="new"),
        sa.Column("reps", sa.Integer, nullable=False, server_default="0"),
        sa.Column("lapses", sa.Integer, nullable=False, server_default="0"),
        sa.Column("consecutive_again", sa.Integer, nullable=False,
                  server_default="0"),
        sa.Column("consecutive_easy", sa.Integer, nullable=False,
                  server_default="0"),
        sa.Column("average_response_ms", sa.Integer, nullable=True),
        sa.Column("fsrs_card_json", JSONB, nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
    )

    # ── flashcard_review_logs ───────────────────────────────
    op.create_table(
        "flashcard_review_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("card_id", UUID(as_uuid=True),
                  sa.ForeignKey("flashcard_cards.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rating", sa.Integer, nullable=False),
        sa.Column("response_ms", sa.Integer, nullable=True),
        sa.Column("fsrs_log_json", JSONB, nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index("idx_review_logs_card", "flashcard_review_logs",
                    ["card_id", "reviewed_at"])

    # ── pdf_annotations ─────────────────────────────────────
    op.create_table(
        "pdf_annotations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_id", UUID(as_uuid=True),
                  sa.ForeignKey("materials.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("client_id", sa.String(100), nullable=False),
        sa.Column("highlight_data", JSONB, nullable=False),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("comment", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "material_id", "client_id",
                            name="uq_annotation_user_material_client"),
    )
    op.create_index("idx_annotations_user_material", "pdf_annotations",
                    ["user_id", "material_id"])

    # ── tutor_sessions ──────────────────────────────────────
    op.create_table(
        "tutor_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_id", UUID(as_uuid=True),
                  sa.ForeignKey("materials.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("messages", JSONB, nullable=False, server_default="[]"),
        sa.Column("message_count", sa.Integer, nullable=False,
                  server_default="0"),
        sa.Column("last_activity_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "material_id",
                            name="uq_tutor_session_user_material"),
    )

    # ── agenda_todos ────────────────────────────────────────
    op.create_table(
        "agenda_todos",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", sa.String(100), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("completed", sa.Boolean, nullable=False,
                  server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "client_id",
                            name="uq_todo_user_client"),
    )

    # ── exam_profiles ───────────────────────────────────────
    op.create_table(
        "exam_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", sa.String(200), nullable=False),
        sa.Column("exam_date", sa.String(10), nullable=True),
        sa.Column("duration_minutes", sa.Integer, nullable=True),
        sa.Column("is_open_book", sa.Boolean, nullable=True),
        sa.Column("calculator_allowed", sa.Boolean, nullable=True),
        sa.Column("total_points", sa.Integer, nullable=False,
                  server_default="100"),
        sa.Column("question_distribution", JSONB, nullable=False,
                  server_default="[]"),
        sa.Column("source", sa.String(20), nullable=False,
                  server_default="default"),
        sa.Column("analyzed_exam_s3_key", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "course_id",
                            name="uq_exam_profile_user_course"),
    )

    # ── sse_tickets ─────────────────────────────────────────
    op.create_table(
        "sse_tickets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_type", sa.String(30), nullable=False),
        sa.Column("resource_id", UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.Text, nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
    )
    op.create_index("idx_sse_tickets_hash", "sse_tickets", ["token_hash"])
    op.create_index("idx_sse_tickets_expires", "sse_tickets", ["expires_at"])


def downgrade() -> None:
    op.drop_table("sse_tickets")
    op.drop_table("exam_profiles")
    op.drop_table("agenda_todos")
    op.drop_table("tutor_sessions")
    op.drop_table("pdf_annotations")
    op.drop_table("flashcard_review_logs")
    op.drop_table("flashcard_cards")
    op.drop_table("flashcard_notes")
    op.drop_table("module_masteries")
    op.drop_table("student_profiles")
