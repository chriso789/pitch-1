"""Bucket -> local cache loader for vendor reports.

Downloads PDFs and diagram images from the `unet-training-data` (or other)
Supabase Storage bucket into roof-training/data/raw/<sample_id>/.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, List, Dict, Optional

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = os.environ.get("ROOF_TRAINING_BUCKET", "unet-training-data")
LOCAL_ROOT = Path(os.environ.get("ROOF_DATASET_ROOT", "./roof-training")) / "data"
RAW_DIR = LOCAL_ROOT / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)


def _headers() -> Dict[str, str]:
    if not SERVICE_KEY:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY missing")
    return {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}


def list_bucket(prefix: str = "") -> List[Dict]:
    """List objects in the training bucket under an optional prefix."""
    url = f"{SUPABASE_URL}/storage/v1/object/list/{BUCKET}"
    resp = requests.post(
        url,
        headers={**_headers(), "Content-Type": "application/json"},
        json={"prefix": prefix, "limit": 1000, "offset": 0},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def download(object_path: str, dest: Path) -> Path:
    """Download a single object to local disk (returns dest)."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{object_path}"
    resp = requests.get(url, headers=_headers(), timeout=120)
    resp.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(resp.content)
    return dest


def cache_sample(sample_id: str, files: Iterable[str]) -> Dict[str, Path]:
    """Cache a list of bucket paths into roof-training/data/raw/<sample_id>/.

    Returns a map of basename -> local path.
    """
    out: Dict[str, Path] = {}
    target_dir = RAW_DIR / sample_id
    for f in files:
        name = os.path.basename(f)
        dest = target_dir / name
        download(f, dest)
        out[name] = dest
    return out


def discover_samples(prefix: str = "") -> List[str]:
    """Return distinct top-level sample folders inside the bucket."""
    entries = list_bucket(prefix)
    folders = set()
    for e in entries:
        name = e.get("name") or ""
        if "/" in name:
            folders.add(name.split("/", 1)[0])
        else:
            folders.add(name)
    return sorted(folders)
