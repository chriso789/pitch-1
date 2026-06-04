"""Internal helpers for pitch/area/quality skills (planes JSON loader)."""
from __future__ import annotations

import json
import os
import tempfile
from typing import Any

from ..config import get_settings
from ._io import download_to_temp


def load_planes(planes_url: str) -> list[dict[str, Any]]:
    workdir = tempfile.mkdtemp(prefix="planes-load-", dir=get_settings().temp_work_dir)
    p = os.path.join(workdir, "planes.json")
    download_to_temp(planes_url, p)
    with open(p) as f:
        return json.load(f)
