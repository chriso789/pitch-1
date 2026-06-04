import os
from functools import lru_cache
from pydantic import BaseModel


class Settings(BaseModel):
    # Standardized name (back-compat with WORKER_API_KEY for older deploys)
    worker_api_key: str = os.getenv(
        "INTERNAL_WORKER_API_KEY",
        os.getenv("WORKER_API_KEY", ""),
    )
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    supabase_storage_bucket: str = os.getenv("SUPABASE_STORAGE_BUCKET", "mskill-artifacts")
    worker_mode: str = os.getenv("WORKER_MODE", "development")
    max_aoi_sqft: int = int(os.getenv("MAX_AOI_SQFT", "200000"))
    max_point_count: int = int(os.getenv("MAX_POINT_COUNT", "50000000"))
    min_clipped_point_count: int = int(os.getenv("MIN_CLIPPED_POINT_COUNT", "500"))
    max_download_mb: int = int(os.getenv("MAX_DOWNLOAD_MB", "2048"))
    temp_work_dir: str = os.getenv("TEMP_WORK_DIR", "/tmp/pitch-measure")
    callback_base_url: str = os.getenv("CONTROL_PLANE_CALLBACK_URL", "")
    worker_version: str = "0.2.0-clip-point-cloud"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    os.makedirs(s.temp_work_dir, exist_ok=True)
    return s
