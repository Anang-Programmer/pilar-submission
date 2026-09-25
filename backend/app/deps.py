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
# within the TTL window.
#
# TTL 10 detik hampir tidak pernah kena pada pemakaian normal (sekali membaca
# halaman sudah lewat 10 detik), sehingga setiap navigasi membayar ulang
# verifikasi penuh: get_claims + users + user_roles = 3 round-trip sekuensial.
# Diperpanjang jadi 30 detik. Trade-off: perubahan role / non-aktifnya user
# baru berlaku maksimal 30 detik setelahnya; turunkan _AUTH_CACHE_TTL bila
# ingin lebih ketat.
# ---------------------------------------------------------------------------

_auth_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_AUTH_CACHE_TTL = 30  # seconds
_AUTH_CACHE_MAX = 500


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
        # Buang entri kedaluwarsa lebih dulu, lalu yang paling tua. Tanpa
        # langkah kedua ini cache bisa tumbuh tak terbatas selama semua entri
        # masih segar.
        now = time.monotonic()
        stale = [k for k, (ts, _) in _auth_cache.items() if now - ts > _AUTH_CACHE_TTL]
        for k in stale:
            _auth_cache.pop(k, None)
        while len(_auth_cache) >= _AUTH_CACHE_MAX:
            oldest = min(_auth_cache, key=lambda k: _auth_cache[k][0])
            _auth_cache.pop(oldest, None)
    _auth_cache[token] = (time.monotonic(), user)


bearer_scheme = HTTPBearer(auto_error=False)


# Kolom users yang dibaca saat verifikasi token. Versi embedded menambahkan
# user_roles agar profil + role selesai dalam satu round-trip. Hasil keduanya
# sudah diverifikasi identik pada data nyata.
_USER_PLAIN_SELECT = "id,auth_user_id,username,email,is_active,created_at,updated_at"
_USER_EMBEDDED_SELECT = _USER_PLAIN_SELECT + ",user_roles(role:roles(name))"


def _extract_role_names(rows: Any) -> set[str] | None:
    """Ubah hasil embed user_roles menjadi himpunan nama role lowercase.

    Kembalikan None bila bentuk datanya tidak dikenali, supaya pemanggil
    memakai jalur query user_roles yang terpisah (perilaku asli) alih-alih
    menyimpulkan user tidak punya role.
    """
    if rows is None:
        return None
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        return None

    roles: set[str] = set()
    for item in rows:
        if not isinstance(item, dict):
            return None
        role = item.get("role") or {}
        if not isinstance(role, dict):
            return None
        name = role.get("name")
        if name:
            roles.add(str(name).lower())
    return roles


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
        try:
            # Ambil profil user sekaligus role-nya dalam SATU round-trip.
            # Terpisah, users + user_roles = 2 round-trip sekuensial.
            response = (
                service.table("users")
                .select(_USER_EMBEDDED_SELECT)
                .eq("auth_user_id", auth_user_id)
                .limit(1)
                .execute()
            )
        except Exception:
            # Relasi embed mungkin tidak tersedia pada skema ini. Mundur ke
            # query asli; bila query ini juga gagal, exception-nya diteruskan
            # ke handler di bawah sehingga penanganan 503/401 tidak berubah.
            response = (
                service.table("users")
                .select(_USER_PLAIN_SELECT)
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
    # rows[0] pada list kosong dulunya melempar IndexError sehingga berakhir
    # sebagai 500. Dijaga di sini agar cabang 403 di bawah yang berperan,
    # persis seperti niat asli kode ini.
    user = (rows[0] if rows else {}) if isinstance(rows, list) else rows
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

    # Role ikut terbawa bila query embed berhasil, sehingga
    # get_current_user_roles tidak perlu round-trip ketiga. Bentuk dict user
    # tetap sama seperti semula karena key embed dibuang. Bila bentuknya tidak
    # dikenali, _cached_roles sengaja tidak diisi agar jalur query terpisah di
    # get_current_user_roles tetap dipakai.
    embedded_roles = user.pop("user_roles", None)
    role_names = _extract_role_names(embedded_roles)
    if role_names is not None:
        user["_cached_roles"] = role_names

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


def require_admin_or_dashboard(
    data: tuple[dict[str, Any], set[str]] = Depends(get_current_user_roles),
) -> dict[str, Any]:
    """Allow admin and dashboard roles to consume read-only monitoring endpoints."""
    current_user, roles = data
    if "admin" not in roles and "dashboard" not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses monitoring diperlukan",
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
