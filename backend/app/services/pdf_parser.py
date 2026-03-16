"""PDF → Markdown parser using pymupdf4llm.

Downloads PDF from S3, extracts per-page Markdown, uploads result to S3.
All temporary files are cleaned up via contextmanager.
"""

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


def parse_pdf(s3_key: str, task_id: str) -> ParsedPDF:
    """Main entry: download PDF → extract pages → upload result → return metadata.

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

        logger.info("Extracting Markdown from PDF...")
        pages = _extract_pages(tmp_path)

    parsed = ParsedPDF(
        pages=pages,
        total_pages=len(pages),
        total_chars=sum(p.char_count for p in pages),
    )

    logger.info(
        "Parsed %d pages, %d total chars",
        parsed.total_pages,
        parsed.total_chars,
    )

    # Upload to S3
    s3_result_key = _upload_parsed_to_s3(task_id, parsed)
    logger.info("Uploaded parsed result to: %s", s3_result_key)

    return parsed


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
