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

# Singleton clients with thread-safe lazy init
_client = None
_client_lock = threading.Lock()
_public_client = None
_public_client_lock = threading.Lock()

_S3_CONFIG = Config(
    signature_version="s3v4",
    connect_timeout=5,
    read_timeout=10,
    retries={"max_attempts": 3, "mode": "standard"},
    max_pool_connections=25,
)


def get_s3_client():
    """Return a singleton S3 client for internal (server-side) operations."""
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
                    config=_S3_CONFIG,
                )
    return _client


def _get_public_s3_client():
    """Return a singleton S3 client using public endpoint for presigned URLs.

    In Docker, the internal endpoint (minio:9000) is unreachable from the
    browser. This client connects via S3_PUBLIC_ENDPOINT_URL (e.g.
    localhost:9002) so presigned URLs are valid for the host machine.

    Falls back to the internal client if S3_PUBLIC_ENDPOINT_URL is not set.
    """
    if not settings.s3_public_endpoint_url:
        return get_s3_client()

    global _public_client
    if _public_client is None:
        with _public_client_lock:
            if _public_client is None:
                _public_client = boto3.client(
                    "s3",
                    endpoint_url=settings.s3_public_endpoint_url,
                    aws_access_key_id=settings.s3_access_key,
                    aws_secret_access_key=settings.s3_secret_key,
                    region_name=settings.s3_region,
                    config=_S3_CONFIG,
                )
    return _public_client


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


def _rewrite_presigned_url(url: str) -> str:
    """Rewrite internal MinIO URL to public proxy URL if S3_PUBLIC_URL_PREFIX is set.

    When using nginx reverse proxy for MinIO, presigned URLs are generated
    with the internal endpoint (minio:9000) for correct signature, then
    rewritten to the public proxy URL. nginx passes Host: minio:9000 to
    MinIO so signature verification still passes.
    """
    prefix = settings.s3_public_url_prefix
    if not prefix:
        return url
    # Replace http://minio:9000/ with the public prefix
    internal = settings.s3_endpoint_url.rstrip("/") + "/"
    if url.startswith(internal):
        return prefix.rstrip("/") + "/" + url[len(internal):]
    return url


def create_presigned_upload_url(
    s3_key: str,
    content_type: str,
    file_size: int,
    expires_in: int = 3600,
) -> str:
    """Generate a presigned PUT URL for direct client upload.

    Uses the public S3 client so URLs are accessible from the browser.
    ContentLength is included as best-effort metadata binding.
    Actual size enforcement is in confirm_upload via head_object.
    """
    client = _get_public_s3_client()
    url = client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket_name,
            "Key": s3_key,
            "ContentType": content_type,
            "ContentLength": file_size,
        },
        ExpiresIn=expires_in,
    )
    return _rewrite_presigned_url(url)


def create_presigned_download_url(
    s3_key: str,
    expires_in: int = 3600,
) -> str:
    """Generate a presigned GET URL for downloading.

    Uses the public S3 client so URLs are accessible from the browser.
    """
    client = _get_public_s3_client()
    url = client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.s3_bucket_name,
            "Key": s3_key,
        },
        ExpiresIn=expires_in,
    )
    return _rewrite_presigned_url(url)


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
