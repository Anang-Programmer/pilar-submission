from __future__ import annotations

import os
import time
import threading
from pathlib import Path
from datetime import datetime
from typing import Any
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import RedirectResponse
from supabase import Client

from ..deps import require_peserta
from ..supabase import (
    get_service_client,
    is_transient_supabase_error,
    reset_service_client,
)


router = APIRouter(prefix="/api/peserta", tags=["Peserta"])


# ---------------------------------------------------------------------------
# Per-user participant context cache (short TTL)
# ---------------------------------------------------------------------------
# _participant_context() runs 10-15+ serial Supabase queries and is called
# by EVERY peserta endpoint.  When the dashboard page loads, the frontend
# fires /dashboard + /articles in parallel — both call _participant_context()
# in full, totalling 20-30+ Supabase roundtrips.  This alone causes the
# Vercel 10s timeout → 503.
#
# Solution: cache the context result per user_id for a few seconds.  The
# second parallel request instantly gets the cached result.  Mutations
# (POST/PATCH/DELETE) clear the cache for the affected user.
# ---------------------------------------------------------------------------

_context_cache: dict[int, tuple[float, dict[str, Any]]] = {}
_CONTEXT_CACHE_TTL = 10  # seconds
_CONTEXT_CACHE_MAX = 50

_context_locks: dict[int, threading.Lock] = {}
_context_locks_lock = threading.Lock()


def _get_user_lock(user_id: int) -> threading.Lock:
    with _context_locks_lock:
        if user_id not in _context_locks:
            _context_locks[user_id] = threading.Lock()
        return _context_locks[user_id]


def _get_cached_context(user_id: int) -> dict[str, Any] | None:
    entry = _context_cache.get(user_id)
    if entry is None:
        return None
    ts, data = entry
    if time.monotonic() - ts > _CONTEXT_CACHE_TTL:
        _context_cache.pop(user_id, None)
        return None
    return data


def _set_cached_context(user_id: int, data: dict[str, Any]) -> None:
    if len(_context_cache) >= _CONTEXT_CACHE_MAX:
        now = time.monotonic()
        stale = [k for k, (ts, _) in _context_cache.items() if now - ts > _CONTEXT_CACHE_TTL]
        for k in stale:
            _context_cache.pop(k, None)
    _context_cache[user_id] = (time.monotonic(), data)


def _invalidate_context(user_id: int) -> None:
    """Clear cached context after a mutation."""
    _context_cache.pop(user_id, None)


def _raise_supabase_error(exc: Exception, default_message: str) -> None:
    if is_transient_supabase_error(exc):
        reset_service_client()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Layanan Supabase sementara tidak tersedia",
        ) from exc

    message = str(exc).lower()
    if any(token in message for token in ("duplicate key", "unique constraint", "already exists")):
        raise HTTPException(status_code=409, detail="Data sudah tersedia") from exc

    raise HTTPException(status_code=400, detail=default_message) from exc


def _normalize_status(value: Any) -> str:
    return str(value or "").strip().lower()


def _student_profile(service: Client, user_id: int) -> dict[str, Any]:
    student = (
        service.table("students")
        .select("id,user_id,nim,full_name,study_program,class_name,phone,created_at,updated_at")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
        .data
    )
    if not student:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun peserta belum memiliki profil students",
        )
    return student


def _owned_project_ids(service: Client, student_id: int) -> set[int]:
    ids: set[int] = set()

    own_projects = (
        service.table("projects")
        .select("id")
        .eq("submitted_by", student_id)
        .execute()
        .data
        or []
    )
    ids.update(int(row["id"]) for row in own_projects if row.get("id") is not None)

    member_projects = (
        service.table("project_members")
        .select("project_id")
        .eq("student_id", student_id)
        .execute()
        .data
        or []
    )
    ids.update(int(row["project_id"]) for row in member_projects if row.get("project_id") is not None)
    return ids


def _owned_article_ids(service: Client, student_id: int, project_ids: set[int]) -> set[int]:
    ids: set[int] = set()

    authored = (
        service.table("article_authors")
        .select("article_id")
        .eq("student_id", student_id)
        .execute()
        .data
        or []
    )
    ids.update(int(row["article_id"]) for row in authored if row.get("article_id") is not None)

    if project_ids:
        project_articles = (
            service.table("articles")
            .select("id")
            .in_("project_id", list(project_ids))
            .execute()
            .data
            or []
        )
        ids.update(int(row["id"]) for row in project_articles if row.get("id") is not None)

    return ids


def _load_journals(service: Client, journal_ids: set[int]) -> dict[int, dict[str, Any]]:
    if not journal_ids:
        return {}
    rows = (
        service.table("journals")
        .select("id,name,abbreviation,sinta_level,field,website_url,submission_url,template_url,apc_info,is_active")
        .in_("id", list(journal_ids))
        .execute()
        .data
        or []
    )
    return {int(row["id"]): row for row in rows}


def _load_courses(service: Client, course_ids: set[int]) -> dict[int, dict[str, Any]]:
    if not course_ids:
        return {}
    rows = (
        service.table("courses")
        .select("id,code,name,semester,study_program")
        .in_("id", list(course_ids))
        .execute()
        .data
        or []
    )
    return {int(row["id"]): row for row in rows}


def _load_authors(
    service: Client,
    article_ids: set[int],
) -> tuple[dict[int, list[dict[str, Any]]], dict[int, dict[str, Any]]]:
    if not article_ids:
        return {}, {}

    rows = (
        service.table("article_authors")
        .select("id,article_id,student_id,author_order,is_corresponding")
        .in_("article_id", list(article_ids))
        .order("author_order")
        .execute()
        .data
        or []
    )
    student_ids = {int(row["student_id"]) for row in rows if row.get("student_id") is not None}
    students = (
        service.table("students")
        .select("id,user_id,nim,full_name,study_program,class_name")
        .in_("id", list(student_ids))
        .execute()
        .data
        if student_ids
        else []
    )
    student_map = {int(row["id"]): row for row in (students or [])}

    authors_by_article: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        item = dict(row)
        item["student"] = student_map.get(int(row["student_id"])) if row.get("student_id") is not None else None
        authors_by_article.setdefault(int(row["article_id"]), []).append(item)

    return authors_by_article, student_map


def _load_current_versions(service: Client, version_ids: set[int]) -> dict[int, dict[str, Any]]:
    if not version_ids:
        return {}
    rows = (
        service.table("article_versions")
        .select(
            "id,article_id,version_number,file_name,file_path,file_url,file_type,file_size,"
            "uploaded_by,version_status,submission_note,uploaded_at"
        )
        .in_("id", list(version_ids))
        .execute()
        .data
        or []
    )
    return {int(row["id"]): row for row in rows}


def _load_latest_reviews(
    service: Client,
    article_ids: set[int],
) -> tuple[dict[int, dict[str, Any]], dict[int, int]]:
    if not article_ids:
        return {}, {}

    assignments = (
        service.table("reviewer_assignments")
        .select("id,article_id,article_version_id,reviewer_id,assigned_at,deadline,status,completed_at")
        .in_("article_id", list(article_ids))
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    assignment_ids = {int(row["id"]) for row in assignments if row.get("id") is not None}
    if not assignment_ids:
        return {}, {}

    reviews = (
        service.table("reviews")
        .select(
            "id,assignment_id,article_version_id,reviewer_id,recommendation,overall_score,"
            "methodology_score,originality_score,results_score,discussion_score,writing_score,"
            "comments_for_author,status,submitted_at,created_at,updated_at"
        )
        .in_("assignment_id", list(assignment_ids))
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )

    assignment_map = {int(row["id"]): row for row in assignments}
    latest_by_article: dict[int, dict[str, Any]] = {}
    submitted_counts: dict[int, int] = {}

    for review in reviews:
        assignment = assignment_map.get(int(review["assignment_id"])) if review.get("assignment_id") is not None else None
        if not assignment:
            continue
        article_id = int(assignment["article_id"])
        review_status = _normalize_status(review.get("status"))
        if review.get("submitted_at") or review_status == "submitted":
            submitted_counts[article_id] = submitted_counts.get(article_id, 0) + 1

        if article_id not in latest_by_article:
            item = dict(review)
            item["assignment"] = assignment
            latest_by_article[article_id] = item

    return latest_by_article, submitted_counts


def _load_latest_revision_requests(
    service: Client,
    article_ids: set[int],
) -> tuple[dict[int, dict[str, Any]], int]:
    if not article_ids:
        return {}, 0

    rows = (
        service.table("revision_requests")
        .select(
            "id,article_id,review_id,requested_by,revision_round,instructions,deadline,status,created_at,completed_at"
        )
        .in_("article_id", list(article_ids))
        .order("revision_round", desc=True)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )

    latest_by_article: dict[int, dict[str, Any]] = {}
    open_count = 0
    for row in rows:
        article_id = int(row["article_id"])
        if article_id not in latest_by_article:
            latest_by_article[article_id] = row
        current_status = _normalize_status(row.get("status"))
        if current_status in {"open", "pending", "requested", "revision_required"}:
            open_count += 1
    return latest_by_article, open_count


def _load_mentors(
    service: Client,
    article_ids: set[int],
) -> dict[int, dict[str, Any]]:
    if not article_ids:
        return {}

    assignments = (
        service.table("mentorship_assignments")
        .select("id,student_id,lecturer_id,article_id,assigned_by,assigned_at,status,notes")
        .in_("article_id", list(article_ids))
        .order("assigned_at", desc=True)
        .execute()
        .data
        or []
    )
    lecturer_ids = {int(row["lecturer_id"]) for row in assignments if row.get("lecturer_id") is not None}
    lecturers = (
        service.table("lecturers")
        .select("id,user_id,nidn,nip,full_name,academic_title,email")
        .in_("id", list(lecturer_ids))
        .execute()
        .data
        if lecturer_ids
        else []
    )
    lecturer_map = {int(row["id"]): row for row in (lecturers or [])}

    result: dict[int, dict[str, Any]] = {}
    for row in assignments:
        article_id = int(row["article_id"])
        if article_id not in result:
            item = dict(row)
            item["lecturer"] = lecturer_map.get(int(row["lecturer_id"])) if row.get("lecturer_id") is not None else None
            result[article_id] = item
    return result


def _progress_for_article(
    article: dict[str, Any],
    latest_review: dict[str, Any] | None,
    latest_revision: dict[str, Any] | None,
) -> int:
    raw_status = _normalize_status(article.get("status"))

    if article.get("finalized_at") or raw_status in {"finalized", "final", "selesai"}:
        return 100
    if latest_revision and _normalize_status(latest_revision.get("status")) in {"open", "pending", "requested", "revision_required"}:
        return 65
    if latest_review and latest_review.get("submitted_at"):
        recommendation = _normalize_status(latest_review.get("recommendation"))
        if recommendation == "accept":
            return 100
        if recommendation in {"major revision", "minor revision"}:
            return 65
        if recommendation == "review ulang":
            return 55
    if raw_status in {"selesai review", "selesai"}:
        return 100
    if raw_status in {"sedang revisi", "revision", "revision_requested"}:
        return 65
    if raw_status in {"sedang direview", "in_review", "review"}:
        return 55
    if article.get("current_version_id"):
        return 45
    if article.get("submitted_at"):
        return 35
    return 20


def _timeline(
    article: dict[str, Any] | None,
    selected_project: dict[str, Any] | None,
    latest_review: dict[str, Any] | None,
    latest_revision: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if not article and not selected_project:
        return []

    steps: list[dict[str, Any]] = []
    project_done = bool(selected_project and _normalize_status(selected_project.get("status")) in {"terpilih", "selected", "select"})
    steps.append({
        "key": "project_selected",
        "label": "Proyek ditetapkan",
        "state": "done" if project_done else "current",
        "detail": "Proyek masuk daftar terpilih PILAR PTIK 2026" if project_done else "Menunggu penetapan proyek",
    })

    article_submitted = bool(article and (article.get("submitted_at") or article.get("current_version_id")))
    steps.append({
        "key": "article_submitted",
        "label": "Artikel dikirim",
        "state": "done" if article_submitted else "pending",
        "detail": (
            f"Naskah aktif{' · v' + str(article.get('current_version_number')) if article.get('current_version_number') else ''}"
            if article_submitted
            else "Menunggu artikel dikirim"
        ),
    })

    revision_open = bool(
        latest_revision
        and _normalize_status(latest_revision.get("status")) in {"open", "pending", "requested", "revision_required"}
    )
    accepted = bool(
        latest_review
        and latest_review.get("submitted_at")
        and _normalize_status(latest_review.get("recommendation")) == "accept"
    )

    review_state = "current" if latest_review and not accepted and not revision_open else "done" if accepted or revision_open else "pending"
    review_detail = "Hasil review reviewer tersedia" if latest_review else "Menunggu proses review"
    steps.append({
        "key": "review",
        "label": "Review artikel",
        "state": review_state,
        "detail": review_detail,
    })

    steps.append({
        "key": "upload_revision",
        "label": "Upload revisi",
        "state": "current" if revision_open else "done" if accepted else "pending",
        "detail": (
            f"Revisi ronde {latest_revision.get('revision_round')} diperlukan"
            if revision_open and latest_revision
            else "Menunggu versi artikel berikutnya" if not accepted else "Tidak diperlukan revisi"
        ),
    })

    finalized = bool(article and (article.get("finalized_at") or _normalize_status(article.get("status")) in {"finalized", "final", "selesai"}))
    steps.append({
        "key": "finalization",
        "label": "Finalisasi",
        "state": "done" if finalized else "pending",
        "detail": "Artikel telah difinalisasi" if finalized else "Menunggu persetujuan akhir",
    })

    return steps


def _enrich_articles(
    service: Client,
    articles: list[dict[str, Any]],
    project_map: dict[int, dict[str, Any]],
    journal_map: dict[int, dict[str, Any]],
    course_map: dict[int, dict[str, Any]],
    student_id: int,
) -> list[dict[str, Any]]:
    article_ids = {int(row["id"]) for row in articles if row.get("id") is not None}
    version_ids = {int(row["current_version_id"]) for row in articles if row.get("current_version_id") is not None}

    with ThreadPoolExecutor(max_workers=5) as executor:
        f_authors = executor.submit(_load_authors, service, article_ids)
        f_versions = executor.submit(_load_current_versions, service, version_ids)
        f_reviews = executor.submit(_load_latest_reviews, service, article_ids)
        f_revisions = executor.submit(_load_latest_revision_requests, service, article_ids)
        f_mentors = executor.submit(_load_mentors, service, article_ids)

        authors_by_article, _ = f_authors.result()
        versions = f_versions.result()
        reviews_by_article, review_counts = f_reviews.result()
        revisions_by_article, _ = f_revisions.result()
        mentors = f_mentors.result()

    result: list[dict[str, Any]] = []
    for article in articles:
        article_id = int(article["id"])
        current_version = versions.get(int(article["current_version_id"])) if article.get("current_version_id") else None
        current_version_number = current_version.get("version_number") if current_version else None
        latest_review = reviews_by_article.get(article_id)
        latest_revision = revisions_by_article.get(article_id)
        item = dict(article)
        item["project"] = project_map.get(int(article["project_id"])) if article.get("project_id") else None
        item["journal"] = journal_map.get(int(article["journal_id"])) if article.get("journal_id") else None
        item["course"] = (
            course_map.get(int(item["project"]["course_id"]))
            if item.get("project") and item["project"].get("course_id")
            else None
        )
        item["authors"] = sorted(authors_by_article.get(article_id, []), key=lambda row: row.get("author_order") or 0)
        item["current_version"] = current_version
        item["current_version_number"] = current_version_number
        item["latest_review"] = latest_review
        item["latest_revision_request"] = latest_revision
        item["review_count"] = review_counts.get(article_id, 0)
        item["pendamping"] = mentors.get(article_id)
        item["progress"] = _progress_for_article(article, latest_review, latest_revision)
        item["is_current_author"] = any(
            int(row.get("student_id")) == student_id for row in authors_by_article.get(article_id, []) if row.get("student_id") is not None
        )
        result.append(item)
    return result


def _participant_context(service: Client, current_user: dict[str, Any]) -> dict[str, Any]:
    user_id = int(current_user["id"])

    # Fast path: return cached context if available.
    cached = _get_cached_context(user_id)
    if cached is not None:
        return cached

    with _get_user_lock(user_id):
        # Double check after acquiring lock
        cached = _get_cached_context(user_id)
        if cached is not None:
            return cached

        student = _student_profile(service, user_id)
        project_ids = _owned_project_ids(service, int(student["id"]))
        article_ids = _owned_article_ids(service, int(student["id"]), project_ids)

        def fetch_projects():
            return (
                service.table("projects")
                .select("id,title,description,course_id,project_type,project_url,documentation_url,submitted_by,submitted_at,status,created_at,updated_at")
                .in_("id", list(project_ids))
                .order("created_at", desc=True)
                .execute()
                .data
                if project_ids
                else []
            )

        def fetch_selections():
            return (
                service.table("project_selection")
                .select("id,project_id,selected_by,selection_date,status,score,notes,created_at,updated_at")
                .in_("project_id", list(project_ids))
                .order("selection_date", desc=True)
                .execute()
                .data
                if project_ids
                else []
            )

        def fetch_articles():
            return (
                service.table("articles")
                .select("id,project_id,title,abstract,journal_id,status,current_version_id,submitted_at,finalized_at,created_at,updated_at")
                .in_("id", list(article_ids))
                .order("updated_at", desc=True)
                .execute()
                .data
                if article_ids
                else []
            )

        def fetch_assignments():
            return _load_participant_course_assignments(service, int(student["id"]))

        with ThreadPoolExecutor(max_workers=4) as executor:
            f_projects = executor.submit(fetch_projects)
            f_selections = executor.submit(fetch_selections)
            f_articles = executor.submit(fetch_articles)
            f_assignments = executor.submit(fetch_assignments)

            project_rows = f_projects.result() or []
            selection_rows = f_selections.result() or []
            article_rows = f_articles.result() or []
            participant_assignments = f_assignments.result()

        project_map = {int(row["id"]): row for row in project_rows}
        selection_map: dict[int, dict[str, Any]] = {}
        for row in selection_rows:
            selection_map.setdefault(int(row["project_id"]), row)

        journal_ids = {int(row["journal_id"]) for row in article_rows if row.get("journal_id") is not None}
        course_ids = {int(row["course_id"]) for row in project_rows if row.get("course_id") is not None}

        with ThreadPoolExecutor(max_workers=2) as executor:
            f_journals = executor.submit(_load_journals, service, journal_ids)
            f_courses = executor.submit(_load_courses, service, course_ids)
            journal_map = f_journals.result()
            course_map = f_courses.result()

        articles = _enrich_articles(
            service,
            article_rows,
            project_map,
            journal_map,
            course_map,
            int(student["id"]),
        )

        for project in project_rows:
            project_id = int(project["id"])
            project["course"] = course_map.get(int(project["course_id"])) if project.get("course_id") else None
            project["selection"] = selection_map.get(project_id)

    result = {
        "student": student,
        "projects": project_rows,
        "articles": articles,
        "selection_map": selection_map,
        "participant_assignments": participant_assignments,
    }

    # Cache the result so parallel requests skip the heavy query chain.
    _set_cached_context(user_id, result)
    return result


@router.get("/dashboard", response_model=dict[str, Any])
def dashboard(
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    try:
        context = _participant_context(supabase, current_peserta)
        articles = context["articles"]
        projects = context["projects"]
        selection_map: dict[int, dict[str, Any]] = context["selection_map"]

        selected_projects = [
            row for row in projects
            if _normalize_status((selection_map.get(int(row["id"])) or {}).get("status")) in {"terpilih", "selected", "select"}
            or _normalize_status(row.get("status")) in {"terpilih", "selected", "select"}
        ]
        active_article = articles[0] if articles else None
        active_project = (
            next(
                (row for row in selected_projects if active_article and int(row["id"]) == int(active_article.get("project_id"))),
                None,
            )
            if active_article
            else (selected_projects[0] if selected_projects else projects[0] if projects else None)
        )

        latest_review = active_article.get("latest_review") if active_article else None
        latest_revision = active_article.get("latest_revision_request") if active_article else None
        progress = _progress_for_article(active_article, latest_review, latest_revision) if active_article else 0
        review_count = sum(int(article.get("review_count") or 0) for article in articles)
        revision_count = sum(
            1 for article in articles
            if article.get("latest_revision_request")
            and _normalize_status(article["latest_revision_request"].get("status")) in {"open", "pending", "requested", "revision_required"}
        )

        latest_note = None
        article_finalized = bool(
            active_article
            and (
                active_article.get("finalized_at")
                or _normalize_status(active_article.get("status")) in {"finalized", "final", "selesai"}
            )
        )
        latest_revision_open = bool(
            latest_revision
            and _normalize_status(latest_revision.get("status")) in {"open", "pending", "requested", "revision_required"}
        )
        if article_finalized:
            latest_note = {
                "type": "final",
                "title": "Artikel telah difinalisasi",
                "message": "Artikel telah disetujui dan difinalisasi oleh Admin.",
                "created_at": active_article.get("finalized_at") or active_article.get("updated_at"),
            }
        elif latest_revision_open:
            latest_note = {
                "type": "revision",
                "title": "Revisi diperlukan",
                "message": latest_revision.get("instructions") or "Silakan tindak lanjuti catatan reviewer.",
                "created_at": latest_revision.get("created_at"),
            }
        elif latest_review and latest_review.get("comments_for_author"):
            latest_note = {
                "type": "review",
                "title": latest_review.get("recommendation") or "Hasil review",
                "message": latest_review.get("comments_for_author"),
                "created_at": latest_review.get("submitted_at") or latest_review.get("created_at"),
            }

        return {
            "student": context["student"],
            "summary": {
                "articles_count": len(articles),
                "reviews_count": review_count,
                "revisions_required": revision_count,
                "progress": progress,
                "selected_projects_count": len(selected_projects),
            },
            "active_project": active_project,
            "active_article": active_article,
            "timeline": _timeline(active_article, active_project, latest_review, latest_revision),
            "latest_note": latest_note,
            "recent_articles": articles[:5],
        }
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat dashboard peserta")
        raise AssertionError("unreachable")


@router.get("/articles", response_model=list[dict[str, Any]])
def list_articles(
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    try:
        context = _participant_context(supabase, current_peserta)
        return context["articles"]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat artikel peserta")
        raise AssertionError("unreachable")


@router.get("/articles/{article_id}", response_model=dict[str, Any])
def article_detail(
    article_id: int,
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    try:
        context = _participant_context(supabase, current_peserta)
        for article in context["articles"]:
            if int(article["id"]) == article_id:
                return article
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan atau bukan milik peserta")
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat detail artikel peserta")
        raise AssertionError("unreachable")


# ============================================================
# EXTENDED PARTICIPANT WORKFLOW
# ============================================================

ARTICLE_STORAGE_BUCKET = os.getenv("ARTICLE_STORAGE_BUCKET", "article-files")
ALLOWED_EXTENSIONS = {"pdf", "doc", "docx"}
MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB


def _file_extension(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def _normalize_public_article(article: dict[str, Any]) -> dict[str, Any]:
    return article


def _selected_project_rows(
    service: Client,
    context: dict[str, Any],
) -> list[dict[str, Any]]:
    articles_by_project = {
        int(article["project_id"]): article
        for article in context["articles"]
        if article.get("project_id") is not None
    }

    rows: list[dict[str, Any]] = []
    for project in context["projects"]:
        selection = project.get("selection")
        if (
            _normalize_status((selection or {}).get("status")) not in {"terpilih", "selected", "select"}
            and _normalize_status(project.get("status")) not in {"terpilih", "selected", "select"}
        ):
            continue

        item = dict(project)
        item["article"] = articles_by_project.get(int(project["id"]))
        rows.append(item)

    return rows


def _assert_owned_article(
    service: Client,
    current_user: dict[str, Any],
    article_id: int,
) -> tuple[dict[str, Any], dict[str, Any], set[int], dict[str, Any]]:
    context = _participant_context(service, current_user)
    student = context["student"]
    project_ids = _owned_project_ids(service, int(student["id"]))
    for article in context["articles"]:
        if int(article["id"]) == article_id:
            return article, student, project_ids, context
    raise HTTPException(
        status_code=404,
        detail="Artikel tidak ditemukan atau bukan milik peserta",
    )


def _storage_path(student_id: int, article_id: int, version_number: int, filename: str) -> str:
    safe_name = Path(filename).name.replace(" ", "_")
    return f"articles/{student_id}/{article_id}/v{version_number}_{safe_name}"


def _delete_storage_file(service: Client, file_path: str | None) -> None:
    if not file_path:
        return
    try:
        service.storage.from_(ARTICLE_STORAGE_BUCKET).remove([file_path])
    except Exception as exc:
        print(f"[WARN] Gagal menghapus file Storage {file_path}: {exc}")


def _upload_storage_file(service: Client, file_path: str, content: bytes, content_type: str) -> None:
    try:
        service.storage.from_(ARTICLE_STORAGE_BUCKET).upload(
            file_path,
            content,
            {"content-type": content_type or "application/octet-stream", "upsert": False},
        )
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal mengunggah file artikel ke Storage")
        raise AssertionError("unreachable")


def _make_signed_url(service: Client, file_path: str | None) -> str | None:
    if not file_path:
        return None
    try:
        result = service.storage.from_(ARTICLE_STORAGE_BUCKET).create_signed_url(file_path, 60 * 60)
        if isinstance(result, dict):
            return result.get("signedURL") or result.get("signedUrl") or result.get("url")
        return getattr(result, "signedURL", None) or getattr(result, "signedUrl", None)
    except Exception as exc:
        if is_transient_supabase_error(exc):
            reset_service_client()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Layanan Supabase sementara tidak tersedia",
            ) from exc
        print(f"[WARN] Signed URL gagal dibuat: {exc}")
        return None


def _load_all_versions(
    service: Client,
    article_id: int,
) -> list[dict[str, Any]]:
    rows = (
        service.table("article_versions")
        .select(
            "id,article_id,version_number,file_name,file_path,file_url,file_type,file_size,"
            "uploaded_by,version_status,submission_note,uploaded_at"
        )
        .eq("article_id", article_id)
        .order("version_number", desc=True)
        .execute()
        .data
        or []
    )
    return rows


def _latest_reviews_for_article(
    service: Client,
    article_id: int,
) -> list[dict[str, Any]]:
    assignments = (
        service.table("reviewer_assignments")
        .select(
            "id,article_id,article_version_id,reviewer_id,assigned_at,deadline,status,"
            "completed_at,created_at,updated_at"
        )
        .eq("article_id", article_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    assignment_ids = [int(row["id"]) for row in assignments if row.get("id") is not None]
    if not assignment_ids:
        return []

    assignment_map = {int(row["id"]): row for row in assignments}
    review_rows = (
        service.table("reviews")
        .select(
            "id,assignment_id,article_version_id,reviewer_id,recommendation,overall_score,"
            "methodology_score,originality_score,results_score,discussion_score,writing_score,"
            "comments_for_author,status,submitted_at,created_at,updated_at"
        )
        .in_("assignment_id", assignment_ids)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )

    reviewer_ids = {
        int(row["reviewer_id"])
        for row in review_rows
        if row.get("reviewer_id") is not None
    }

    reviewer_map: dict[int, str] = {}
    if reviewer_ids:
        lecturer_rows = (
            service.table("lecturers")
            .select("user_id,full_name,academic_title")
            .in_("user_id", list(reviewer_ids))
            .execute()
            .data
            or []
        )
        for lecturer in lecturer_rows:
            user_id = lecturer.get("user_id")
            if user_id is None:
                continue
            name = lecturer.get("full_name") or f"Reviewer #{user_id}"
            title = lecturer.get("academic_title")
            reviewer_map[int(user_id)] = f"{name}, {title}" if title else name

        # Fallback jika profil lecturer belum tersedia.
        missing_ids = reviewer_ids - set(reviewer_map.keys())
        if missing_ids:
            user_rows = (
                service.table("users")
                .select("id,username")
                .in_("id", list(missing_ids))
                .execute()
                .data
                or []
            )
            for user in user_rows:
                user_id = user.get("id")
                if user_id is not None:
                    reviewer_map[int(user_id)] = user.get("username") or f"Reviewer #{user_id}"

    result: list[dict[str, Any]] = []
    for review in review_rows:
        item = dict(review)
        item["assignment"] = assignment_map.get(int(review["assignment_id"]))
        item["reviewer_name"] = reviewer_map.get(int(review["reviewer_id"])) if review.get("reviewer_id") is not None else None
        result.append(item)
    return result


def _load_notifications_for_user(
    service: Client,
    user_id: int,
    limit: int = 8,
) -> list[dict[str, Any]]:
    try:
        return (
            service.table("notifications")
            .select("id,title,message,notification_type,reference_type,reference_id,is_read,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        if is_transient_supabase_error(exc):
            reset_service_client()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Layanan Supabase sementara tidak tersedia",
            ) from exc
        return []


@router.get("/projects", response_model=list[dict[str, Any]])
def list_participant_projects(
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    """Project milik peserta, terutama project yang sudah ditetapkan/selected."""
    try:
        context = _participant_context(supabase, current_peserta)
        return _selected_project_rows(supabase, context)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat project peserta")
        raise AssertionError("unreachable")


@router.get("/upload-context", response_model=dict[str, Any])
def upload_context(
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    """Data khusus halaman Upload Artikel."""
    try:
        context = _participant_context(supabase, current_peserta)
        journal_rows = (
            supabase.table("journals")
            .select(
                "id,name,abbreviation,sinta_level,field,website_url,submission_url,template_url,apc_info,is_active"
            )
            .order("name")
            .execute()
            .data
            or []
        )
        # Hanya journal yang secara eksplisit nonaktif yang disembunyikan.
        journals = [row for row in journal_rows if row.get("is_active") is not False]
        return {
            "student": context["student"],
            "participant_assignments": context["participant_assignments"],
            "projects": context["projects"],
            "journals": journals,
        }
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat data Upload Artikel")
        raise AssertionError("unreachable")


@router.get("/hasil-review", response_model=list[dict[str, Any]])
def participant_review_results(
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    try:
        context = _participant_context(supabase, current_peserta)
        result: list[dict[str, Any]] = []
        for article in context["articles"]:
            item = dict(article)
            item["reviews"] = _latest_reviews_for_article(supabase, int(article["id"]))
            result.append(item)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat hasil review peserta")
        raise AssertionError("unreachable")


@router.get("/riwayat", response_model=list[dict[str, Any]])
def participant_history(
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    try:
        context = _participant_context(supabase, current_peserta)
        rows: list[dict[str, Any]] = []
        for article in context["articles"]:
            versions = _load_all_versions(supabase, int(article["id"]))
            reviews = _latest_reviews_for_article(supabase, int(article["id"]))
            review_by_version: dict[int, list[dict[str, Any]]] = {}
            for review in reviews:
                if review.get("article_version_id") is not None:
                    review_by_version.setdefault(int(review["article_version_id"]), []).append(review)

            revision_rows = (
                supabase.table("revision_requests")
                .select("id,article_id,review_id,requested_by,revision_round,instructions,deadline,status,created_at,completed_at")
                .eq("article_id", int(article["id"]))
                .order("revision_round", desc=True)
                .order("created_at", desc=True)
                .execute()
                .data
                or []
            )

            revision_by_review: dict[int, dict[str, Any]] = {}
            for revision in revision_rows:
                if revision.get("review_id") is not None:
                    revision_by_review[int(revision["review_id"])] = revision

            for version in versions:
                version_reviews = review_by_version.get(int(version["id"]), [])
                recommendation = None
                description = "Artikel dikirim"
                status_value = version.get("version_status") or "submitted"
                if version_reviews:
                    latest = version_reviews[0]
                    recommendation = latest.get("recommendation")
                    description = latest.get("comments_for_author") or "Hasil review tersedia"
                    if recommendation:
                        status_value = recommendation
                    revision = revision_by_review.get(int(latest["id"]))
                    if revision:
                        status_value = "Major Revision" if "major" in _normalize_status(recommendation) else "Minor Revision"
                        description = revision.get("instructions") or description

                rows.append({
                    "article_id": int(article["id"]),
                    "article_title": article["title"],
                    "version": version,
                    "status": status_value,
                    "recommendation": recommendation,
                    "description": description,
                })

        rows.sort(
            key=lambda item: str((item.get("version") or {}).get("uploaded_at") or ""),
            reverse=True,
        )
        return rows
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat riwayat artikel peserta")
        raise AssertionError("unreachable")


def _load_participant_course_assignments(
    service: Client,
    student_id: int,
) -> list[dict[str, Any]]:
    """Load Mata Kuliah + Dosen Pendamping from Admin assignment data."""
    rows = (
        service.table("participant_course_assignments")
        .select("id,student_id,course_id,lecturer_id,assigned_by,assigned_at,status,updated_at")
        .eq("student_id", student_id)
        .order("assigned_at", desc=True)
        .execute()
        .data
        or []
    )

    course_ids = {int(row["course_id"]) for row in rows if row.get("course_id") is not None}
    lecturer_ids = {int(row["lecturer_id"]) for row in rows if row.get("lecturer_id") is not None}

    courses = (
        service.table("courses")
        .select("id,code,name,semester,study_program")
        .in_("id", list(course_ids))
        .execute()
        .data
        if course_ids
        else []
    )
    lecturers = (
        service.table("lecturers")
        .select("id,user_id,nidn,nip,full_name,academic_title,email")
        .in_("id", list(lecturer_ids))
        .execute()
        .data
        if lecturer_ids
        else []
    )

    course_map = {int(row["id"]): row for row in (courses or [])}
    lecturer_map = {int(row["id"]): row for row in (lecturers or [])}

    result: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["course"] = course_map.get(int(row["course_id"])) if row.get("course_id") is not None else None
        item["mentor"] = lecturer_map.get(int(row["lecturer_id"])) if row.get("lecturer_id") is not None else None
        result.append(item)
    return result


@router.get("/profil", response_model=dict[str, Any])
def participant_profile(
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    try:
        student = _student_profile(supabase, int(current_peserta["id"]))
        participant_assignments = _load_participant_course_assignments(
            supabase,
            int(student["id"]),
        )

        # Tetap pertahankan field mentors lama untuk kompatibilitas,
        # tetapi sumber Dosen Pendamping utama sekarang adalah
        # participant_course_assignments yang ditetapkan Admin.
        context = _participant_context(supabase, current_peserta)
        mentors: list[dict[str, Any]] = []
        seen: set[tuple[int, int]] = set()
        for article in context["articles"]:
            mentor = article.get("pendamping")
            lecturer = (mentor or {}).get("lecturer") if mentor else None
            if not mentor or not lecturer:
                continue
            key = (int(mentor["student_id"]), int(mentor["lecturer_id"]))
            if key in seen:
                continue
            seen.add(key)
            mentors.append(mentor)

        return {
            "user": {
                "id": current_peserta["id"],
                "username": current_peserta.get("username"),
                "email": current_peserta.get("email"),
            },
            "student": student,
            "mentors": mentors,
            "participant_assignments": participant_assignments,
        }
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat profil peserta")
        raise AssertionError("unreachable")


@router.patch("/profil", response_model=dict[str, Any])
def update_participant_profile(
    payload: dict[str, Any],
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    allowed = {
        "full_name": payload.get("full_name"),
        "phone": payload.get("phone"),
    }
    if not allowed["full_name"]:
        raise HTTPException(status_code=400, detail="Nama lengkap wajib diisi")

    try:
        student = _student_profile(supabase, int(current_peserta["id"]))
        response = (
            supabase.table("students")
            .update(allowed)
            .eq("id", int(student["id"]))
            .execute()
        )
        _invalidate_context(int(current_peserta["id"]))
        return response.data[0] if response.data else allowed
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menyimpan profil peserta")
        raise AssertionError("unreachable")


@router.post("/articles/upload", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
async def upload_initial_article(
    participant_assignment_id: int = Form(...),
    title: str = Form(...),
    journal_id: int = Form(...),
    submission_note: str = Form(""),
    file: UploadFile = File(...),
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    """Buat artikel awal dari assignment Mata Kuliah + Dosen Pendamping."""
    try:
        context = _participant_context(supabase, current_peserta)
        student = context["student"]
        assignment = next(
            (item for item in context["participant_assignments"] if int(item["id"]) == participant_assignment_id),
            None,
        )
        if not assignment:
            raise HTTPException(status_code=404, detail="Mata kuliah dan Dosen Pendamping belum ditetapkan Admin")
        if not assignment.get("course"):
            raise HTTPException(status_code=400, detail="Mata kuliah pada assignment tidak ditemukan")
        if not assignment.get("mentor"):
            raise HTTPException(status_code=400, detail="Dosen Pendamping pada assignment tidak ditemukan")

        journal_rows = (
            supabase.table("journals")
            .select("id,name,website_url,template_url,is_active")
            .eq("id", journal_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        journal = journal_rows[0] if journal_rows else None
        if not journal or journal.get("is_active") is False:
            raise HTTPException(status_code=404, detail="Jurnal tidak ditemukan atau tidak aktif")

        extension = _file_extension(file.filename)
        if extension not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Format file harus PDF, DOC, atau DOCX")

        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="File artikel kosong")
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="Ukuran file maksimal 15 MB")

        project_row = (
            supabase.table("projects")
            .insert({
                "title": title.strip(),
                "description": None,
                "course_id": int(assignment["course_id"]),
                "project_type": "article",
                "submitted_by": int(student["id"]),
                "submitted_at": datetime.utcnow().isoformat(),
                "status": "submitted",
            })
            .execute()
            .data
            or []
        )
        if not project_row:
            raise HTTPException(status_code=400, detail="Data artikel gagal disiapkan")
        project_id = int(project_row[0]["id"])

        article_row = (
            supabase.table("articles")
            .insert({
                "project_id": project_id,
                "title": title.strip(),
                "journal_id": journal_id,
                "status": "submitted",
                "submitted_at": datetime.utcnow().isoformat(),
            })
            .execute()
            .data
            or []
        )
        if not article_row:
            raise HTTPException(status_code=400, detail="Artikel gagal dibuat")
        article = article_row[0]
        article_id = int(article["id"])
        storage_path = _storage_path(int(student["id"]), article_id, 1, file.filename or "artikel")

        try:
            _upload_storage_file(supabase, storage_path, content, file.content_type or "application/octet-stream")
        except Exception:
            supabase.table("articles").delete().eq("id", article_id).execute()
            supabase.table("projects").delete().eq("id", project_id).execute()
            raise

        version_row = (
            supabase.table("article_versions")
            .insert({
                "article_id": article_id,
                "version_number": 1,
                "file_name": file.filename,
                "file_path": storage_path,
                "file_url": None,
                "file_type": extension,
                "file_size": len(content),
                "uploaded_by": int(current_peserta["id"]),
                "version_status": "submitted",
                "submission_note": submission_note.strip() or None,
            })
            .execute()
            .data
            or []
        )
        if not version_row:
            _delete_storage_file(supabase, storage_path)
            supabase.table("articles").delete().eq("id", article_id).execute()
            supabase.table("projects").delete().eq("id", project_id).execute()
            raise HTTPException(status_code=400, detail="Versi artikel gagal dibuat")

        version = version_row[0]
        updated = (
            supabase.table("articles")
            .update({"current_version_id": int(version["id"]), "status": "submitted"})
            .eq("id", article_id)
            .execute()
            .data
            or [article]
        )[0]

        # Semua anggota project menjadi penulis. Peserta yang mengunggah
        # ditempatkan pertama dan sebagai corresponding author.
        members = (
            supabase.table("project_members")
            .select("student_id")
            .eq("project_id", project_id)
            .order("id")
            .execute()
            .data
            or []
        )
        student_ids = [int(row["student_id"]) for row in members if row.get("student_id") is not None]
        if int(student["id"]) not in student_ids:
            student_ids.insert(0, int(student["id"]))
        else:
            student_ids.remove(int(student["id"]))
            student_ids.insert(0, int(student["id"]))

        for idx, student_id in enumerate(student_ids, start=1):
            supabase.table("article_authors").insert({
                "article_id": article_id,
                "student_id": student_id,
                "author_order": idx,
                "is_corresponding": idx == 1,
            }).execute()

        # Terapkan Dosen Pendamping dari assignment Admin ke artikel ini.
        supabase.table("mentorship_assignments").insert({
            "student_id": int(student["id"]),
            "lecturer_id": int(assignment["lecturer_id"]),
            "article_id": article_id,
            "assigned_by": int(assignment["assigned_by"]) if assignment.get("assigned_by") is not None else None,
            "assigned_at": datetime.utcnow().isoformat(),
            "status": "active",
        }).execute()

        _invalidate_context(int(current_peserta["id"]))

        return {
            "article": updated,
            "version": version,
            "message": "Artikel berhasil dikirim",
        }
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[UPLOAD ARTICLE ERROR] {type(exc).__name__}: {exc}")
        print(f"[UPLOAD ARTICLE ERROR REPR] {repr(exc)}")
        _raise_supabase_error(exc, "Gagal mengunggah artikel")
        raise AssertionError("unreachable")


@router.post("/articles/{article_id}/revisions", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
async def upload_revision(
    article_id: int,
    revision_note: str = Form(...),
    file: UploadFile = File(...),
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    """Upload versi artikel berikutnya tanpa mengubah reviewer assignment."""
    try:
        article, student, _, _ = _assert_owned_article(supabase, current_peserta, article_id)
        previous_version_id = int(article["current_version_id"]) if article.get("current_version_id") is not None else None
        open_revision = article.get("latest_revision_request")
        if open_revision and _normalize_status(open_revision.get("status")) not in {
            "open", "pending", "requested", "revision_required"
        }:
            open_revision = None
        if not open_revision:
            recommendation = _normalize_status((article.get("latest_review") or {}).get("recommendation"))
            if recommendation not in {"major revision", "minor revision"}:
                raise HTTPException(status_code=400, detail="Artikel belum memiliki permintaan revisi aktif")

        extension = _file_extension(file.filename)
        if extension not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Format file harus PDF, DOC, atau DOCX")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="File revisi kosong")
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="Ukuran file maksimal 15 MB")

        versions = _load_all_versions(supabase, article_id)
        next_number = max([int(v["version_number"]) for v in versions], default=0) + 1
        storage_path = _storage_path(int(student["id"]), article_id, next_number, file.filename or "artikel")
        _upload_storage_file(supabase, storage_path, content, file.content_type or "application/octet-stream")

        version_row = (
            supabase.table("article_versions")
            .insert({
                "article_id": article_id,
                "version_number": next_number,
                "file_name": file.filename,
                "file_path": storage_path,
                "file_url": None,
                "file_type": extension,
                "file_size": len(content),
                "uploaded_by": int(current_peserta["id"]),
                "version_status": "submitted",
                "submission_note": revision_note.strip(),
            })
            .execute()
            .data
            or []
        )
        if not version_row:
            _delete_storage_file(supabase, storage_path)
            raise HTTPException(status_code=400, detail="Versi revisi gagal dibuat")
        version = version_row[0]

        updated_article = (
            supabase.table("articles")
            .update({
                "current_version_id": int(version["id"]),
                "status": "submitted",
            })
            .eq("id", article_id)
            .execute()
            .data
            or []
        )

        # Pertahankan reviewer yang sama untuk ronde berikutnya.
        # Assignment lama diarahkan ke versi baru dan dikembalikan ke status
        # pending agar langsung muncul kembali sebagai "Perlu Direview".
        reviewer_assignment_rows = (
            supabase.table("reviewer_assignments")
            .select("id,article_id,article_version_id,reviewer_id,status,created_at")
            .eq("article_id", article_id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
            .data
            or []
        )
        active_reviewer_assignment = next(
            (row for row in reviewer_assignment_rows
             if _normalize_status(row.get("status")) in {"revision_requested", "revision", "sedang revisi"}),
            None,
        )
        if active_reviewer_assignment is None and previous_version_id is not None:
            active_reviewer_assignment = next(
                (row for row in reviewer_assignment_rows
                 if row.get("article_version_id") is not None
                 and int(row["article_version_id"]) == previous_version_id),
                None,
            )

        if active_reviewer_assignment is not None:
            supabase.table("reviewer_assignments").update({
                "article_version_id": int(version["id"]),
                "status": "pending",
                "completed_at": None,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", int(active_reviewer_assignment["id"])).execute()

        if open_revision and open_revision.get("id"):
            try:
                supabase.table("revision_requests").update({
                    "status": "completed",
                    "completed_at": datetime.utcnow().isoformat(),
                }).eq("id", int(open_revision["id"])).execute()
            except Exception as exc:
                print(f"[WARN] Gagal menandai revision request selesai: {exc}")

        _invalidate_context(int(current_peserta["id"]))

        return {
            "article": updated_article[0] if updated_article else article,
            "version": version,
            "message": f"Revisi v{next_number} berhasil dikirim",
        }
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal mengunggah revisi artikel")
        raise AssertionError("unreachable")


@router.get("/articles/{article_id}/versions/{version_id}/download")
def download_article_version(
    article_id: int,
    version_id: int,
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    """Kembalikan signed URL untuk file versi artikel milik peserta."""
    try:
        article, _, _, _ = _assert_owned_article(supabase, current_peserta, article_id)
        version = (
            supabase.table("article_versions")
            .select("id,article_id,file_path,file_url")
            .eq("id", version_id)
            .eq("article_id", int(article["id"]))
            .maybe_single()
            .execute()
            .data
        )
        if not version:
            raise HTTPException(status_code=404, detail="Versi artikel tidak ditemukan")
        signed_url = _make_signed_url(supabase, version.get("file_path"))
        if not signed_url:
            raise HTTPException(status_code=404, detail="File artikel tidak dapat diakses")
        return {"url": signed_url}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal membuka file artikel")
        raise AssertionError("unreachable")


@router.get("/notifikasi", response_model=list[dict[str, Any]])
def participant_notifications(
    current_peserta: dict[str, Any] = Depends(require_peserta),
    supabase: Client = Depends(get_service_client),
):
    try:
        return _load_notifications_for_user(supabase, int(current_peserta["id"]))
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat notifikasi peserta")
        raise AssertionError("unreachable")
