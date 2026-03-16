"""S3-compatible storage client (MinIO for dev, Cloudflare R2 for prod)."""

import logging
import threading
import uuid

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings

logger = logging.getLogger(__name__)

# MIME type → canonical extension mapping (authoritative, not filename-derived)
MIME_TO_EXT: dict[str, str] = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
}

# Singleton client with thread-safe lazy init
_client = None
_client_lock = threading.Lock()


def get_s3_client():
    """Return a singleton S3 client with timeouts and retry config."""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                _client = boto3.client(
                    "s3",
                    endpoint_url=settings.s3_endpoint_url,
                    aws_access_key_id=settings.s3_access_key,
                    aws_secret_access_key=settings.s3_secret_key,
                    region_name=settings.s3_region,
                    config=Config(
                        signature_version="s3v4",
                        connect_timeout=5,
                        read_timeout=10,
                        retries={"max_attempts": 3, "mode": "standard"},
                        max_pool_connections=25,
                    ),
                )
    return _client


def ensure_bucket_exists() -> None:
    """Create the materials bucket if it doesn't exist (only on 404)."""
    client = get_s3_client()
    try:
        client.head_bucket(Bucket=settings.s3_bucket_name)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchBucket"):
            client.create_bucket(Bucket=settings.s3_bucket_name)
            logger.info("Created S3 bucket: %s", settings.s3_bucket_name)
        else:
            logger.error("Failed to check bucket %s: %s", settings.s3_bucket_name, e)
            raise


def generate_upload_key(user_id: str, content_type: str) -> str:
    """Generate a unique S3 key using MIME-based extension (not filename)."""
    ext = MIME_TO_EXT.get(content_type, "bin")
    unique = uuid.uuid4().hex[:12]
    return f"materials/{user_id}/{unique}.{ext}"


def head_object(s3_key: str) -> dict:
    """Get object metadata. Raises ClientError if not found."""
    client = get_s3_client()
    return client.head_object(Bucket=settings.s3_bucket_name, Key=s3_key)


def create_presigned_upload_url(
    s3_key: str,
    content_type: str,
    file_size: int,
    expires_in: int = 3600,
) -> str:
    """Generate a presigned PUT URL for direct client upload.

    ContentLength is included as best-effort metadata binding.
    Actual size enforcement is in confirm_upload via head_object.
    """
    client = get_s3_client()
    return client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket_name,
            "Key": s3_key,
            "ContentType": content_type,
            "ContentLength": file_size,
        },
        ExpiresIn=expires_in,
    )


def create_presigned_download_url(
    s3_key: str,
    expires_in: int = 3600,
) -> str:
    """Generate a presigned GET URL for downloading."""
    client = get_s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.s3_bucket_name,
            "Key": s3_key,
        },
        ExpiresIn=expires_in,
    )


def delete_s3_object(s3_key: str) -> bool:
    """Delete an object from S3. Returns True on success, False on error.

    Catches both ClientError (API errors) and BotoCoreError (network/timeout).
    """
    client = get_s3_client()
    try:
        client.delete_object(Bucket=settings.s3_bucket_name, Key=s3_key)
        return True
    except (ClientError, BotoCoreError) as e:
        logger.error("Failed to delete S3 object %s: %s", s3_key, e)
        return False
