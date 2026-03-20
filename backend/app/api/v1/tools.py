"""Learning tools endpoints — structured LLM outputs (JSON, non-streaming)."""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.models.user import User
from app.services.llm_client import get_llm_client, LLMError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tools", tags=["tools"])

TOOLS_MODEL = "z-ai/glm-5-turbo-20260315"
MAX_INPUT_CHARS = 8000


def _truncate(text: str, max_chars: int = MAX_INPUT_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n…（内容过长，已截断）"


# ── Response schemas (Pydantic → function calling) ────────────────

class SummaryOutput(BaseModel):
    summary: str = Field(description="精讲内容总结")
    key_points: list[str] = Field(description="核心要点列表")
    word_count: int = Field(description="总结字数")


class ExamPoint(BaseModel):
    concept: str = Field(description="考点概念名称")
    frequency: Literal["high", "medium", "low"] = Field(
        description="出现频率"
    )
    exam_types: list[str] = Field(
        description="可能的考查题型，如选择、填空、计算、论述"
    )
    tip: str = Field(description="备考提示")


class ExamPointsOutput(BaseModel):
    points: list[ExamPoint] = Field(description="考点列表")


class MistakeItem(BaseModel):
    concept: str = Field(description="易错概念")
    common_mistake: str = Field(description="常见错误描述")
    correct_understanding: str = Field(description="正确理解")
    confusion_pairs: list[str] = Field(
        default_factory=list, description="易混淆的相关概念"
    )


class MistakeAnalysisOutput(BaseModel):
    items: list[MistakeItem] = Field(description="易错点列表")


class ConceptNode(BaseModel):
    id: str = Field(description="节点ID，如 c1, c2")
    name: str = Field(description="概念名称")
    description: str = Field(description="简要描述")


class ConceptEdge(BaseModel):
    source: str = Field(description="源节点ID")
    target: str = Field(description="目标节点ID")
    relation: str = Field(description="关系描述，如：依赖、包含、对比")


class ConceptMapOutput(BaseModel):
    nodes: list[ConceptNode] = Field(description="概念节点列表")
    edges: list[ConceptEdge] = Field(description="概念关系列表")


class ReadingNotesOutput(BaseModel):
    title: str = Field(description="笔记标题")
    sections: list[dict] = Field(
        description="分段笔记，每段有 heading 和 content 字段"
    )
    key_formulas: list[str] = Field(
        default_factory=list, description="关键公式（LaTeX 格式）"
    )
    summary: str = Field(description="总结概要")


# ── Request models ────────────────────────────────────────────────

class SummaryRequest(BaseModel):
    specialist_markdown: str
    style: Literal["brief", "detailed"] = "brief"


class ExamPointsRequest(BaseModel):
    specialist_markdown: str
    module_name: str


class MistakeAnalysisRequest(BaseModel):
    specialist_markdown: str
    module_name: str = ""


class ConceptMapRequest(BaseModel):
    specialist_markdown: str
    module_name: str = ""


class ReadingNotesRequest(BaseModel):
    specialist_markdown: str
    module_name: str = ""


# ── Shared helper ─────────────────────────────────────────────────

async def _call_tool(system: str, user_content: str, schema, prompt_version: str):
    """Call LLM with structured output and return parsed data."""
    client = get_llm_client()
    try:
        result = await client.structured_output(
            model=TOOLS_MODEL,
            system=system,
            messages=[{"role": "user", "content": user_content}],
            response_schema=schema,
            prompt_version=prompt_version,
            max_tokens=4096,
        )
        return result.data
    except LLMError as e:
        logger.exception("Tool LLM error: %s", e)
        raise HTTPException(status_code=502, detail=f"AI 服务暂时不可用：{e}")


# ── POST /tools/summary ──────────────────────────────────────────

@router.post("/summary", response_model=SummaryOutput)
async def tool_summary(
    body: SummaryRequest,
    user: User = Depends(get_current_user),
):
    """Generate a summary of specialist markdown content."""
    style_instr = (
        "用 3-5 句话简洁总结" if body.style == "brief"
        else "用 8-12 句话详细总结，覆盖所有关键概念"
    )
    system = (
        "你是一位学术总结专家。根据给定的课程精讲内容，生成结构化总结。\n"
        f"要求：{style_instr}。提取 3-8 个核心要点。使用中文。"
    )
    return await _call_tool(
        system=system,
        user_content=_truncate(body.specialist_markdown),
        schema=SummaryOutput,
        prompt_version="summary_v1",
    )


# ── POST /tools/exam-points ──────────────────────────────────────

@router.post("/exam-points", response_model=ExamPointsOutput)
async def tool_exam_points(
    body: ExamPointsRequest,
    user: User = Depends(get_current_user),
):
    """Extract exam-relevant key points from specialist content."""
    system = (
        "你是一位大学考试辅导专家。分析给定的课程精讲内容，"
        "提取 5-10 个最可能出现在考试中的知识点。\n"
        "对每个考点评估出题频率（high/medium/low）、"
        "可能的题型（选择/填空/计算/论述），并给出备考提示。\n"
        f"当前模块：{body.module_name}\n"
        "使用中文回复。"
    )
    return await _call_tool(
        system=system,
        user_content=_truncate(body.specialist_markdown),
        schema=ExamPointsOutput,
        prompt_version="exam_points_v1",
    )


# ── POST /tools/mistake-analysis ─────────────────────────────────

@router.post("/mistake-analysis", response_model=MistakeAnalysisOutput)
async def tool_mistake_analysis(
    body: MistakeAnalysisRequest,
    user: User = Depends(get_current_user),
):
    """Analyze common mistakes and confusable concepts."""
    system = (
        "你是一位经验丰富的大学助教。分析给定的课程内容，"
        "列出 4-8 个学生最常犯的错误和易混淆的概念。\n"
        "对每个易错点说明：常见错误、正确理解、以及容易混淆的相关概念。\n"
        f"当前模块：{body.module_name}\n"
        "使用中文回复。"
    )
    return await _call_tool(
        system=system,
        user_content=_truncate(body.specialist_markdown),
        schema=MistakeAnalysisOutput,
        prompt_version="mistakes_v1",
    )


# ── POST /tools/concept-map ──────────────────────────────────────

@router.post("/concept-map", response_model=ConceptMapOutput)
async def tool_concept_map(
    body: ConceptMapRequest,
    user: User = Depends(get_current_user),
):
    """Generate a concept map (nodes + edges) from specialist content."""
    system = (
        "你是一位知识图谱专家。从给定的课程内容中提取概念节点和关系。\n"
        "要求：\n"
        "- 提取 5-15 个核心概念作为节点\n"
        "- 每个节点用短 id（如 c1, c2）和名称标识\n"
        "- 识别节点间的关系（依赖、包含、对比、推导等）\n"
        f"当前模块：{body.module_name}\n"
        "使用中文回复。"
    )
    return await _call_tool(
        system=system,
        user_content=_truncate(body.specialist_markdown),
        schema=ConceptMapOutput,
        prompt_version="concept_map_v1",
    )


# ── POST /tools/reading-notes ────────────────────────────────────

@router.post("/reading-notes", response_model=ReadingNotesOutput)
async def tool_reading_notes(
    body: ReadingNotesRequest,
    user: User = Depends(get_current_user),
):
    """Generate structured reading notes from specialist content."""
    system = (
        "你是一位学术笔记整理专家。将给定的课程精讲内容整理为结构化精读笔记。\n"
        "要求：\n"
        "- 按逻辑分段，每段有标题和内容\n"
        "- 提取关键公式（用 LaTeX 格式）\n"
        "- 最后给出总结概要\n"
        f"当前模块：{body.module_name}\n"
        "使用中文回复。sections 中每个元素应包含 heading 和 content 两个字符串字段。"
    )
    return await _call_tool(
        system=system,
        user_content=_truncate(body.specialist_markdown),
        schema=ReadingNotesOutput,
        prompt_version="reading_notes_v1",
    )
