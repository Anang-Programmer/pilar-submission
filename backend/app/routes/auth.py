from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from ..deps import get_current_user, get_current_user_roles
from ..schemas import CurrentUserOut
from ..supabase import (
    get_service_client,
    is_transient_supabase_error,
    reset_service_client,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.get("/me", response_model=CurrentUserOut)
def me(
    data: tuple[dict, set[str]] = Depends(get_current_user_roles),
):
    current_user, roles = data
    role = None
    
    normalized_roles = list(roles)
    for preferred in ("admin", "reviewer", "peserta"):
        if preferred in normalized_roles:
            role = preferred
            break

    return {
        **current_user,
        "role": role,
        "roles": normalized_roles,
    }

@router.get("/resolve-username")
def resolve_username(
    username: str,
    supabase: Client = Depends(get_service_client),
):
    normalized = username.strip()
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username wajib diisi.",
        )

    try:
        response = (
            supabase.table("users")
            .select("email")
            .eq("username", normalized)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if is_transient_supabase_error(exc):
            reset_service_client()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Layanan login sedang tidak tersedia. Silakan coba lagi.",
        ) from exc

    rows = response.data or []
    if not rows or not rows[0].get("email"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username atau password salah.",
        )

    return {"email": rows[0]["email"]}
