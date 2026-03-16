from celery import Celery

from app.core.config import settings

celery = Celery(
    "zhijie",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    # Ops-critical settings (Codex review feedback)
    task_time_limit=600,              # hard kill after 10 min
    task_soft_time_limit=540,         # graceful timeout at 9 min
    result_expires=3600,              # results expire after 1 hour
    broker_connection_retry_on_startup=True,
    # Auto-discover tasks in workers package
    imports=["app.workers", "app.workers.pipeline_worker"],
)
