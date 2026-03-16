from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    """Basic health check — verifies DB connectivity."""
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "service": "zhijie-api"}
