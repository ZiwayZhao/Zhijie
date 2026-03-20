"""OpenDataLoader PDF parser — extract text + images + bounding boxes.

Uses OpenDataLoader (Java-based) for high-quality PDF extraction:
- Correct reading order (XY-Cut algorithm)
- Image extraction with bounding boxes
- Table detection
- LaTeX formula preservation

Images are sent to a vision LLM for description generation,
then descriptions are merged back into the per-page Markdown.
"""

import asyncio
import base64
import json
import logging
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import settings
from app.services.s3_client import get_s3_client

logger = logging.getLogger(__name__)

# Page separator used by OpenDataLoader
PAGE_SEPARATOR = "---PAGE {page}---"
PAGE_SEP_PATTERN = re.compile(r"^---PAGE (\d+)---$", re.MULTILINE)

# Concurrency for vision LLM calls
MAX_VISION_CONCURRENT = 3

# Vision model for image description
IMAGE_DESCRIPTION_MODEL = "anthropic/claude-sonnet-4.5"

IMAGE_DESCRIPTION_SYSTEM = """你是一位学术图表分析专家。请用中文详细描述这张图片的内容。

要求：
1. 识别图表类型（ER图/流程图/柱状图/电路图/示意图/公式推导/表格等）
2. 列出所有标签、轴名、数值、实体名称
3. 描述图中展示的关系、连接、层级或趋势
4. 总结这张图的学术意义和关键信息

如果是 ER 图或关系图，请特别说明：
- 所有实体及其属性
- 关系类型和基数约束（1:1, 1:N, M:N）
- 键属性（用下划线标注的）

输出纯文本描述，使用简洁的学术语言。"""


@dataclass
class ODLImageInfo:
    """Metadata for an extracted image."""
    filename: str
    page_num: int
    bbox: list[float]  # [x1, y1, x2, y2]
    local_path: Path | None = None
    s3_key: str = ""
    description: str = ""


@dataclass
class ODLResult:
    """Result of OpenDataLoader PDF extraction."""
    markdown: str
    json_data: dict
    images: list[ODLImageInfo] = field(default_factory=list)
    image_dir: Path | None = None
    page_count: int = 0


def is_odl_available() -> bool:
    """Check if OpenDataLoader is installed and Java is available."""
    try:
        import opendataloader_pdf  # noqa: F401
        return True
    except ImportError:
        return False


def extract_with_odl(pdf_path: Path, output_dir: Path) -> ODLResult:
    """Run OpenDataLoader on a PDF file.

    Args:
        pdf_path: Path to the PDF file.
        output_dir: Directory for output files (markdown, json, images).

    Returns:
        ODLResult with markdown, JSON data, and image info.
    """
    import opendataloader_pdf

    image_dir = output_dir / "images"
    image_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Running OpenDataLoader on: %s", pdf_path.name)
    opendataloader_pdf.convert(
        input_path=[str(pdf_path)],
        output_dir=str(output_dir),
        format="markdown-with-images,json",
    )

    # Find output files (ODL names them after the input PDF)
    stem = pdf_path.stem
    md_path = output_dir / f"{stem}.md"
    json_path = output_dir / f"{stem}.json"
    img_dir = output_dir / f"{stem}_images"

    markdown = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
    json_data = {}
    if json_path.exists():
        json_data = json.loads(json_path.read_text(encoding="utf-8"))

    # Parse images from JSON structure
    images = _extract_image_info(json_data, img_dir)

    page_count = json_data.get("number of pages", 0)

    logger.info(
        "ODL extracted: %d chars markdown, %d images, %d pages",
        len(markdown), len(images), page_count,
    )

    return ODLResult(
        markdown=markdown,
        json_data=json_data,
        images=images,
        image_dir=img_dir,
        page_count=page_count,
    )


def _extract_image_info(
    json_data: dict,
    img_dir: Path,
) -> list[ODLImageInfo]:
    """Walk ODL JSON tree to find all image elements with bounding boxes."""
    images: list[ODLImageInfo] = []

    def _walk(node: dict | list):
        if isinstance(node, dict):
            if node.get("type") == "image":
                source = node.get("source", "")
                filename = Path(source).name if source else ""
                local_path = img_dir / filename if filename else None
                if local_path and local_path.exists():
                    images.append(ODLImageInfo(
                        filename=filename,
                        page_num=node.get("page number", 0),
                        bbox=node.get("bounding box", []),
                        local_path=local_path,
                    ))
            for v in node.values():
                if isinstance(v, (dict, list)):
                    _walk(v)
        elif isinstance(node, list):
            for item in node:
                if isinstance(item, (dict, list)):
                    _walk(item)

    _walk(json_data)
    return images


async def upload_images_to_s3(
    task_id: str,
    images: list[ODLImageInfo],
) -> None:
    """Upload extracted images to S3 and update s3_key on each image."""
    client = get_s3_client()
    for img in images:
        if not img.local_path or not img.local_path.exists():
            continue
        s3_key = f"extracted_images/{task_id}/{img.filename}"
        try:
            client.put_object(
                Bucket=settings.s3_bucket_name,
                Key=s3_key,
                Body=img.local_path.read_bytes(),
                ContentType="image/png",
            )
            img.s3_key = s3_key
        except Exception as e:
            logger.warning("Failed to upload image %s: %s", img.filename, e)


async def describe_image(
    img: ODLImageInfo,
    context: str,
    semaphore: asyncio.Semaphore,
) -> str:
    """Generate a description for a single image using vision LLM."""
    from openai import AsyncOpenAI

    if not img.local_path or not img.local_path.exists():
        return ""

    client = AsyncOpenAI(
        api_key=settings.openrouter_api_key,
        base_url="https://openrouter.ai/api/v1",
    )

    img_bytes = img.local_path.read_bytes()
    img_b64 = base64.b64encode(img_bytes).decode("ascii")

    async with semaphore:
        logger.info("Describing image: %s (page %d)", img.filename, img.page_num)
        try:
            response = await client.chat.completions.create(
                model=IMAGE_DESCRIPTION_MODEL,
                max_tokens=1024,
                messages=[
                    {"role": "system", "content": IMAGE_DESCRIPTION_SYSTEM},
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
                                "text": (
                                    f"请描述这张来自第 {img.page_num} 页的学术图片。\n"
                                    f"上下文：{context[:500]}"
                                ),
                            },
                        ],
                    },
                ],
            )
            description = response.choices[0].message.content or ""
            logger.info(
                "Image %s described: %d chars",
                img.filename, len(description),
            )
            return description
        except Exception as e:
            logger.error("Failed to describe image %s: %s", img.filename, e)
            return ""


async def describe_all_images(
    odl_result: ODLResult,
) -> dict[str, str]:
    """Generate descriptions for all extracted images concurrently.

    Returns:
        Mapping of {filename: description_text}.
    """
    if not odl_result.images:
        return {}

    semaphore = asyncio.Semaphore(MAX_VISION_CONCURRENT)
    markdown = odl_result.markdown

    async def _describe_with_context(img: ODLImageInfo) -> tuple[str, str]:
        # Extract surrounding text as context
        ref_pattern = img.filename
        idx = markdown.find(ref_pattern)
        if idx >= 0:
            start = max(0, idx - 300)
            end = min(len(markdown), idx + len(ref_pattern) + 300)
            context = markdown[start:end]
        else:
            context = f"第 {img.page_num} 页的图片"

        desc = await describe_image(img, context, semaphore)
        return img.filename, desc

    tasks = [_describe_with_context(img) for img in odl_result.images]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    descriptions = {}
    for r in results:
        if isinstance(r, Exception):
            logger.error("Image description failed: %s", r)
            continue
        filename, desc = r
        if desc:
            descriptions[filename] = desc

    logger.info("Described %d / %d images", len(descriptions), len(odl_result.images))
    return descriptions


def merge_descriptions_into_markdown(
    markdown: str,
    descriptions: dict[str, str],
    images: list[ODLImageInfo],
    task_id: str,
) -> str:
    """Replace image references in markdown with S3 URLs + descriptions.

    Transforms:
        ![image N](StemName_images/imageFile1.png)
    Into:
        ![图片](s3_presigned_url)
        > **[图片描述]** 这是一个展示xxx的图表...
    """
    result = markdown

    for img in images:
        if not img.filename:
            continue

        # Find the image reference pattern (ODL uses relative paths)
        # Match patterns like: ![image N](StemName_images/imageFile1.png)
        # or ![](StemName_images/imageFile1.png)
        pattern = re.compile(
            r'!\[([^\]]*)\]\([^)]*' + re.escape(img.filename) + r'\)',
        )

        desc = descriptions.get(img.filename, "")

        # Build replacement
        if img.s3_key:
            from app.services.s3_client import create_presigned_download_url
            try:
                img_url = create_presigned_download_url(img.s3_key, expires_in=86400)
            except Exception:
                img_url = img.filename
        else:
            img_url = img.filename

        replacement = f"![图片]({img_url})"
        if desc:
            # Add description as a blockquote below the image
            desc_oneline = desc.replace("\n", " ").strip()
            replacement += f"\n\n> **[图片描述]** {desc_oneline}"

        result = pattern.sub(replacement, result, count=1)

    return result


def split_markdown_by_page(markdown: str, page_count: int) -> list[tuple[int, str]]:
    """Split ODL markdown into per-page chunks.

    OpenDataLoader doesn't natively insert page separators in markdown-with-images
    mode, so we split based on the JSON page info and image references.

    Returns list of (page_num, markdown_text) tuples.
    """
    # If the markdown has page separators (custom post-processing), use them
    parts = PAGE_SEP_PATTERN.split(markdown)
    if len(parts) > 1:
        pages = []
        for i in range(1, len(parts), 2):
            page_num = int(parts[i])
            content = parts[i + 1] if i + 1 < len(parts) else ""
            pages.append((page_num, content.strip()))
        return pages

    # Otherwise, treat entire markdown as one chunk per page estimate
    # Split roughly by dividing into page_count segments
    if page_count <= 1:
        return [(1, markdown)]

    # Simple heuristic: split by double newlines and distribute
    lines = markdown.split("\n")
    lines_per_page = max(1, len(lines) // page_count)

    pages = []
    for i in range(page_count):
        start = i * lines_per_page
        end = start + lines_per_page if i < page_count - 1 else len(lines)
        chunk = "\n".join(lines[start:end]).strip()
        if chunk:
            pages.append((i + 1, chunk))

    return pages if pages else [(1, markdown)]


async def extract_pdf_with_odl(
    pdf_path: Path,
    task_id: str,
    *,
    describe_images: bool = True,
) -> tuple[list[tuple[int, str]], int]:
    """Full ODL pipeline: extract → upload images → describe → merge.

    Args:
        pdf_path: Local path to the PDF.
        task_id: Pipeline task ID for S3 paths.
        describe_images: Whether to run vision LLM on extracted images.

    Returns:
        Tuple of (pages: list of (page_num, markdown), image_count: int)
    """
    output_dir = Path(tempfile.mkdtemp(prefix=f"odl_{task_id}_"))

    try:
        # Step 1: Extract with OpenDataLoader
        odl_result = extract_with_odl(pdf_path, output_dir)

        if not odl_result.markdown.strip():
            logger.warning("ODL extracted empty markdown, falling back")
            return [], 0

        # Step 2: Upload images to S3
        await upload_images_to_s3(task_id, odl_result.images)

        # Step 3: Describe images with vision LLM (optional)
        descriptions: dict[str, str] = {}
        if describe_images and odl_result.images:
            descriptions = await describe_all_images(odl_result)

        # Step 4: Merge descriptions into markdown
        enhanced_md = merge_descriptions_into_markdown(
            odl_result.markdown,
            descriptions,
            odl_result.images,
            task_id,
        )

        # Step 5: Split into per-page chunks
        pages = split_markdown_by_page(enhanced_md, odl_result.page_count)

        logger.info(
            "ODL pipeline complete: %d pages, %d images (%d described)",
            len(pages), len(odl_result.images), len(descriptions),
        )

        return pages, len(odl_result.images)

    finally:
        # Cleanup temp directory
        try:
            shutil.rmtree(output_dir, ignore_errors=True)
        except Exception as e:
            logger.warning("Failed to clean up ODL temp dir: %s", e)
