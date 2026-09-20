from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client

from .supabase import (
    get_service_client,
    get_user_client,
    is_transient_supabase_error,
    reset_service_client,
)


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


def get_supabase_user_client(
    access_token: str = Depends(get_access_token),
) -> Client:
    return get_user_client(access_token)


def get_current_user(
    access_token: str = Depends(get_access_token),
    service: Client = Depends(get_service_client),
) -> dict[str, Any]:
    """
    Verify a Supabase JWT and resolve it to public.users through auth_user_id.

    The lookup itself is done with the request-scoped client, so the users RLS
    policy is still in force.
    """
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
    return user


def get_current_user_roles(
    current_user: dict[str, Any] = Depends(get_current_user),
    service: Client = Depends(get_service_client),
) -> tuple[dict[str, Any], set[str]]:
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
