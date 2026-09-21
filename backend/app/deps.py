from __future__ import annotations

import time
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client

from .supabase import (
    get_service_client,
    is_transient_supabase_error,
    reset_service_client,
)


# ---------------------------------------------------------------------------
# Per-token auth verification cache (short TTL)
# ---------------------------------------------------------------------------
# Every peserta page load triggers 2-3 parallel API calls, each of which
# independently verifies the JWT via Supabase.  This cache ensures the
# expensive get_claims() + users-table lookup only happens once per token
# within a 10-second window.
# ---------------------------------------------------------------------------

_auth_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_AUTH_CACHE_TTL = 10  # seconds
_AUTH_CACHE_MAX = 100


def _get_cached_user(token: str) -> dict[str, Any] | None:
    entry = _auth_cache.get(token)
    if entry is None:
        return None
    ts, user = entry
    if time.monotonic() - ts > _AUTH_CACHE_TTL:
        _auth_cache.pop(token, None)
        return None
    return user


def _set_cached_user(token: str, user: dict[str, Any]) -> None:
    if len(_auth_cache) >= _AUTH_CACHE_MAX:
        # Evict oldest entries.
        now = time.monotonic()
        stale = [k for k, (ts, _) in _auth_cache.items() if now - ts > _AUTH_CACHE_TTL]
        for k in stale:
            _auth_cache.pop(k, None)
    _auth_cache[token] = (time.monotonic(), user)


bearer_scheme = HTTPBearer(auto_error=False)


def _claims_dict(claims_response: Any) -> dict[str, Any]:
    """Normalize the get_claims() response across supabase-py versions."""
    claims = getattr(claims_response, "claims", None)
    if claims is None and isinstance(claims_response, dict):
        claims = claims_response.get("claims", claims_response)
    if not isinstance(claims, dict):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token Supabase tidak valid",
        )
    return claims


def get_access_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token diperlukan",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials



def get_current_user(
    access_token: str = Depends(get_access_token),
    service: Client = Depends(get_service_client),
) -> dict[str, Any]:
    """
    Verify a Supabase JWT and resolve it to public.users through auth_user_id.

    The lookup itself is done with the request-scoped client, so the users RLS
    policy is still in force.
    """
    # Fast path: return cached result if the same token was verified recently.
    cached = _get_cached_user(access_token)
    if cached is not None:
        return cached

    try:
        claims_response = service.auth.get_claims(jwt=access_token)
        claims = _claims_dict(claims_response)
    except Exception as exc:
        if is_transient_supabase_error(exc):
            reset_service_client()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Layanan Supabase sementara tidak tersedia",
            ) from exc

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token Supabase tidak valid atau sudah kedaluwarsa",
        ) from exc

    auth_user_id = claims.get("sub")
    if not auth_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak memiliki subject user",
        )

    try:
        response = (
            service.table("users")
            .select("id,auth_user_id,username,email,is_active,created_at,updated_at")
            .eq("auth_user_id", auth_user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if is_transient_supabase_error(exc):
            reset_service_client()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gagal membaca profil user",
        ) from exc

    rows = getattr(response, "data", None) or []
    user = rows[0] if isinstance(rows, list) else rows
    if not user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun Supabase belum terhubung ke users aplikasi",
        )

    if not user.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun tidak aktif",
        )

    user["auth_user_id"] = auth_user_id
    user["claims"] = claims

    # Cache the verified user for subsequent parallel requests.
    _set_cached_user(access_token, user)
    return user


def get_current_user_roles(
    current_user: dict[str, Any] = Depends(get_current_user),
    service: Client = Depends(get_service_client),
) -> tuple[dict[str, Any], set[str]]:
    # Check if roles are already cached on the user dict (populated by auth cache).
    if "_cached_roles" in current_user:
        return current_user, current_user["_cached_roles"]

    try:
        response = (
            service.table("user_roles")
            .select("role:roles(name)")
            .eq("user_id", current_user["id"])
            .execute()
        )
    except Exception as exc:
        if is_transient_supabase_error(exc):
            reset_service_client()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gagal membaca role user",
        ) from exc

    roles: set[str] = set()
    for item in response.data or []:
        role = item.get("role") or {}
        name = role.get("name")
        if name:
            roles.add(str(name).lower())

    # Attach to user dict so subsequent calls in the same request window reuse it.
    current_user["_cached_roles"] = roles
    return current_user, roles


def require_admin(
    data: tuple[dict[str, Any], set[str]] = Depends(get_current_user_roles),
) -> dict[str, Any]:
    current_user, roles = data
    if "admin" not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses admin diperlukan",
        )
    return current_user


def require_reviewer(
    data: tuple[dict[str, Any], set[str]] = Depends(get_current_user_roles),
) -> dict[str, Any]:
    current_user, roles = data
    if "reviewer" not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses reviewer diperlukan",
        )
    return current_user


def require_peserta(
    data: tuple[dict[str, Any], set[str]] = Depends(get_current_user_roles),
) -> dict[str, Any]:
    current_user, roles = data
    if "peserta" not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses peserta diperlukan",
        )
    return current_user
