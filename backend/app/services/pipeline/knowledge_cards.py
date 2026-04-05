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
MODEL = "glm-4.7"


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

知识卡片类型（8种，尽可能覆盖每种类型，总计12-20张）：

1. **definition（定义卡）** — 关键术语
   - content_markdown: 严格定义 + 直观解释 + 使用场景
   - 示例: "选择率 (Selectivity)"

2. **theorem（定理卡）** — 重要定理/引理/性质
   - content_markdown: 定理声明（LaTeX）+ 证明思路/关键步骤 + 适用条件
   - 示例: "Church-Turing 论题"

3. **formula（公式卡）** — 需要记忆的公式
   - content_markdown: 居中主公式（$$...$$）+ 使用条件和注意事项
   - symbols: 必填，每个变量一条
   - 示例: "Block Nested Loop Join 代价公式"

4. **example（例题卡）** — 典型例题
   - content_markdown: 题目 + 分步解题过程 + 变式提示
   - 示例: "构造识别语言 L 的图灵机"

5. **comparison（对比卡）** — 容易混淆的概念
   - content_markdown: 表格呈现差异（维度 | 概念A | 概念B）
   - 示例: "图灵可判定 vs 图灵可识别"

6. **pitfall（陷阱卡）** — 常见错误
   - content_markdown: 错误做法 + 正确做法 + 记忆口诀/助记
   - 示例: "非确定TM≠并行计算"

7. **method（方法卡）** — 解题方法/算法策略
   - content_markdown: 方法名称 + 适用场景 + 步骤概要 + 复杂度
   - 示例: "对角化论证法"

8. **procedure（流程卡）** — 多步骤过程
   - content_markdown: 编号步骤 + 每步简要说明
   - 示例: "NTM→DTM 等价构造"

难度星级分布要求：
- 1-2星（基础）：至少3张，覆盖核心定义和基本概念
- 3星（中等）：4-6张
- 4-5星（进阶）：3-5张，覆盖复杂定理和综合应用

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
