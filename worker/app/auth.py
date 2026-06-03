from fastapi import Header, HTTPException, status
from .config import get_settings


async def require_worker_key(x_worker_api_key: str | None = Header(default=None)):
    settings = get_settings()
    if not settings.worker_api_key:
        # In development we allow unauthenticated requests but flag it
        if settings.worker_mode == "production":
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                                "WORKER_API_KEY not configured")
        return
    if x_worker_api_key != settings.worker_api_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid worker api key")
