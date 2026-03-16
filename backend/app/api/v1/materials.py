import logging
import uuid
from datetime import datetime, timezone

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_db
from app.core.security import get_current_user
from app.models.material import Material
from app.models.user import User
from app.schemas.material import (
    MaterialList,
    MaterialResponse,
    UploadRequest,
    UploadResponse,
)
from app.services.s3_client import (
    create_presigned_download_url,
    create_presigned_upload_url,
    delete_s3_object,
    generate_upload_key,
    head_object,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/materials", tags=["materials"])

ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg"}
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def request_upload(
    body: UploadRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Request a presigned URL to upload a file directly to S3."""
    if body.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Content type not allowed. Allowed: {', '.join(ALLOWED_TYPES)}",
        )
    if body.file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Max size: {MAX_FILE_SIZE // (1024*1024)} MB",
        )

    # Extension derived from MIME type, not filename
    s3_key = generate_upload_key(str(user.id), body.content_type)
    try:
        upload_url = create_presigned_upload_url(s3_key, body.content_type, body.file_size)
    except (ClientError, BotoCoreError) as e:
        logger.error("Failed to generate presigned upload URL: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Storage service unavailable. Please try again later.",
        )

    material = Material(
        user_id=user.id,
        course_id=body.course_id,
        filename=body.filename,
        content_type=body.content_type,
        file_size=body.file_size,
        s3_key=s3_key,
        title=body.title,
        description=body.description,
        material_type=body.material_type,
        semester=body.semester,
        analysis_status="pending",
    )
    db.add(material)
    await db.commit()

    return UploadResponse(
        material_id=material.id,
        upload_url=upload_url,
        s3_key=s3_key,
    )


@router.post("/{material_id}/confirm")
async def confirm_upload(
    material_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm upload completed — verify file in S3, then trigger analysis."""
    result = await db.execute(
        select(Material).where(
            Material.id == material_id,
            Material.user_id == user.id,
            Material.deleted_at.is_(None),
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    # Server-side verification: check file actually exists in S3
    try:
        obj_meta = head_object(material.s3_key)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File not found in storage. Upload may not have completed.",
            )
        # Non-404 errors (403, 500, etc.) are server-side issues
        logger.error("S3 head_object failed for %s: %s", material.s3_key, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Storage service error. Please try again later.",
        )
    except BotoCoreError as e:
        logger.error("S3 connection error for %s: %s", material.s3_key, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Storage service unavailable. Please try again later.",
        )

    # Verify file size matches (tolerance: exact match)
    actual_size = obj_meta.get("ContentLength", 0)
    if actual_size != material.file_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File size mismatch. Expected {material.file_size}, got {actual_size}.",
        )

    # Verify content type matches
    actual_type = obj_meta.get("ContentType", "")
    if actual_type != material.content_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Content type mismatch. Expected {material.content_type}, got {actual_type}.",
        )

    # TODO Sprint 2: trigger Celery pipeline task
    # TODO Sprint 2: periodic Celery job to delete stale unconfirmed uploads
    #   (analysis_status='pending' AND created_at < now - 24h → delete S3 + DB row)
    # task = pipeline_task.delay(str(material.id))
    # material.analysis_task_id = task.id
    material.analysis_status = "confirmed"
    await db.commit()

    return {"status": "ok", "message": "Upload confirmed, analysis queued"}


@router.get("", response_model=MaterialList)
async def list_materials(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    course_id: uuid.UUID | None = None,
):
    """List current user's materials (excludes soft-deleted)."""
    query = select(Material).where(Material.user_id == user.id, Material.deleted_at.is_(None))
    count_query = select(func.count()).select_from(Material).where(
        Material.user_id == user.id, Material.deleted_at.is_(None)
    )

    if course_id:
        query = query.where(Material.course_id == course_id)
        count_query = count_query.where(Material.course_id == course_id)

    query = query.order_by(Material.created_at.desc()).offset(skip).limit(limit)

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    result = await db.execute(query)
    materials = result.scalars().all()

    items = []
    for m in materials:
        resp = MaterialResponse.model_validate(m)
        try:
            resp.download_url = create_presigned_download_url(m.s3_key)
        except (ClientError, BotoCoreError) as e:
            logger.warning("Failed to generate download URL for %s: %s", m.s3_key, e)
            resp.download_url = None
        items.append(resp)

    return MaterialList(items=items, total=total)


@router.get("/{material_id}", response_model=MaterialResponse)
async def get_material(
    material_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single material with download URL."""
    result = await db.execute(
        select(Material).where(
            Material.id == material_id,
            Material.user_id == user.id,
            Material.deleted_at.is_(None),
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    resp = MaterialResponse.model_validate(material)
    try:
        resp.download_url = create_presigned_download_url(material.s3_key)
    except (ClientError, BotoCoreError) as e:
        logger.error("Failed to generate download URL for %s: %s", material.s3_key, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Storage service unavailable. Please try again later.",
        )
    return resp


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    material_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a material, then best-effort S3 cleanup."""
    result = await db.execute(
        select(Material).where(
            Material.id == material_id,
            Material.user_id == user.id,
            Material.deleted_at.is_(None),
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    # Soft-delete: set deleted_at timestamp (DB record preserved for audit/recovery)
    material.deleted_at = datetime.now(timezone.utc)
    await db.commit()

    # Best-effort S3 cleanup (logged on failure, not user-facing error)
    # TODO Sprint 2: periodic job to hard-delete records where deleted_at > 30 days
    delete_s3_object(material.s3_key)

    return None
