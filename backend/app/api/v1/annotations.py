"""PDF annotation sync API."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.annotation import PDFAnnotation
from app.schemas.annotation import (
    AnnotationItem,
    AnnotationSyncRequest,
    AnnotationSyncResponse,
    AnnotationListResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/materials", tags=["annotations"])


@router.get("/{material_id}/annotations", response_model=AnnotationListResponse)
async def get_annotations(
    material_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all annotations for a material."""
    result = await db.execute(
        select(PDFAnnotation).where(
            PDFAnnotation.user_id == user.id,
            PDFAnnotation.material_id == material_id,
        ).order_by(PDFAnnotation.created_at)
    )
    annotations = result.scalars().all()

    return AnnotationListResponse(
        material_id=str(material_id),
        annotations=[
            AnnotationItem(
                client_id=a.client_id,
                highlight_data=a.highlight_data,
                color=a.color,
                comment=a.comment,
            )
            for a in annotations
        ],
        total=len(annotations),
    )


@router.post(
    "/{material_id}/annotations/sync",
    response_model=AnnotationSyncResponse,
)
async def sync_annotations(
    material_id: uuid.UUID,
    body: AnnotationSyncRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sync annotations for a material (full replace strategy).

    Strategy: delete all existing annotations for this user+material,
    then insert the full set from frontend. Simple and correct since
    annotation sets are small (<100 items) and frontend is source of truth.
    """
    # Delete existing
    await db.execute(
        delete(PDFAnnotation).where(
            PDFAnnotation.user_id == user.id,
            PDFAnnotation.material_id == material_id,
        )
    )

    # Insert all
    created = 0
    for item in body.annotations:
        annotation = PDFAnnotation(
            user_id=user.id,
            material_id=material_id,
            client_id=item.client_id,
            highlight_data=item.highlight_data,
            color=item.color,
            comment=item.comment,
        )
        db.add(annotation)
        created += 1

    await db.commit()
    logger.info(
        "Synced %d annotations for user %s, material %s",
        created, user.id, material_id,
    )

    return AnnotationSyncResponse(
        created=created,
        updated=0,
        total=created,
    )
