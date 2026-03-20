"""Add intent, exam_profile_json, reference_material_ids to disassembly_tasks

Revision ID: 0008
Revises: 0004
Create Date: 2026-03-18
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from alembic import op

revision = "0008"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "disassembly_tasks",
        sa.Column("intent", sa.String(20), nullable=True),
    )
    op.add_column(
        "disassembly_tasks",
        sa.Column("exam_profile_json", JSONB, nullable=True),
    )
    op.add_column(
        "disassembly_tasks",
        sa.Column("reference_material_ids", JSONB, nullable=True),
    )
    op.create_check_constraint(
        "ck_dtask_intent",
        "disassembly_tasks",
        "intent IS NULL OR intent IN ('learn', 'exam', 'review')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_dtask_intent", "disassembly_tasks", type_="check")
    op.drop_column("disassembly_tasks", "reference_material_ids")
    op.drop_column("disassembly_tasks", "exam_profile_json")
    op.drop_column("disassembly_tasks", "intent")
