"""Shared utilities for worker skills — artifact uploads, raster I/O, etc."""
from __future__ import annotations

import os
import shutil
from typing import Any

from .config import get_settings


def upload_artifact_to_storage(local_path: str, storage_path: str) -> dict[str, Any]:
    """Upload any local file to Supabase Storage (or local fallback in dev/test).

    Mirrors the contract used by `clip_point_cloud._upload_to_storage` so every
    skill emits artifacts at canonical paths.
    """
    settings = get_settings()
    have_supabase = bool(settings.supabase_url and settings.supabase_service_role_key)

    if not have_supabase:
        if settings.worker_mode.lower() == "production":
            raise RuntimeError(
                "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured — "
                "production worker cannot upload artifact"
            )
        local_path_out = os.path.join(settings.local_artifact_dir, storage_path)
        os.makedirs(os.path.dirname(local_path_out), exist_ok=True)
        shutil.copyfile(local_path, local_path_out)
        return {
            "bucket": "local-test-fallback",
            "storage_path": f"test-artifacts/{storage_path}",
            "local_path": local_path_out,
            "byte_size": os.path.getsize(local_path_out),
        }

    from supabase import create_client  # type: ignore
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    with open(local_path, "rb") as f:
        data = f.read()
    client.storage.from_(settings.supabase_storage_bucket).upload(
        path=storage_path,
        file=data,
        file_options={"contentType": "application/octet-stream", "upsert": "true"},
    )
    return {
        "bucket": settings.supabase_storage_bucket,
        "storage_path": storage_path,
        "byte_size": len(data),
    }


def artifact_path(
    measurement_request_id: str,
    request_hash: str,
    skill_run_id: str,
    sub: str,
    filename: str,
) -> str:
    return (
        f"measurement-requests/{measurement_request_id}/"
        f"{request_hash}/{sub}/{skill_run_id}/{filename}"
    )


def download_to_temp(url: str, dest_path: str, max_mb: int = 4096) -> int:
    """Stream-download with hard cap. Supports https, http, file://, and Supabase
    Storage paths (no scheme) when service-role creds are present."""
    settings = get_settings()
    cap = max_mb * 1024 * 1024

    if "://" not in url:
        # Treat as Supabase Storage path
        if not (settings.supabase_url and settings.supabase_service_role_key):
            # Local fallback — look in local artifact dir
            local = os.path.join(settings.local_artifact_dir, url)
            if not os.path.exists(local):
                raise FileNotFoundError(f"local artifact not found: {url}")
            shutil.copyfile(local, dest_path)
            return os.path.getsize(dest_path)
        from supabase import create_client  # type: ignore
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        data = client.storage.from_(settings.supabase_storage_bucket).download(url)
        with open(dest_path, "wb") as f:
            f.write(data)
        return len(data)

    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "pitch-measure-worker/0.3"})
    written = 0
    with urllib.request.urlopen(req, timeout=180) as resp, open(dest_path, "wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > cap:
                raise ValueError(f"source exceeds max_mb={max_mb}")
            out.write(chunk)
    return written
