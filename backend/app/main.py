from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any

import anyio
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .config import settings
from .supabase import is_transient_supabase_error, reset_service_client
from .routes import auth, admin, reviewer, peserta


# ---------------------------------------------------------------------------
# Ukuran thread pool
# ---------------------------------------------------------------------------
# Sebagian besar endpoint (terutama admin) adalah fungsi sync, jadi FastAPI
# menjalankannya di thread pool anyio. Tiap endpoint semacam itu menahan satu
# thread selama menunggu jaringan ke Supabase (~40 ms per query, dan ada
# endpoint dengan belasan query sekuensial). Dengan batas anyio default (40)
# dan executor asyncio default (min(32, cpu+4)), beberapa user aktif sudah
# cukup membuat request lain mengantre - ini sumber lonjakan latency yang
# terasa acak.
# ---------------------------------------------------------------------------

_ANYIO_THREAD_TOKENS = 100
_ASYNCIO_EXECUTOR_WORKERS = 32

_executor: ThreadPoolExecutor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Besarkan thread pool saat aplikasi mulai, rapikan saat berhenti."""
    global _executor

    try:
        anyio.to_thread.current_default_thread_limiter().total_tokens = _ANYIO_THREAD_TOKENS
    except Exception as exc:
        print(f"[WARN] Gagal menyetel limiter thread anyio: {exc}")

    try:
        loop = asyncio.get_running_loop()
        _executor = ThreadPoolExecutor(
            max_workers=_ASYNCIO_EXECUTOR_WORKERS, thread_name_prefix="supabase-worker"
        )
        loop.set_default_executor(_executor)
    except Exception as exc:
        print(f"[WARN] Gagal menyetel executor asyncio: {exc}")

    try:
        yield
    finally:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
            _executor = None


app = FastAPI(
    title="PILAR Review System API",
    version="3.0.0",
    description="FastAPI backend for PILAR using Supabase Auth + PostgreSQL + RLS.",
    lifespan=lifespan,
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

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(reviewer.router)
app.include_router(peserta.router)


@app.get("/health", tags=["System"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "pilar-fastapi"}
