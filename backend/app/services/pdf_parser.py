"""PDF → Markdown parser using pymupdf4llm + Vision LLM fallback.

Downloads PDF from S3, extracts per-page Markdown.
For scanned/image-based PDFs, uses Claude Vision via OpenRouter to OCR.
All temporary files are cleaned up via contextmanager.
"""

import asyncio
import base64
import json
import logging
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings
from app.services.s3_client import get_s3_client

logger = logging.getLogger(__name__)

# Vision extraction threshold: if avg chars per page < this, use Vision
VISION_THRESHOLD_CHARS_PER_PAGE = 50

# Limits
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_PAGES = 500


@dataclass
class PageMarkdown:
    """A single page's extracted Markdown."""
    page_num: int
    markdown: str
    char_count: int


@dataclass
class ParsedPDF:
    """Result of PDF → Markdown conversion."""
    pages: list[PageMarkdown] = field(default_factory=list)
    total_pages: int = 0
    total_chars: int = 0


class PDFParseError(Exception):
    """Raised when PDF parsing fails."""
    pass


@contextmanager
def _temp_pdf_path():
    """Yield a temporary file path, ensuring cleanup."""
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    try:
        yield tmp_path
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Failed to clean up temp file: %s", tmp_path)


def _download_pdf_from_s3(s3_key: str, dest: Path) -> int:
    """Download a PDF from S3 to a local path. Returns file size in bytes."""
    client = get_s3_client()
    try:
        # Check size before downloading
        head = client.head_object(Bucket=settings.s3_bucket_name, Key=s3_key)
        size = head.get("ContentLength", 0)
        if size > MAX_FILE_SIZE_BYTES:
            raise PDFParseError(
                f"PDF too large: {size / 1024 / 1024:.1f} MB (max {MAX_FILE_SIZE_BYTES / 1024 / 1024:.0f} MB)"
            )

        client.download_file(
            Bucket=settings.s3_bucket_name,
            Key=s3_key,
            Filename=str(dest),
        )
        return size
    except (ClientError, BotoCoreError) as e:
        raise PDFParseError(f"Failed to download PDF from S3: {e}") from e


def _extract_pages(pdf_path: Path) -> list[PageMarkdown]:
    """Extract per-page Markdown using pymupdf4llm."""
    try:
        import pymupdf4llm
    except ImportError as e:
        raise PDFParseError("pymupdf4llm not installed") from e

    try:
        # Extract per-page markdown
        pages_md = pymupdf4llm.to_markdown(
            str(pdf_path),
            page_chunks=True,  # Return list of per-page dicts
            show_progress=False,
        )
    except Exception as e:
        raise PDFParseError(f"pymupdf4llm extraction failed: {e}") from e

    if not pages_md:
        raise PDFParseError("PDF contains no extractable content")

    if len(pages_md) > MAX_PAGES:
        raise PDFParseError(
            f"PDF has {len(pages_md)} pages (max {MAX_PAGES})"
        )

    result = []
    for i, page_data in enumerate(pages_md):
        # pymupdf4llm returns dicts with 'text' key in page_chunks mode
        if isinstance(page_data, dict):
            md_text = page_data.get("text", "")
        else:
            md_text = str(page_data)

        result.append(PageMarkdown(
            page_num=i + 1,
            markdown=md_text,
            char_count=len(md_text),
        ))

    return result


VISION_SYSTEM_PROMPT = """You are transcribing a university lecture page for a study platform.
Extract ALL content from this page image as structured Markdown:

1. **Text**: Reproduce ALL text verbatim, preserving structure (headings, bullets, numbered lists)
2. **Equations**: Write mathematical equations in LaTeX notation ($inline$ or $$block$$)
3. **Diagrams/Figures**: Describe each diagram precisely — what it depicts, all labels, axes, values, relationships
4. **Tables**: Reproduce as markdown tables
5. **Handwriting**: Transcribe handwritten content as faithfully as possible, noting [unclear: ...] for hard-to-read parts

Be EXHAUSTIVE — do not skip ANY visible content. Output only the extracted markdown, no preamble."""

VISION_MODEL = "z-ai/glm-4.6-20251208"
MAX_VISION_CONCURRENT = 3


async def _extract_page_via_vision(
    page_num: int,
    img_b64: str,
    semaphore: asyncio.Semaphore,
) -> PageMarkdown:
    """Extract content from a single page image using Claude Vision."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=settings.openrouter_api_key,
        base_url="https://openrouter.ai/api/v1",
    )

    async with semaphore:
        logger.info("Vision extracting page %d...", page_num)
        response = await client.chat.completions.create(
            model=VISION_MODEL,
            max_tokens=4096,
            messages=[
                {"role": "system", "content": VISION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{img_b64}",
                            },
                        },
                        {
                            "type": "text",
                            "text": f"Transcribe this lecture page (page {page_num}).",
                        },
                    ],
                },
            ],
        )

        md_text = response.choices[0].message.content or ""
        logger.info(
            "Vision page %d: %d chars extracted",
            page_num,
            len(md_text),
        )
        return PageMarkdown(
            page_num=page_num,
            markdown=md_text,
            char_count=len(md_text),
        )


async def _extract_via_vision(
    pdf_path: Path,
    task_id: str | None = None,
) -> list[PageMarkdown]:
    """Extract all pages from an image-based PDF using Claude Vision.

    If task_id is provided, also uploads page PNGs to S3 for embedding in
    Specialist output (key: pages/{task_id}/page_{N}.png).
    """
    import fitz

    doc = fitz.open(str(pdf_path))
    semaphore = asyncio.Semaphore(MAX_VISION_CONCURRENT)

    # Render all pages to base64 PNG
    tasks = []
    for i in range(len(doc)):
        page = doc[i]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img_bytes = pix.tobytes("png")
        img_b64 = base64.b64encode(img_bytes).decode("ascii")

        # Upload page image to S3 for later embedding in lecture notes
        if task_id:
            _upload_page_image(task_id, i + 1, img_bytes)

        tasks.append(
            _extract_page_via_vision(i + 1, img_b64, semaphore)
        )

    results = await asyncio.gather(*tasks, return_exceptions=True)

    pages = []
    for r in results:
        if isinstance(r, Exception):
            logger.error("Vision extraction failed for a page: %s", r)
            # Add empty page instead of failing entire pipeline
            pages.append(PageMarkdown(page_num=0, markdown="", char_count=0))
        else:
            pages.append(r)

    # Sort by page number
    pages.sort(key=lambda p: p.page_num)
    doc.close()
    return pages


def _upload_page_image(task_id: str, page_num: int, img_bytes: bytes) -> str:
    """Upload a rendered page PNG to S3. Returns S3 key."""
    s3_key = f"pages/{task_id}/page_{page_num}.png"
    try:
        client = get_s3_client()
        client.put_object(
            Bucket=settings.s3_bucket_name,
            Key=s3_key,
            Body=img_bytes,
            ContentType="image/png",
        )
    except Exception as e:
        logger.warning("Failed to upload page image %s: %s", s3_key, e)
    return s3_key


def _classify_pdf(pages: list[PageMarkdown]) -> str:
    """Classify PDF as 'text' or 'image-based' based on extraction results."""
    if not pages:
        return "image-based"
    avg_chars = sum(p.char_count for p in pages) / len(pages)
    logger.info(
        "PDF classification: avg %.0f chars/page (threshold: %d)",
        avg_chars,
        VISION_THRESHOLD_CHARS_PER_PAGE,
    )
    return "text" if avg_chars >= VISION_THRESHOLD_CHARS_PER_PAGE else "image-based"


def _upload_parsed_to_s3(task_id: str, parsed: ParsedPDF) -> str:
    """Upload parsed pages JSON to S3. Returns the S3 key."""
    s3_key = f"parsed/{task_id}/pages.json"
    client = get_s3_client()

    payload = json.dumps(
        {
            "total_pages": parsed.total_pages,
            "total_chars": parsed.total_chars,
            "pages": [
                {
                    "page_num": p.page_num,
                    "markdown": p.markdown,
                    "char_count": p.char_count,
                }
                for p in parsed.pages
            ],
        },
        ensure_ascii=False,
    )

    try:
        client.put_object(
            Bucket=settings.s3_bucket_name,
            Key=s3_key,
            Body=payload.encode("utf-8"),
            ContentType="application/json",
        )
    except (ClientError, BotoCoreError) as e:
        raise PDFParseError(f"Failed to upload parsed result: {e}") from e

    return s3_key


async def parse_pdf_async(s3_key: str, task_id: str) -> ParsedPDF:
    """Main entry: download PDF → extract pages (with Vision fallback) → upload.

    For text-based PDFs, uses pymupdf4llm (fast, free).
    For scanned/image-based PDFs, falls back to Claude Vision (accurate, costs ~$0.20).

    Args:
        s3_key: S3 key of the uploaded PDF.
        task_id: Disassembly task ID (used for S3 output path).

    Returns:
        ParsedPDF with pages list, page count, and total chars.

    Raises:
        PDFParseError: On any failure (download, parse, upload).
    """
    with _temp_pdf_path() as tmp_path:
        logger.info("Downloading PDF: %s", s3_key)
        _download_pdf_from_s3(s3_key, tmp_path)

        # Step 1: Try text extraction
        logger.info("Extracting Markdown from PDF (text mode)...")
        pages = _extract_pages(tmp_path)

        # Step 2: Check if text extraction yielded meaningful content
        pdf_type = _classify_pdf(pages)
        if pdf_type == "image-based":
            logger.info(
                "PDF is image-based (avg %.0f chars/page), switching to Vision extraction...",
                sum(p.char_count for p in pages) / max(len(pages), 1),
            )
            pages = await _extract_via_vision(tmp_path, task_id=task_id)

    parsed = ParsedPDF(
        pages=pages,
        total_pages=len(pages),
        total_chars=sum(p.char_count for p in pages),
    )

    logger.info(
        "Parsed %d pages, %d total chars (method: %s)",
        parsed.total_pages,
        parsed.total_chars,
        pdf_type,
    )

    # Upload to S3
    s3_result_key = _upload_parsed_to_s3(task_id, parsed)
    logger.info("Uploaded parsed result to: %s", s3_result_key)

    return parsed


def parse_pdf(s3_key: str, task_id: str) -> ParsedPDF:
    """Sync wrapper for backward compatibility.

    NOTE: If called from an already-running event loop (e.g. async pipeline),
    use parse_pdf_async() directly instead.
    """
    return asyncio.run(parse_pdf_async(s3_key, task_id))


def load_parsed_pages(parsed_s3_key: str) -> ParsedPDF:
    """Load previously parsed pages from S3 (for idempotent re-runs)."""
    client = get_s3_client()
    try:
        response = client.get_object(
            Bucket=settings.s3_bucket_name,
            Key=parsed_s3_key,
        )
        data = json.loads(response["Body"].read().decode("utf-8"))
        return ParsedPDF(
            pages=[
                PageMarkdown(
                    page_num=p["page_num"],
                    markdown=p["markdown"],
                    char_count=p["char_count"],
                )
                for p in data["pages"]
            ],
            total_pages=data["total_pages"],
            total_chars=data["total_chars"],
        )
    except (ClientError, BotoCoreError, KeyError, json.JSONDecodeError) as e:
        raise PDFParseError(f"Failed to load parsed pages: {e}") from e
