"""Template-based course description rewriter — NO LLM API calls.

Applies the PM workflow rules from docs/course-content-workflow.md to generate
platform_description, learning_objectives, target_audience, and tags from
existing raw course metadata using pure Python string templates.

Idempotent: only processes courses with content_status='raw'.

Usage:
    cd backend
    PYTHONPATH=. python -m app.cli.rewrite_templates
    PYTHONPATH=. python -m app.cli.rewrite_templates --limit 10 --dry-run
    PYTHONPATH=. python -m app.cli.rewrite_templates --force
"""

import argparse
import asyncio
import logging
import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_factory
from app.models.course import Course

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


# --- Category → domain keyword mapping ---

_CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Fundamental Mathematics": [
        "数学", "线性代数", "微积分", "概率论", "数学分析",
    ],
    "Advanced Mathematics": [
        "数学", "实分析", "泛函分析", "抽象代数", "拓扑",
    ],
    "Fundamental Programming": [
        "编程", "程序设计", "入门", "编程语言",
    ],
    "Data Structures and Algorithms": [
        "算法", "数据结构", "排序", "图算法", "动态规划",
    ],
    "Software Engineering": [
        "软件工程", "软件设计", "开发流程", "版本控制",
    ],
    "Operating Systems": [
        "操作系统", "进程", "内存管理", "文件系统", "并发",
    ],
    "Computer Architecture": [
        "体系结构", "处理器", "流水线", "缓存", "指令集",
    ],
    "Computer Networking": [
        "网络", "TCP/IP", "协议", "路由", "传输层",
    ],
    "Database Systems": [
        "数据库", "SQL", "事务", "索引", "关系模型",
    ],
    "Compilers": [
        "编译", "词法分析", "语法分析", "代码生成", "优化",
    ],
    "Artificial Intelligence": [
        "人工智能", "搜索", "知识表示", "推理", "规划",
    ],
    "Machine Learning": [
        "机器学习", "分类", "回归", "模型评估", "特征工程",
    ],
    "Deep Learning": [
        "深度学习", "神经网络", "CNN", "RNN", "Transformer",
    ],
    "Computer Graphics": [
        "图形学", "渲染", "光照", "建模", "着色器",
    ],
    "Web Development": [
        "Web", "前端", "后端", "HTTP", "框架",
    ],
    "Data Science": [
        "数据科学", "数据分析", "可视化", "统计", "数据处理",
    ],
    "Computer Security": [
        "安全", "密码学", "漏洞", "攻防", "加密",
    ],
    "Distributed Systems": [
        "分布式", "并行", "一致性", "容错", "MapReduce",
    ],
}

# Difficulty → audience description
_DIFFICULTY_AUDIENCE = {
    1: "零基础入门者",
    2: "有一定编程基础的初学者",
    3: "本科中高年级学生",
    4: "有扎实基础的高年级本科或研究生",
    5: "研究生或有相关研究经验的学习者",
}

# Source platform → template style
_PLATFORM_STYLE = {
    "csdiy": "csdiy",
    "mit_ocw": "ocw",
    "manual": "generic",
}


def _clean_description(raw: str) -> str:
    """Clean raw description: strip markdown links, images, redundant whitespace."""
    # Remove markdown images
    text = re.sub(r"!\[.*?\]\(.*?\)", "", raw)
    # Convert markdown links to just text
    text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", "", text)
    # Normalize whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _extract_instructor(desc: str) -> str | None:
    """Try to extract instructor name from description."""
    patterns = [
        r"(?:由|讲师[：:]\s*)([^\s,，。]+(?:\s*[·•]\s*[^\s,，。]+)?)",
        r"(?:Professor|Prof\.?|taught by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)",
    ]
    for p in patterns:
        m = re.search(p, desc)
        if m:
            return m.group(1).strip()
    return None


def generate_platform_description(
    *,
    name: str,
    raw_description: str,
    university: str | None,
    instructor: str | None,
    category_name: str | None,
    source_platform: str,
    language: str,
    programming_lang: str | None,
    difficulty: int = 3,
) -> str:
    """Generate platform_description using PM workflow templates.

    Template A: university + instructor classic course
    Template B: tool/skill practical course
    Template C: generic course without clear university
    """
    desc = _clean_description(raw_description)
    style = _PLATFORM_STYLE.get(source_platform, "generic")

    # Detect if tool/skill course
    tool_keywords = {"工具", "实践", "实战", "工程", "开发", "tool", "practical"}
    is_tool_course = any(kw in name.lower() or kw in desc[:100].lower()
                        for kw in tool_keywords)

    # Extract core topics from structured metadata
    core_topics = _extract_core_topics(desc, category_name, name)

    topics_part = "、".join(core_topics[:3]) if core_topics else "相关核心概念"
    highlight = _get_course_highlight(desc, source_platform)

    if university and not is_tool_course:
        # Template A: classic university course
        instr_part = f"由{instructor}讲授。" if instructor else ""
        cat_label = f"的{category_name}课程" if category_name else "课程"

        if style == "ocw" and university == "MIT":
            result = (
                f"MIT 开放课程，{instr_part}"
                f"覆盖{topics_part}等主题，{highlight}。"
            )
        else:
            result = (
                f"{university}{cat_label}，{instr_part}"
                f"覆盖{topics_part}等主题，{highlight}。"
            )
    elif is_tool_course:
        # Template B: tool/skill course
        skill = core_topics[0] if core_topics else name
        target = "开发者" if programming_lang else "学习者"
        remaining = "、".join(core_topics[1:3]) if len(core_topics) > 1 else "核心技能"
        result = (
            f"系统学习{skill}的实践课程。"
            f"从基础出发，逐步掌握{remaining}，适合{target}。"
        )
    else:
        # Template C: generic course
        cat_or_name = category_name or name
        result = (
            f"面向{_DIFFICULTY_AUDIENCE.get(difficulty, '学习者')}的"
            f"{cat_or_name}课程。涵盖{topics_part}，{highlight}。"
        )

    # Enforce length: 50-150 chars
    if len(result) > 150:
        result = result[:147] + "..."
    return result


def _extract_core_topics(
    desc: str, category_name: str | None, course_name: str = "",
) -> list[str]:
    """Extract 2-4 concise topic keywords.

    Strategy: prefer structured metadata (category keywords) over raw
    description mining. Only fall back to description when category
    keywords are insufficient.
    """
    topics: list[str] = []
    seen: set[str] = set()

    def _add(t: str) -> bool:
        t = t.strip("，。、；：（）()\"' ")
        if 2 <= len(t) <= 12 and t not in seen:
            seen.add(t)
            topics.append(t)
            return True
        return False

    # Priority 1: category keywords (reliable, curated)
    cat_kws = _CATEGORY_KEYWORDS.get(category_name or "", [])
    for kw in cat_kws:
        _add(kw)
        if len(topics) >= 3:
            break

    # Priority 2: if still < 2, try course name fragments
    if len(topics) < 2 and course_name:
        # Extract meaningful parts from course name
        # e.g. "UCB CS61B: Data Structures and Algorithms" → "数据结构", "算法"
        name_lower = course_name.lower()
        name_topic_map = {
            "linear algebra": "线性代数",
            "calculus": "微积分",
            "probability": "概率论",
            "statistics": "统计学",
            "data structure": "数据结构",
            "algorithm": "算法",
            "machine learning": "机器学习",
            "deep learning": "深度学习",
            "operating system": "操作系统",
            "computer network": "计算机网络",
            "database": "数据库",
            "compiler": "编译原理",
            "computer graph": "计算机图形学",
            "artificial intell": "人工智能",
            "software eng": "软件工程",
            "web dev": "Web开发",
            "security": "计算机安全",
            "distributed": "分布式系统",
            "parallel": "并行计算",
        }
        for en_kw, zh_kw in name_topic_map.items():
            if en_kw in name_lower and len(topics) < 4:
                _add(zh_kw)

    # Priority 3: only if still < 2, check description for known keywords
    if len(topics) < 2 and desc:
        for kw in cat_kws:
            if kw in desc:
                _add(kw)
            if len(topics) >= 3:
                break

    return topics[:4]


def _get_course_highlight(desc: str, source_platform: str) -> str:
    """Generate a course highlight/feature phrase."""
    highlights_map = {
        "mit_ocw": [
            "提供完整讲义、习题与考试资料",
            "包含视频讲座与配套练习",
            "开放获取全部课程材料",
        ],
        "csdiy": [
            "配有完整教学资源与练习",
            "适合自学，有清晰的学习路径",
            "社区推荐的高质量开放课程",
        ],
    }
    defaults = highlights_map.get(source_platform, ["内容体系完整，适合系统学习"])

    # Try to detect specific features from description
    if "视频" in desc or "video" in desc.lower():
        return "配有视频讲座与讲义"
    if "实验" in desc or "lab" in desc.lower():
        return "包含动手实验与项目练习"
    if "project" in desc.lower() or "项目" in desc:
        return "注重项目实践与动手能力"

    return defaults[0]


def generate_learning_objectives(
    *,
    name: str,
    raw_description: str,
    category_name: str | None,
    difficulty: int,
    prerequisites: str | None,
) -> list[str]:
    """Generate 3-5 learning objectives from course metadata.

    Rules from PM workflow:
    - Start with verbs: 掌握/理解/能够/运用
    - Each ≤25 chars
    - 3-5 items, concrete to abstract
    """
    objectives: list[str] = []
    desc = _clean_description(raw_description)
    topics = _extract_core_topics(desc, category_name, name)

    verbs = ["掌握", "理解", "能够运用", "分析", "设计"]

    # Generate from topics
    for i, topic in enumerate(topics[:3]):
        verb = verbs[i % len(verbs)]
        obj = f"{verb}{topic}的核心概念"
        if len(obj) > 25:
            obj = obj[:25]
        objectives.append(obj)

    # Add practical objective based on category
    practical_map = {
        "Data Structures and Algorithms": "能够实现常见数据结构与算法",
        "Operating Systems": "理解操作系统的设计原理",
        "Machine Learning": "能够构建基础机器学习模型",
        "Deep Learning": "能够搭建和训练神经网络",
        "Web Development": "能够开发完整的Web应用",
        "Database Systems": "能够设计和优化数据库系统",
        "Computer Networking": "理解网络协议栈的工作原理",
        "Software Engineering": "掌握软件开发的工程化方法",
        "Compilers": "理解编译器各阶段的工作原理",
        "Computer Graphics": "能够实现基础图形渲染管线",
        "Computer Security": "掌握常见安全攻防技术",
        "Distributed Systems": "理解分布式系统的一致性问题",
    }
    cat_obj = practical_map.get(category_name or "")
    if cat_obj and cat_obj not in objectives:
        objectives.append(cat_obj)

    # Add analysis/design objective for higher difficulty
    if difficulty >= 4 and len(objectives) < 5:
        objectives.append("能够分析和评估不同方案的优劣")

    # Deduplicate
    seen = set()
    unique = []
    for obj in objectives:
        if obj not in seen:
            seen.add(obj)
            unique.append(obj)
    objectives = unique

    # Ensure minimum 3
    fallbacks = [
        f"系统理解{name}的核心概念",
        f"掌握{name}的基本方法与工具",
        f"能够将所学应用于实际问题",
    ]
    for fb in fallbacks:
        if len(objectives) >= 3:
            break
        if fb not in seen:
            objectives.append(fb)
            seen.add(fb)

    return objectives[:5]


def generate_target_audience(
    *,
    difficulty: int,
    prerequisites: str | None,
    category_name: str | None,
    level: str | None,
) -> str:
    """Generate target_audience from difficulty + prerequisites.

    Format: one sentence with audience + prerequisites.
    """
    audience = _DIFFICULTY_AUDIENCE.get(difficulty, "有一定基础的学习者")

    # Adjust for level
    if level == "graduate":
        audience = "研究生或高年级本科生"
    elif level == "undergraduate":
        if difficulty <= 2:
            audience = "大一大二学生"
        else:
            audience = "本科中高年级学生"

    # Prerequisites
    if prerequisites and prerequisites.strip() and prerequisites != "无":
        prereq = prerequisites.strip()
        # Truncate long prerequisites
        if len(prereq) > 40:
            prereq = prereq[:40].rstrip("，、") + "等"
        return f"{audience}，需{prereq}"

    # Default prerequisites by category
    default_prereqs = {
        "Data Structures and Algorithms": "需编程基础",
        "Machine Learning": "需线性代数和概率论基础",
        "Deep Learning": "需机器学习基础",
        "Operating Systems": "需编程和计算机组成基础",
        "Compilers": "需数据结构和编程语言基础",
        "Distributed Systems": "需操作系统和网络基础",
        "Advanced Mathematics": "需微积分和线性代数基础",
        "Computer Graphics": "需线性代数和编程基础",
    }
    prereq = default_prereqs.get(category_name or "", "")
    if prereq:
        return f"{audience}，{prereq}"

    return audience


def generate_tags(
    *,
    name: str,
    university: str | None,
    category_name: str | None,
    programming_lang: str | None,
    source_platform: str,
    level: str | None,
    existing_tags: list[str] | None,
) -> list[str]:
    """Generate 3-8 English lowercase hyphenated tags."""
    tags: set[str] = set()

    # Keep existing meaningful tags
    for t in (existing_tags or []):
        t = t.strip().lower()
        if t and len(t) <= 30:
            tags.add(t)

    # University tag
    if university:
        uni_tag = university.lower().replace(" ", "-")
        if len(uni_tag) <= 20:
            tags.add(uni_tag)

    # Category tag
    if category_name:
        tags.add(category_name.lower().replace(" ", "-"))

    # Programming language
    if programming_lang and programming_lang.strip() != "无":
        for lang in re.split(r"[/,、\s]+", programming_lang):
            lang = lang.strip().lower().replace("+", "p")
            if lang and len(lang) <= 15:
                tags.add(lang)

    # Level
    if level:
        tags.add(level.lower())

    # Source
    if source_platform == "mit_ocw":
        tags.add("mit")
        tags.add("ocw")

    return sorted(tags)[:8]


def rewrite_course(course: "Course") -> dict:
    """Apply template rewriting to a single course ORM object.

    Returns dict with: platform_description, learning_objectives,
    target_audience, tags.
    """
    cat_name = course.category.name if course.category else None

    raw = course.raw_description or course.description or ""
    instructor = course.instructor or _extract_instructor(raw)

    platform_description = generate_platform_description(
        name=course.name,
        raw_description=raw,
        university=course.university,
        instructor=instructor,
        category_name=cat_name,
        source_platform=course.source_platform or "csdiy",
        language=course.language or "en",
        programming_lang=course.programming_lang,
        difficulty=course.difficulty or 3,
    )

    learning_objectives = generate_learning_objectives(
        name=course.name,
        raw_description=raw,
        category_name=cat_name,
        difficulty=course.difficulty or 3,
        prerequisites=course.prerequisites,
    )

    target_audience = generate_target_audience(
        difficulty=course.difficulty or 3,
        prerequisites=course.prerequisites,
        category_name=cat_name,
        level=course.level,
    )

    tags = generate_tags(
        name=course.name,
        university=course.university,
        category_name=cat_name,
        programming_lang=course.programming_lang,
        source_platform=course.source_platform or "csdiy",
        level=course.level,
        existing_tags=course.tags,
    )

    return {
        "platform_description": platform_description,
        "learning_objectives": learning_objectives,
        "target_audience": target_audience,
        "tags": tags,
    }


async def rewrite_all(
    *,
    limit: int | None = None,
    force: bool = False,
    dry_run: bool = False,
    batch_size: int = 50,
) -> None:
    """Rewrite all eligible courses using templates."""
    statuses = ["raw"]
    if force:
        statuses.append("ai_rewritten")
        logger.info("Force mode: will re-process ai_rewritten courses")

    async with async_session_factory() as db:
        # Count
        count_stmt = (
            select(func.count())
            .select_from(Course)
            .where(Course.content_status.in_(statuses))
        )
        total = (await db.execute(count_stmt)).scalar() or 0
        logger.info("Found %d courses eligible for template rewriting", total)

        if total == 0:
            return

        effective_limit = min(limit or total, total)
        processed = 0
        succeeded = 0

        while processed < effective_limit:
            stmt = (
                select(Course)
                .where(Course.content_status.in_(statuses))
                .order_by(Course.created_at)
                .limit(batch_size)
            )
            result = await db.execute(stmt)
            courses = result.scalars().all()

            if not courses:
                break

            for course in courses:
                if dry_run:
                    logger.info(
                        "[DRY RUN] Would rewrite: %s (raw=%d chars)",
                        course.name,
                        len(course.raw_description or course.description or ""),
                    )
                    processed += 1
                    continue

                try:
                    rewritten = rewrite_course(course)
                    course.platform_description = rewritten["platform_description"]
                    course.learning_objectives = rewritten["learning_objectives"]
                    course.target_audience = rewritten["target_audience"]
                    course.tags = rewritten["tags"]
                    course.content_status = "ai_rewritten"
                    succeeded += 1
                except Exception as e:
                    logger.error("Failed to rewrite %s: %s", course.name, e)
                    course.content_status = "rewrite_failed"

                processed += 1

            if not dry_run:
                await db.commit()

            logger.info(
                "Batch: %d/%d processed (%d ok)",
                processed, effective_limit, succeeded,
            )

    logger.info(
        "Template rewrite complete: %d processed, %d succeeded",
        processed, succeeded,
    )


def main():
    parser = argparse.ArgumentParser(
        description="Template-based course description rewriter (no LLM)",
    )
    parser.add_argument("--limit", type=int, help="Max courses to process")
    parser.add_argument("--force", action="store_true",
                        help="Re-process ai_rewritten courses")
    parser.add_argument("--dry-run", action="store_true",
                        help="Don't write to DB")
    parser.add_argument("--batch-size", type=int, default=50)
    args = parser.parse_args()

    asyncio.run(rewrite_all(
        limit=args.limit,
        force=args.force,
        dry_run=args.dry_run,
        batch_size=args.batch_size,
    ))


if __name__ == "__main__":
    main()
