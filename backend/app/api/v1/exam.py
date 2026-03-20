"""Past exam upload + ExamProfile management API."""

import logging
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.config import settings
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.exam_profile import ExamProfile, QuestionTypeDistribution
from app.services.s3_client import get_s3_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/exam", tags=["exam"])

# Max upload size: 20 MB
MAX_EXAM_UPLOAD_BYTES = 20 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
}

CONTENT_TYPE_TO_EXT = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
}


# ── Response Models ──────────────────────────────────────────────

class ExamUploadResponse(BaseModel):
    """Response after uploading and analyzing a past exam."""
    s3_key: str
    profile: ExamProfile


class ExamProfileResponse(BaseModel):
    """Stored exam profile for a course."""
    course_id: str
    profile: ExamProfile


# ── In-memory store (will be replaced by DB in production) ──────

# Maps course_id -> ExamProfile
_exam_profiles: dict[str, ExamProfile] = {}


# ── POST /exam/upload-past-exam ─────────────────────────────────

@router.post("/upload-past-exam", response_model=ExamUploadResponse)
async def upload_past_exam(
    file: UploadFile = File(...),
    course_id: str = Form(...),
    user: User = Depends(get_current_user),
):
    """Upload a past exam PDF/image and analyze its format.

    Flow:
    1. Validate file type and size
    2. Upload to S3 under past_exams/{user_id}/{course_id}/
    3. Run ExamAnalyzer to extract question type distribution
    4. Return detected ExamProfile
    """
    # Validate content type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. "
                   f"Allowed: PDF, PNG, JPEG, WebP",
        )

    # Read file content (validates size)
    content = await file.read()
    if len(content) > MAX_EXAM_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large: {len(content) / 1024 / 1024:.1f} MB "
                   f"(max {MAX_EXAM_UPLOAD_BYTES / 1024 / 1024:.0f} MB)",
        )
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    # Generate S3 key
    ext = CONTENT_TYPE_TO_EXT.get(content_type, "bin")
    unique_id = uuid.uuid4().hex[:12]
    s3_key = f"past_exams/{user.id}/{course_id}/{unique_id}.{ext}"

    # Upload to S3
    try:
        s3 = get_s3_client()
        s3.put_object(
            Bucket=settings.s3_bucket_name,
            Key=s3_key,
            Body=content,
            ContentType=content_type,
        )
        logger.info("Uploaded past exam to S3: %s (%d bytes)", s3_key, len(content))
    except Exception as e:
        logger.error("S3 upload failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to upload file")

    # Run analysis (synchronous for now -- typically < 30s)
    task_id = uuid.uuid4().hex
    try:
        from app.services.exam_analyzer import analyze_past_exam
        profile = await analyze_past_exam(s3_key, task_id)
    except Exception as e:
        logger.error("Exam analysis failed: %s", e)
        # Return default profile on analysis failure
        profile = ExamProfile(
            source="default",
            analyzed_exam_s3_key=s3_key,
        )

    # Store profile for this course
    _exam_profiles[course_id] = profile

    return ExamUploadResponse(s3_key=s3_key, profile=profile)


# ── GET /exam/profile/{course_id} ────────────────────────────────

@router.get("/profile/{course_id}", response_model=ExamProfileResponse)
async def get_exam_profile(
    course_id: str,
    user: User = Depends(get_current_user),
):
    """Get saved ExamProfile for a course.

    Returns stored profile if exists, otherwise a default based on course type.
    """
    profile = _exam_profiles.get(course_id)
    if not profile:
        # Generate default
        profile = ExamProfile.default_for_course_type("cs")

    return ExamProfileResponse(course_id=course_id, profile=profile)


# ── PUT /exam/profile/{course_id} ────────────────────────────────

class UpdateExamProfileRequest(BaseModel):
    """Manual exam profile update."""
    exam_date: str | None = None
    duration_minutes: int | None = None
    is_open_book: bool | None = None
    calculator_allowed: bool | None = None
    total_points: int = 100
    question_distribution: list[QuestionTypeDistribution] = []


@router.put("/profile/{course_id}", response_model=ExamProfileResponse)
async def update_exam_profile(
    course_id: str,
    body: UpdateExamProfileRequest,
    user: User = Depends(get_current_user),
):
    """Manually update/save an ExamProfile for a course."""
    profile = ExamProfile(
        exam_date=body.exam_date,
        duration_minutes=body.duration_minutes,
        is_open_book=body.is_open_book,
        calculator_allowed=body.calculator_allowed,
        total_points=body.total_points,
        question_distribution=body.question_distribution,
        source="user_input",
    )
    _exam_profiles[course_id] = profile

    return ExamProfileResponse(course_id=course_id, profile=profile)
