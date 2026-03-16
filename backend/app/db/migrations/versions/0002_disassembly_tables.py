"""Disassembly pipeline tables: tasks, modules, dependencies, specialist, quiz

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── disassembly_tasks ─────────────────────────────────────
    op.create_table(
        "disassembly_tasks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "material_id",
            UUID(as_uuid=True),
            sa.ForeignKey("materials.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "phase",
            sa.String(20),
            nullable=False,
            server_default="init",
        ),
        sa.Column(
            "progress",
            sa.Numeric(4, 3),
            nullable=False,
            server_default="0.000",
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("error_phase", sa.String(20), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("pdf_page_count", sa.Integer(), nullable=True),
        sa.Column("parsed_s3_key", sa.String(1000), nullable=True),
        sa.Column("celery_task_id", sa.String(100), nullable=True),
        sa.Column("config_json", JSONB, server_default="{}"),
        sa.Column("run_id", sa.String(64), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        # Constraints
        sa.CheckConstraint(
            "status IN ('pending','running','completed','failed','cancelled')",
            name="ck_dtask_status",
        ),
        sa.CheckConstraint(
            "phase IN ('init','parsing','cartographer','specialist','examiner','done')",
            name="ck_dtask_phase",
        ),
        sa.UniqueConstraint("run_id", name="uq_dtask_run_id"),
    )
    op.create_index(
        "idx_dtasks_user_created",
        "disassembly_tasks",
        ["user_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "idx_dtasks_material",
        "disassembly_tasks",
        ["material_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "idx_dtasks_status_running",
        "disassembly_tasks",
        ["status"],
        postgresql_where=sa.text("status IN ('pending','running')"),
    )
    op.create_index(
        "idx_dtask_material_active",
        "disassembly_tasks",
        ["material_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending','running')"),
    )

    # ── disassembly_modules ───────────────────────────────────
    op.create_table(
        "disassembly_modules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id",
            UUID(as_uuid=True),
            sa.ForeignKey("disassembly_tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("page_range_start", sa.Integer(), nullable=False),
        sa.Column("page_range_end", sa.Integer(), nullable=False),
        sa.Column(
            "exam_weight",
            sa.String(20),
            nullable=False,
            server_default="medium",
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        # Constraints
        sa.CheckConstraint(
            "exam_weight IN ('high','medium','low')",
            name="ck_dmodule_exam_weight",
        ),
        sa.CheckConstraint(
            "page_range_start >= 1 AND page_range_end >= page_range_start",
            name="ck_dmodule_page_range",
        ),
        sa.UniqueConstraint("task_id", "sort_order", name="uq_dmodule_task_sort"),
    )
    op.create_index(
        "idx_dmodules_task_sort",
        "disassembly_modules",
        ["task_id", "sort_order"],
    )

    # ── module_dependencies ───────────────────────────────────
    op.create_table(
        "module_dependencies",
        sa.Column(
            "module_id",
            UUID(as_uuid=True),
            sa.ForeignKey("disassembly_modules.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "depends_on_id",
            UUID(as_uuid=True),
            sa.ForeignKey("disassembly_modules.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.CheckConstraint(
            "module_id != depends_on_id",
            name="ck_moddep_no_self_ref",
        ),
    )

    op.create_index(
        "idx_moddep_depends_on",
        "module_dependencies",
        ["depends_on_id"],
    )

    # ── specialist_outputs ────────────────────────────────────
    op.create_table(
        "specialist_outputs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "module_id",
            UUID(as_uuid=True),
            sa.ForeignKey("disassembly_modules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("markdown_s3_key", sa.String(1000), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column(
            "key_concepts",
            ARRAY(sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("exam_traps", ARRAY(sa.Text()), server_default="{}"),
        sa.Column("self_test_questions", JSONB, nullable=True),
        sa.Column("prompt_version", sa.String(20), nullable=False),
        sa.Column("model_used", sa.String(50), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("module_id", name="uq_specialist_module"),
    )

    # ── quiz_data ─────────────────────────────────────────────
    op.create_table(
        "quiz_data",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id",
            UUID(as_uuid=True),
            sa.ForeignKey("disassembly_tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "schema_version",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
        sa.Column("questions", JSONB, nullable=False),
        sa.Column("total_questions", sa.Integer(), nullable=False),
        sa.Column(
            "source_module_ids",
            ARRAY(UUID(as_uuid=True)),
            nullable=False,
        ),
        sa.Column("prompt_version", sa.String(20), nullable=False),
        sa.Column("model_used", sa.String(50), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("task_id", name="uq_quiz_task"),
    )


def downgrade() -> None:
    op.drop_table("quiz_data")
    op.drop_table("specialist_outputs")
    op.drop_table("module_dependencies")
    op.drop_table("disassembly_modules")
    op.drop_table("disassembly_tasks")
