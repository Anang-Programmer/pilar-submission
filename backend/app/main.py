from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .supabase import is_transient_supabase_error, reset_service_client
from .routes import auth, admin, reviewer, peserta


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


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(reviewer.router)
app.include_router(peserta.router)


@app.get("/health", tags=["System"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "pilar-fastapi"}
