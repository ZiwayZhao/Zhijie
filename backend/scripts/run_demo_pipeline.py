"""Run pipeline on demo PDFs — upload to MinIO + create DB records + trigger pipeline.

Usage:
    cd backend
    python scripts/run_demo_pipeline.py

Requires: backend running on localhost:8003, Docker services (db, redis, minio) up.
"""

import os
import sys
import time
import uuid
import json
import requests
import boto3

# ── Config ────────────────────────────────────────────────────────
API_BASE = "http://localhost:8003/api/v1"
LOGIN_EMAIL = "pipeline@zhijie.dev"
LOGIN_PASSWORD = "test1234"

S3_ENDPOINT = "http://localhost:9002"
S3_ACCESS_KEY = "minioadmin"
S3_SECRET_KEY = "minioadmin"
S3_BUCKET = "zhijie-materials"

DEMO_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "demo_pdfs")

# ── Demo courses to process ───────────────────────────────────────
DEMO_COURSES = [
    {
        "filename": "CS229_notes1.pdf",
        "title": "Stanford CS229 - Supervised Learning",
        "course_slug": "cs229",  # will try to find in DB
        "material_type": "lecture_notes",
        "description": "Stanford CS229 Machine Learning - Supervised Learning Notes (Linear Regression, Logistic Regression, GLMs)",
    },
    {
        "filename": "MIT6_006S20_lec1.pdf",
        "title": "MIT 6.006 - Lecture 1: Introduction to Algorithms",
        "course_slug": "cmu15-445",  # placeholder, will look for algo course
        "material_type": "lecture_notes",
        "description": "MIT 6.006 Introduction to Algorithms - Lecture 1: Algorithms, data structures, and their applications",
    },
    {
        "filename": "MIT18_01_unit1.pdf",
        "title": "MIT 18.01 - Unit 1: Differentiation",
        "course_slug": None,
        "material_type": "lecture_notes",
        "description": "MIT 18.01 Single Variable Calculus - Unit 1: Derivatives, rate of change, limits, continuity",
    },
]


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name="us-east-1",
    )


def login() -> str:
    """Login and return access token."""
    r = requests.post(f"{API_BASE}/auth/login", json={
        "email": LOGIN_EMAIL,
        "password": LOGIN_PASSWORD,
    })
    r.raise_for_status()
    return r.json()["access_token"]


def upload_pdf_to_minio(filepath: str, user_id: str) -> tuple[str, int]:
    """Upload PDF directly to MinIO, return (s3_key, file_size)."""
    s3 = get_s3_client()
    file_size = os.path.getsize(filepath)
    s3_key = f"uploads/{user_id}/{uuid.uuid4().hex}.pdf"

    with open(filepath, "rb") as f:
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=f,
            ContentType="application/pdf",
        )

    print(f"  ✅ Uploaded to MinIO: {s3_key} ({file_size / 1024:.0f} KB)")
    return s3_key, file_size


def create_material_in_db(token: str, demo: dict, s3_key: str, file_size: int) -> str:
    """Create material record via direct DB insert (using presigned URL flow)."""
    headers = {"Authorization": f"Bearer {token}"}

    # Step 1: Request upload (creates material record)
    r = requests.post(f"{API_BASE}/materials/upload", headers=headers, json={
        "filename": demo["filename"],
        "content_type": "application/pdf",
        "file_size": file_size,
        "title": demo["title"],
        "description": demo.get("description", ""),
        "material_type": demo.get("material_type", "lecture_notes"),
    })
    r.raise_for_status()
    data = r.json()
    material_id = data["material_id"]
    original_s3_key = data["s3_key"]

    # Step 2: Copy our already-uploaded file to the expected S3 key
    s3 = get_s3_client()
    s3.copy_object(
        Bucket=S3_BUCKET,
        CopySource=f"{S3_BUCKET}/{s3_key}",
        Key=original_s3_key,
    )

    # Step 3: Confirm upload
    r = requests.post(f"{API_BASE}/materials/{material_id}/confirm", headers=headers)
    r.raise_for_status()

    print(f"  ✅ Material created: {material_id}")
    return material_id


def start_pipeline(token: str, material_id: str) -> str:
    """Start disassembly pipeline, return task_id."""
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.post(f"{API_BASE}/disassembly/start", headers=headers, json={
        "material_id": material_id,
    })
    r.raise_for_status()
    data = r.json()
    task_id = data["task_id"]
    print(f"  🚀 Pipeline started: task_id={task_id}")
    return task_id


def poll_pipeline(token: str, task_id: str, timeout: int = 600) -> dict:
    """Poll pipeline status until completion or timeout."""
    headers = {"Authorization": f"Bearer {token}"}
    start = time.time()

    while time.time() - start < timeout:
        r = requests.get(f"{API_BASE}/disassembly/tasks/{task_id}/status", params={"token": token})
        # SSE endpoint — just check DB status directly
        r2 = requests.get(f"{API_BASE}/disassembly/tasks/{task_id}/result", headers=headers)
        if r2.status_code == 200:
            return r2.json()

        # Check task status via a workaround — get material's latest analysis
        time.sleep(10)
        elapsed = int(time.time() - start)
        print(f"  ⏳ Waiting... ({elapsed}s)")

    raise TimeoutError(f"Pipeline did not complete in {timeout}s")


def get_user_id(token: str) -> str:
    """Extract user_id from token."""
    import jwt as pyjwt
    payload = pyjwt.decode(token, options={"verify_signature": False})
    return payload["sub"]


def main():
    print("=" * 60)
    print("智阶 Pipeline Demo Runner")
    print("=" * 60)

    # Check celery worker is running
    print("\n⚠️  Make sure Celery worker is running:")
    print("   cd backend && celery -A app.workers.celery_app worker -l info")
    print()

    # Login
    print("1️⃣  Logging in...")
    token = login()
    user_id = get_user_id(token)
    print(f"  ✅ Logged in as {LOGIN_EMAIL} (user_id={user_id})")

    task_ids = []

    for i, demo in enumerate(DEMO_COURSES):
        filepath = os.path.join(DEMO_DIR, demo["filename"])
        if not os.path.exists(filepath):
            print(f"\n❌ File not found: {filepath}")
            continue

        print(f"\n{'─' * 60}")
        print(f"2️⃣  Processing [{i+1}/{len(DEMO_COURSES)}]: {demo['title']}")

        # Upload to MinIO
        s3_key, file_size = upload_pdf_to_minio(filepath, user_id)

        # Create material
        material_id = create_material_in_db(token, demo, s3_key, file_size)

        # Start pipeline
        task_id = start_pipeline(token, material_id)
        task_ids.append((demo["title"], task_id))

    print(f"\n{'=' * 60}")
    print(f"✅ All {len(task_ids)} pipelines triggered!")
    print()
    for title, tid in task_ids:
        print(f"  📋 {title}")
        print(f"     task_id: {tid}")
    print()
    print("Pipeline will run in background via Celery worker.")
    print("Check status: docker logs -f <celery_container> or check DB directly.")
    print()

    # Optionally poll
    if "--poll" in sys.argv:
        print("Polling for completion...")
        for title, tid in task_ids:
            print(f"\n⏳ Waiting for: {title}")
            try:
                result = poll_pipeline(token, tid)
                modules = result.get("modules", [])
                quiz = result.get("quiz")
                print(f"  ✅ Done! {len(modules)} modules, {quiz['total_questions'] if quiz else 0} quiz questions")
            except TimeoutError as e:
                print(f"  ❌ {e}")
            except Exception as e:
                print(f"  ❌ Error: {e}")


if __name__ == "__main__":
    main()
