"""ExamAnalyzer -- extracts exam format from past exam PDFs.

Uses OpenDataLoader for PDF extraction + Vision LLM for format analysis.
Output: ExamProfile with question type distribution.
"""

import asyncio
import base64
import json
import logging
import shutil
import tempfile
from pathlib import Path

from pydantic import BaseModel

from app.core.config import settings
from app.schemas.exam_profile import ExamProfile, QuestionTypeDistribution
from app.services.s3_client import get_s3_client

logger = logging.getLogger(__name__)

# Vision model for exam analysis
EXAM_ANALYSIS_MODEL = "anthropic/claude-sonnet-4.5"

# Max pages to send for analysis (first N pages usually contain format info)
MAX_ANALYSIS_PAGES = 6


# ── LLM Response Models ─────────────────────────────────────────

class AnalyzedQuestionType(BaseModel):
    """Single question type detected in a past exam."""
    type_name: str          # Chinese display name (e.g. "选择题")
    question_type: str      # Canonical key: mcq | fill_blank | true_false | short_answer | calculation | essay
    count: int              # Number of questions of this type
    points_each: float      # Points per question
    total_points: float     # Total points for this section


class ExamAnalysisResult(BaseModel):
    """LLM structured output for exam format analysis."""
    exam_duration_minutes: int | None = None
    is_open_book: bool | None = None
    total_points: int = 100
    question_types: list[AnalyzedQuestionType]


# ── System Prompt ────────────────────────────────────────────────

EXAM_ANALYSIS_SYSTEM = """你是一位大学考试分析专家。你的任务是分析真实考试试卷，提取题型格式和分值分布。

请仔细阅读试卷图片/文本，识别以下信息：

## 要识别的信息

1. **考试时长**：试卷上是否标注了考试时间（如 "120分钟"）？
2. **开/闭卷**：是否标注了开卷、闭卷？
3. **总分**：试卷总分（通常 100 分或 150 分）
4. **题型分布**：每种题型的名称、数量、每题分值、总分值

## 题型映射规则

请将试卷中的题型映射到以下标准类型：
- "选择题" / "单选题" / "多选题" → question_type: "mcq"
- "填空题" → question_type: "fill_blank"
- "判断题" / "是非题" → question_type: "true_false"
- "简答题" / "名词解释" / "问答题" → question_type: "short_answer"
- "计算题" / "证明题" / "推导题" / "编程题" → question_type: "calculation"
- "论述题" / "综合题" / "案例分析" → question_type: "essay"

## 注意事项
- 如果试卷是扫描件或照片，尽力识别文字内容
- 如果某些信息无法确定，相应字段返回 null
- 每题分值如果不统一，取平均值
- 如果无法确定题目数量，根据试卷结构合理估计
- 确保所有题型的 total_points 之和等于总分"""


# ── Core Functions ───────────────────────────────────────────────

def _download_from_s3(s3_key: str, dest: Path) -> int:
    """Download file from S3. Returns file size in bytes."""
    from botocore.exceptions import BotoCoreError, ClientError

    client = get_s3_client()
    try:
        head = client.head_object(Bucket=settings.s3_bucket_name, Key=s3_key)
        size = head.get("ContentLength", 0)
        client.download_file(
            Bucket=settings.s3_bucket_name,
            Key=s3_key,
            Filename=str(dest),
        )
        return size
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"Failed to download from S3: {e}") from e


def _render_pdf_pages_to_base64(pdf_path: Path, max_pages: int) -> list[str]:
    """Render first N pages of a PDF to base64 PNG images."""
    import fitz

    doc = fitz.open(str(pdf_path))
    images: list[str] = []
    page_count = min(len(doc), max_pages)

    for i in range(page_count):
        page = doc[i]
        # 2x resolution for better OCR
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img_bytes = pix.tobytes("png")
        images.append(base64.b64encode(img_bytes).decode("ascii"))

    doc.close()
    logger.info("Rendered %d/%d pages to images", page_count, len(doc))
    return images


def _build_analysis_messages(
    page_images: list[str],
    markdown_text: str | None,
) -> list[dict]:
    """Build LLM messages with page images and optional extracted text."""
    content: list[dict] = []

    # Add page images
    for i, img_b64 in enumerate(page_images):
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{img_b64}"},
        })

    # Add extracted text context if available
    text_instruction = "请分析这份考试试卷，提取题型格式和分值分布。"
    if markdown_text:
        text_instruction += (
            f"\n\n以下是 OCR 提取的试卷文本（供参考，以图片内容为准）：\n\n{markdown_text[:3000]}"
        )

    content.append({"type": "text", "text": text_instruction})

    return [{"role": "user", "content": content}]


def _analysis_to_exam_profile(
    result: ExamAnalysisResult,
    s3_key: str,
) -> ExamProfile:
    """Convert LLM analysis result to ExamProfile."""
    total_points = result.total_points or 100

    distribution: list[QuestionTypeDistribution] = []
    for qt in result.question_types:
        pct = qt.total_points / total_points if total_points > 0 else 0
        distribution.append(QuestionTypeDistribution(
            question_type=qt.question_type,
            count=qt.count,
            points_each=qt.points_each,
            total_points=qt.total_points,
            percentage=round(pct, 4),
        ))

    return ExamProfile(
        duration_minutes=result.exam_duration_minutes,
        is_open_book=result.is_open_book,
        total_points=total_points,
        question_distribution=distribution,
        source="exam_analysis",
        analyzed_exam_s3_key=s3_key,
    )


def _default_exam_profile(s3_key: str) -> ExamProfile:
    """Return a sensible default when analysis fails."""
    return ExamProfile(
        total_points=100,
        question_distribution=[
            QuestionTypeDistribution(
                question_type="mcq", count=20,
                points_each=2, total_points=40, percentage=0.40,
            ),
            QuestionTypeDistribution(
                question_type="short_answer", count=4,
                points_each=10, total_points=40, percentage=0.40,
            ),
            QuestionTypeDistribution(
                question_type="fill_blank", count=10,
                points_each=2, total_points=20, percentage=0.20,
            ),
        ],
        source="default",
        analyzed_exam_s3_key=s3_key,
    )


async def analyze_past_exam(s3_key: str, task_id: str) -> ExamProfile:
    """Analyze an uploaded past exam PDF to extract ExamProfile.

    Pipeline:
    1. Download PDF from S3
    2. Try OpenDataLoader extraction for text (optional)
    3. Render first pages as images for Vision LLM
    4. Send to Vision LLM with structured output
    5. Convert to ExamProfile

    Args:
        s3_key: S3 key of the uploaded past exam PDF.
        task_id: Unique ID for this analysis task.

    Returns:
        ExamProfile with detected question distribution.
    """
    tmp_dir = Path(tempfile.mkdtemp(prefix=f"exam_{task_id}_"))
    pdf_path = tmp_dir / "exam.pdf"

    try:
        # Step 1: Download from S3
        logger.info("Downloading past exam: %s", s3_key)
        _download_from_s3(s3_key, pdf_path)

        # Step 2: Try ODL extraction for supplementary text
        markdown_text: str | None = None
        if settings.odl_enabled:
            try:
                from app.services.odl_pdf_parser import extract_with_odl, is_odl_available
                if is_odl_available():
                    odl_result = extract_with_odl(pdf_path, tmp_dir / "odl_out")
                    if odl_result.markdown.strip():
                        markdown_text = odl_result.markdown
                        logger.info("ODL extracted %d chars from exam", len(markdown_text))
            except Exception as e:
                logger.warning("ODL extraction failed for exam, continuing with vision only: %s", e)

        # Step 3: Render pages to images
        page_images = _render_pdf_pages_to_base64(pdf_path, MAX_ANALYSIS_PAGES)
        if not page_images:
            logger.warning("No pages rendered, returning default profile")
            return _default_exam_profile(s3_key)

        # Step 4: Vision LLM analysis with structured output
        messages = _build_analysis_messages(page_images, markdown_text)

        from app.services.llm_client import get_llm_client, LLMError

        llm = get_llm_client()
        try:
            result = await llm.structured_output(
                model=EXAM_ANALYSIS_MODEL,
                system=EXAM_ANALYSIS_SYSTEM,
                messages=messages,
                response_schema=ExamAnalysisResult,
                prompt_version="exam_analyzer_v1",
                max_tokens=2048,
                run_id=task_id,
            )
            analysis: ExamAnalysisResult = result.data
            logger.info(
                "Exam analysis complete: %d question types detected, "
                "%d total points, %s tokens used",
                len(analysis.question_types),
                analysis.total_points,
                result.input_tokens + result.output_tokens,
            )
        except LLMError as e:
            logger.error("LLM exam analysis failed: %s", e)
            return _default_exam_profile(s3_key)

        # Step 5: Convert to ExamProfile
        if not analysis.question_types:
            logger.warning("No question types detected, returning default")
            return _default_exam_profile(s3_key)

        profile = _analysis_to_exam_profile(analysis, s3_key)
        logger.info(
            "ExamProfile generated: %d types, %d total points, source=%s",
            len(profile.question_distribution),
            profile.total_points,
            profile.source,
        )
        return profile

    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception as e:
            logger.warning("Failed to clean up exam temp dir: %s", e)
