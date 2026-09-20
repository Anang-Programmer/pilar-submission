from __future__ import annotations

from functools import lru_cache

import httpx
from supabase import Client, create_client
from supabase.client import ClientOptions

from .config import settings


@lru_cache(maxsize=1)
def get_service_client() -> Client:
    """
    Server-only Supabase client.

    Uses the secret/service key and therefore MUST NEVER be exposed to the
    frontend. Use this only for privileged operations such as Supabase Auth
    Admin API calls.
    """
    return create_client(settings.supabase_url, settings.supabase_secret_key)


def get_user_client(access_token: str) -> Client:
    """
    Create a request-scoped client carrying the caller's Supabase access token.

    Database calls made through this client are evaluated by Supabase/PostgREST
    with the caller identity, so the public-schema RLS policies remain active.
    """
    return create_client(
        settings.supabase_url,
        settings.supabase_key,
        options=ClientOptions(
            headers={"Authorization": f"Bearer {access_token}"},
        ),
    )


TRANSIENT_SUPABASE_ERRORS = (
    httpx.TransportError,
    httpx.TimeoutException,
)


def is_transient_supabase_error(exc: BaseException) -> bool:
    """Return True for temporary HTTP/network failures to Supabase."""
    seen: set[int] = set()
    current: BaseException | None = exc

    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, TRANSIENT_SUPABASE_ERRORS):
            return True
        current = current.__cause__ or current.__context__

    return False


def reset_service_client() -> None:
    """Drop the cached service client so the next request gets a fresh pool."""
    get_service_client.cache_clear()
