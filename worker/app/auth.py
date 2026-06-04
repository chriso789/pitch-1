from fastapi import Header, HTTPException, status
from .config import get_settings


async def require_worker_key(
    x_internal_worker_api_key: str | None = Header(default=None),
    x_worker_api_key: str | None = Header(default=None),
):
    """Validate the standardized X-Internal-Worker-Api-Key header.

    Falls back to legacy X-Worker-Api-Key for back-compat with older callers.
    """
    settings = get_settings()
    provided = x_internal_worker_api_key or x_worker_api_key
    if not settings.worker_api_key:
        if settings.worker_mode == "production":
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "INTERNAL_WORKER_API_KEY not configured",
            )
        return
    if provided != settings.worker_api_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid internal worker api key")
