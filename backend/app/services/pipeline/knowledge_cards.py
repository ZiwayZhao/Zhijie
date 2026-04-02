"""Knowledge Card Agent — generates structured knowledge cards from specialist output.

Input: Specialist summaries, key concepts, exam traps, formulas per module
Output: KnowledgeCardResult — cards, formula sheet, error taxonomy
"""

import logging

from pydantic import BaseModel

from app.schemas.knowledge_card import KnowledgeCardResult
from app.services.llm_client import LLMClient, LLMResult

logger = logging.getLogger(__name__)

PROMPT_VERSION = "cards_v1"
MODEL = "hunyuan-turbos"


# ── Lightweight input DTO ────────────────────────────────────────

class KnowledgeCardModuleInput(BaseModel):
    """Minimal input per module — avoids sending full markdown."""
    module_name: str
    summary: str
    key_concepts: list[str]
    exam_traps: list[str] = []
    formulas_and_examples: str | None = None


# ── System Prompt ────────────────────────────────────────────────

SYSTEM_PROMPT = """\
你是一位学术教材编辑，专门制作知识卡片。根据精讲内容生成结构化知识卡片。

知识卡片类型（每种至少生成1张，总计6-15张）：

1. **formula（公式卡）** — 用于需要记忆的公式
   - content_markdown: 居中显示主公式（$$...$$），下方列出使用条件和注意事项
   - symbols: 必填，每个变量一条
   - 示例标题: "Block Nested Loop Join 代价公式"

2. **comparison（对比卡）** — 用于容易混淆的概念
   - content_markdown: 用表格呈现 "错误做法/理解" vs "正确做法/理解" vs "混淆原因"
   - 示例标题: "聚簇索引 vs 非聚簇索引代价"

3. **definition（定义卡）** — 用于关键术语
   - content_markdown: 严格定义 + 直观解释 + 使用场景
   - 示例标题: "选择率 (Selectivity)"

4. **procedure（流程卡）** — 用于多步骤过程
   - content_markdown: 编号步骤 + 每步简要说明
   - 示例标题: "GRACE Hash Join 执行流程"

额外产出：
- formula_sheet_markdown: 将所有模块的关键公式汇总到一页，按模块分节，\
每个公式附带一行使用条件说明
- error_taxonomy_markdown: 将所有考试陷阱整理为三列表格：\
错误做法 | 正确做法 | 易混原因

使用 LaTeX 数学公式（$$...$$ 或 $...$）。所有内容用中文。"""


# ── Main entry point ─────────────────────────────────────────────

async def run_knowledge_cards(
    specialist_inputs: list[tuple[int, KnowledgeCardModuleInput]],
    llm: LLMClient,
    run_id: str,
) -> LLMResult:
    """Generate knowledge cards from specialist output.

    Args:
        specialist_inputs: List of (sort_order, KnowledgeCardModuleInput).
        llm: LLMClient instance.
        run_id: Execution run ID.

    Returns:
        LLMResult with KnowledgeCardResult in .data
    """
    # Build user message from specialist data
    user_parts: list[str] = []
    for sort_order, spec in specialist_inputs:
        part = f"## Module {sort_order + 1}: {spec.module_name}\n"
        part += f"**摘要**: {spec.summary}\n"
        if spec.key_concepts:
            part += f"**核心概念**: {', '.join(spec.key_concepts)}\n"
        if spec.exam_traps:
            part += "**考试陷阱**:\n" + "\n".join(f"- {t}" for t in spec.exam_traps) + "\n"
        if spec.formulas_and_examples:
            part += f"**公式与例题**:\n{spec.formulas_and_examples}\n"
        user_parts.append(part)

    user_message = "请根据以下精讲内容生成知识卡片：\n\n" + "\n---\n".join(user_parts)

    result = await llm.structured_output(
        model=MODEL,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
        response_schema=KnowledgeCardResult,
        prompt_version=PROMPT_VERSION,
        max_tokens=16384,
        run_id=run_id,
    )

    logger.info(
        "Knowledge cards generated: %d cards (%d in, %d out, %dms)",
        len(result.data.cards),
        result.input_tokens,
        result.output_tokens,
        result.latency_ms,
    )
    return result
