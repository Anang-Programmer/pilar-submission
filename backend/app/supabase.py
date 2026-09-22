from __future__ import annotations

import threading
import time

import httpx
from supabase import Client, create_client

from .config import settings

try:  # pragma: no cover - fallback menjaga kompatibilitas versi supabase-py
    from supabase.lib.client_options import SyncClientOptions
except Exception:  # pragma: no cover
    SyncClientOptions = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Penyetelan transport HTTP
# ---------------------------------------------------------------------------
# Hasil pengukuran langsung ke project Supabase (region ap-southeast-1):
#   - 1 query PostgREST dengan koneksi hangat : ~37 ms
#   - 1 query dengan koneksi baru (TLS penuh) : ~179 ms   (+142 ms)
#   - TCP+TLS handshake saja                  : ~118 ms
#   - idle <= 5 detik  : koneksi masih hidup, penalti  +1 s/d +11 ms
#   - idle >= 6 detik  : server memutus koneksi, penalti +77 s/d +142 ms
#
# Server Supabase menutup koneksi yang idle sekitar 5 detik, sedangkan httpx
# default juga membuang keep-alive setelah 5 detik. Keduanya membuat setiap
# jeda singkat (user membaca halaman, mengetik, berpikir) dibayar handshake
# TLS penuh pada request berikutnya - inilah sumber latency yang terasa
# tidak konsisten.
#
# Solusinya: satu pool httpx bersama untuk PostgREST/Auth/Storage/Functions
# (semuanya satu origin, jadi cukup satu koneksi HTTP/2), dan koneksi utama
# dijaga tetap hangat oleh heartbeat yang lebih sering daripada batas idle
# server. Heartbeat berhenti sendiri bila tidak ada aktivitas supaya tidak
# mengirim trafik percuma saat aplikasi sedang tidak dipakai.
#
# keepalive_expiry SENGAJA dipertahankan di bawah batas idle server (~5 detik),
# bukan dipanjangkan. Kalau httpx menahan koneksi idle lebih lama daripada yang
# diizinkan server, koneksi basi bisa dipakai ulang dan memicu
# RemoteProtocolError. Konektivitas dijaga oleh heartbeat, bukan oleh nilai
# keepalive yang panjang.
# ---------------------------------------------------------------------------

_KEEPALIVE_EXPIRY = 4.0
_MAX_CONNECTIONS = 50
# Wajib lebih kecil dari _KEEPALIVE_EXPIRY supaya heartbeat selalu memperbarui
# koneksi utama sebelum httpx membuangnya.
_HEARTBEAT_INTERVAL = 3.0
# Heartbeat hanya jalan selang waktu ini setelah request terakhir.
_ACTIVITY_WINDOW = 180.0
_CONNECT_TIMEOUT = 10.0
_READ_TIMEOUT = 120.0
_WRITE_TIMEOUT = 120.0
_POOL_TIMEOUT = 60.0
_GRACEFUL_CLOSE_DELAY = 15.0

# postgrest-py hanya mengulang request pada status 503/520, bukan pada error
# transport. Akibatnya RemoteProtocolError naik sebagai HTTP 503, lalu frontend
# menambah sleep 350 ms dan mencoba ulang - satu koneksi basi terasa seperti
# lonjakan latency besar. Error semacam itu ditangani di lapisan transport.
_RETRYABLE_METHODS = frozenset({"GET", "HEAD"})
_MAX_TRANSPORT_RETRIES = 2
_TRANSPORT_RETRY_DELAY = 0.05


class ResilientClient(httpx.Client):
    """httpx.Client yang mengulang request idempoten saat koneksi diputus server.

    Hanya GET/HEAD yang diulang karena keduanya idempoten. Mutasi (POST, PATCH,
    DELETE) tidak pernah diulang otomatis supaya tidak menulis dua kali.
    """

    def request(self, method, url, *args, **kwargs):
        last_exc: Exception | None = None
        for attempt in range(_MAX_TRANSPORT_RETRIES + 1):
            try:
                return super().request(method, url, *args, **kwargs)
            except httpx.RemoteProtocolError as exc:
                if str(method).upper() not in _RETRYABLE_METHODS:
                    raise
                last_exc = exc
                if attempt >= _MAX_TRANSPORT_RETRIES:
                    raise
                time.sleep(_TRANSPORT_RETRY_DELAY * (attempt + 1))
        # Tidak terjangkau; penjaga agar mypy/pemeriksa alur tetap tenang.
        raise last_exc  # pragma: no cover

    def send(self, request, **kwargs):
        last_exc: Exception | None = None
        for attempt in range(_MAX_TRANSPORT_RETRIES + 1):
            try:
                return super().send(request, **kwargs)
            except httpx.RemoteProtocolError as exc:
                if request.method.upper() not in _RETRYABLE_METHODS:
                    raise
                last_exc = exc
                if attempt >= _MAX_TRANSPORT_RETRIES:
                    raise
                time.sleep(_TRANSPORT_RETRY_DELAY * (attempt + 1))
        raise last_exc  # pragma: no cover


_shared_http_client: httpx.Client | None = None
_http_client_lock = threading.Lock()
_cached_service_client: Client | None = None
_service_client_lock = threading.Lock()
_heartbeat_thread: threading.Thread | None = None
_heartbeat_started = False
_last_activity = time.monotonic()


def _mark_activity() -> None:
    """Catat bahwa ada request; dipakai heartbeat untuk tetap aktif."""
    global _last_activity
    _last_activity = time.monotonic()


def _build_shared_http_client() -> httpx.Client:
    """Satu httpx.Client yang dipakai bersama semua sub-klien Supabase.

    Tidak boleh memasang base_url ataupun header apikey/Authorization di sini:
    sub-klien PostgREST/Auth/Storage memakai URL absolut dan header berbeda per
    request, jadi client bersama wajib bersifat netral.

    PostgREST, Auth, Storage, dan Functions semuanya satu origin, sehingga satu
    koneksi HTTP/2 yang hangat sudah melayani seluruh aplikasi.
    """
    return ResilientClient(
        transport=httpx.HTTPTransport(retries=2, http2=True),
        limits=httpx.Limits(
            max_connections=_MAX_CONNECTIONS,
            max_keepalive_connections=_MAX_CONNECTIONS,
            keepalive_expiry=_KEEPALIVE_EXPIRY,
        ),
        timeout=httpx.Timeout(
            connect=_CONNECT_TIMEOUT,
            read=_READ_TIMEOUT,
            write=_WRITE_TIMEOUT,
            pool=_POOL_TIMEOUT,
        ),
        follow_redirects=True,
    )


def _get_shared_http_client() -> httpx.Client | None:
    """Kembalikan client bersama, buat ulang kalau sudah tertutup."""
    global _shared_http_client

    client = _shared_http_client
    if client is not None and not client.is_closed:
        return client

    with _http_client_lock:
        if _shared_http_client is None or _shared_http_client.is_closed:
            _shared_http_client = _build_shared_http_client()
        return _shared_http_client


def _close_later(client: httpx.Client) -> None:
    """Tutup client lama setelah request yang sedang berjalan selesai."""
    time.sleep(_GRACEFUL_CLOSE_DELAY)
    try:
        if not client.is_closed:
            client.close()
    except Exception:
        pass


def _heartbeat_loop() -> None:
    """Jaga koneksi tetap hangat supaya tidak ada handshake TLS berulang.

    Hanya menyentuh jaringan setiap _HEARTBEAT_INTERVAL detik dan hanya selama
    masih ada aktivitas aplikasi. Tidak pernah melempar exception ke luar
    thread.
    """
    while True:
        time.sleep(_HEARTBEAT_INTERVAL)
        try:
            if time.monotonic() - _last_activity > _ACTIVITY_WINDOW:
                # Tidak ada request: biarkan koneksi mati sendiri, jangan
                # mengirim trafik percuma.
                continue
            client = _shared_http_client
            if client is None or client.is_closed:
                continue
            # Status respons tidak penting; tujuannya murni menjaga agar socket
            # yang sudah terbuka tetap hidup di pool. Satu origin yang sama
            # dipakai PostgREST, Auth, Storage, dan Functions sekaligus.
            client.head(f"{settings.supabase_url}/rest/v1/")
        except Exception:
            pass


def _start_heartbeat() -> None:
    global _heartbeat_thread, _heartbeat_started

    if _heartbeat_started:
        return

    with _http_client_lock:
        if _heartbeat_started:
            return
        _heartbeat_started = True
        _heartbeat_thread = threading.Thread(
            target=_heartbeat_loop,
            name="supabase-keepalive",
            daemon=True,
        )
        _heartbeat_thread.start()


def _build_service_client(http_client: httpx.Client | None) -> Client:
    if SyncClientOptions is None or http_client is None:
        # Perilaku lama, dipertahankan sebagai jalur aman bila library berubah.
        return create_client(settings.supabase_url, settings.supabase_secret_key)

    options = SyncClientOptions(
        httpx_client=http_client,
        postgrest_client_timeout=_READ_TIMEOUT,
        storage_client_timeout=_READ_TIMEOUT,
    )
    return create_client(settings.supabase_url, settings.supabase_secret_key, options)


def get_service_client() -> Client:
    """
    Server-only Supabase client.

    Uses the secret/service key and therefore MUST NEVER be exposed to the
    frontend. Use this only for privileged operations such as Supabase Auth
    Admin API calls.

    Semua sub-klien berbagi satu pool koneksi HTTP agar satu handshake TLS
    dipakai untuk query PostgREST, Auth, Storage, sekaligus Functions.

    Fungsi ini di-inject sebagai Depends() pada setiap request, jadi panggilan
    di sini sekaligus menjadi penanda bahwa aplikasi sedang aktif dipakai.
    Singleton dikelola manual (bukan lru_cache) supaya penanda aktivitas
    benar-benar diperbarui setiap request.
    """
    global _cached_service_client

    _mark_activity()

    client = _cached_service_client
    if client is not None:
        return client

    with _service_client_lock:
        if _cached_service_client is None:
            http_client = _get_shared_http_client()
            _start_heartbeat()
            _cached_service_client = _build_service_client(http_client)
        return _cached_service_client


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
    global _cached_service_client, _shared_http_client

    _cached_service_client = None

    old = _shared_http_client
    _shared_http_client = _build_shared_http_client()
    if old is not None and not old.is_closed:
        # Jangan tutup langsung: request lain mungkin masih memakainya.
        threading.Thread(
            target=_close_later, args=(old,), name="supabase-close-old", daemon=True
        ).start()
