from __future__ import annotations

import hashlib
import time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .config import settings
from .supabase import is_transient_supabase_error, reset_service_client
from .routes import auth, admin, reviewer, peserta


# ---------------------------------------------------------------------------
# Short-lived per-user GET response cache
# ---------------------------------------------------------------------------
# This eliminates the #1 cause of 503s: parallel GET requests (dashboard +
# articles) each running the full _participant_context() chain of 10-15+
# serial Supabase queries.  The first request to finish is cached for a few
# seconds so the next parallel (or near-parallel) request returns instantly.
#
# Cache is keyed by (bearer-token-hash, request-path+query) so different
# users never share data.  TTL is intentionally very short (8 s) — just
# enough to deduplicate concurrent requests while keeping data fresh.
# ---------------------------------------------------------------------------

_response_cache: dict[str, tuple[float, int, dict[str, str], bytes]] = {}
_CACHE_TTL_SECONDS = 8
_CACHE_MAX_ENTRIES = 200


def _cache_key(token_hash: str, path: str) -> str:
    return f"{token_hash}:{path}"


def _evict_stale() -> None:
    """Remove expired entries when the cache grows too large."""
    if len(_response_cache) <= _CACHE_MAX_ENTRIES:
        return
    now = time.monotonic()
    stale = [k for k, (ts, *_) in _response_cache.items() if now - ts > _CACHE_TTL_SECONDS]
    for k in stale:
        _response_cache.pop(k, None)


class _ShortLivedCacheMiddleware(BaseHTTPMiddleware):
    """Cache GET /api/* responses for a few seconds per bearer token."""

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        if request.method != "GET":
            return await call_next(request)

        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)

        # Build a cache key from the hashed bearer token + full path+query.
        auth_header = request.headers.get("authorization", "")
        token_hash = hashlib.sha256(auth_header.encode()).hexdigest()[:16] if auth_header else "anon"
        full_path = f"{path}?{request.url.query}" if request.url.query else path
        key = _cache_key(token_hash, full_path)

        # Return cached response if fresh.
        cached = _response_cache.get(key)
        if cached is not None:
            ts, status_code, headers, body = cached
            if time.monotonic() - ts < _CACHE_TTL_SECONDS and status_code < 400:
                resp = Response(content=body, status_code=status_code, media_type="application/json")
                for k, v in headers.items():
                    resp.headers[k] = v
                resp.headers["X-Cache"] = "HIT"
                return resp

        response: Response = await call_next(request)

        # Only cache successful JSON responses.
        if 200 <= response.status_code < 300 and hasattr(response, "body_iterator"):
            body_parts: list[bytes] = []
            async for chunk in response.body_iterator:  # type: ignore[union-attr]
                body_parts.append(chunk if isinstance(chunk, bytes) else chunk.encode())
            body = b"".join(body_parts)

            # Store in cache.
            _evict_stale()
            headers_to_cache = {
                k: v for k, v in response.headers.items()
                if k.lower() in ("content-type",)
            }
            _response_cache[key] = (time.monotonic(), response.status_code, headers_to_cache, body)

            # Rebuild response since we consumed the body_iterator.
            cached_response = Response(content=body, status_code=response.status_code, media_type="application/json")
            for k, v in response.headers.items():
                cached_response.headers[k] = v
            cached_response.headers["X-Cache"] = "MISS"
            return cached_response

        return response


def clear_user_cache(token_prefix: str | None = None) -> None:
    """Invalidate cached responses.  Called after mutations."""
    if token_prefix is None:
        _response_cache.clear()
        return
    stale = [k for k in _response_cache if k.startswith(token_prefix)]
    for k in stale:
        _response_cache.pop(k, None)


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="PILAR Review System API",
    version="3.0.0",
    description="FastAPI backend for PILAR using Supabase Auth + PostgreSQL + RLS.",
)


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    # Keep browser responses JSON instead of exposing a traceback.
    # Full traceback remains available in the Uvicorn console.
    print(f"[UNHANDLED] {request.method} {request.url.path}: {exc!r}")

    if is_transient_supabase_error(exc):
        reset_service_client()
        return JSONResponse(
            status_code=503,
            content={"detail": "Layanan Supabase sementara tidak tersedia"},
        )

    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# --- Middleware (order matters: last added = outermost) ---
# 1. CORS — outermost so preflight is handled first.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
# 2. GZip — compress all responses > 500 bytes.
app.add_middleware(GZipMiddleware, minimum_size=500)
# 3. Short-lived response cache — deduplicate parallel GETs.
app.add_middleware(_ShortLivedCacheMiddleware)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(reviewer.router)
app.include_router(peserta.router)


@app.get("/health", tags=["System"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "pilar-fastapi"}
