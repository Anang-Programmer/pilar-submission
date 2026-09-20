from __future__ import annotations

import os

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from supabase import Client

from ..deps import require_reviewer
from ..supabase import (
    get_service_client,
    is_transient_supabase_error,
    reset_service_client,
)


router = APIRouter(prefix="/api/reviewer", tags=["Reviewer"])


class ReviewerReviewPayload(BaseModel):
    recommendation: str | None = Field(default=None, max_length=50)
    overall_score: float | None = Field(default=None, ge=0, le=100)
    methodology_score: float | None = Field(default=None, ge=0, le=100)
    originality_score: float | None = Field(default=None, ge=0, le=100)
    results_score: float | None = Field(default=None, ge=0, le=100)
    discussion_score: float | None = Field(default=None, ge=0, le=100)
    writing_score: float | None = Field(default=None, ge=0, le=100)
    comments_for_author: str = ""
    comments_for_coordinator: str = ""
    status: Literal["draft", "submitted"] = "submitted"


DISPLAY_STATUS = {
    "pending": "Perlu Direview",
    "assigned": "Perlu Direview",
    "in_review": "Sedang Review",
    "review": "Sedang Review",
    "sedang direview": "Sedang Review",
    "draft": "Sedang Review",
    "revision": "Sedang Revisi",
    "revision_requested": "Sedang Revisi",
    "sedang revisi": "Sedang Revisi",
    "completed": "Selesai",
    "complete": "Selesai",
    "done": "Selesai",
    "selesai": "Selesai",
}

ARTICLE_STORAGE_BUCKET = os.getenv("ARTICLE_STORAGE_BUCKET", "article-files")


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
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Layanan Supabase sementara tidak tersedia") from exc
        print(f"[WARN] Signed URL gagal dibuat: {exc}")
        return None


RECOMMENDATIONS = {
    "accept": "Accept",
    "minor revision": "Minor Revision",
    "major revision": "Major Revision",
    "review ulang": "Review Ulang",
    "rejected": "Rejected",
    "ditolak": "Rejected",
}


def _raise_supabase_error(exc: Exception, default_message: str) -> None:
    if is_transient_supabase_error(exc):
        reset_service_client()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Layanan Supabase sementara tidak tersedia",
        ) from exc

    message = str(exc)
    lowered = message.lower()
    if "duplicate key" in lowered or "unique constraint" in lowered:
        raise HTTPException(status_code=409, detail="Data review sudah tersedia") from exc

    raise HTTPException(status_code=400, detail=default_message) from exc


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def _normalize_status(status_value: Any) -> str:
    return str(status_value or "").strip().lower()


def _display_status(assignment: dict[str, Any], latest_review: dict[str, Any] | None) -> str:
    if latest_review:
        review_status = _normalize_status(latest_review.get("status"))
        if latest_review.get("submitted_at") or review_status == "submitted":
            recommendation = _normalize_status(latest_review.get("recommendation"))
            if recommendation == "accept":
                return "Selesai"
            if recommendation == "rejected":
                return "Ditolak"
            if recommendation in {"minor revision", "major revision"}:
                return "Sedang Revisi"
            if recommendation == "review ulang":
                return "Sedang Review"
        if review_status == "draft":
            return "Sedang Review"

    raw_status = _normalize_status(assignment.get("status"))
    return DISPLAY_STATUS.get(raw_status, "Perlu Direview")


def _first_row(data: Any) -> dict[str, Any] | None:
    if isinstance(data, list):
        return data[0] if data else None
    return data if isinstance(data, dict) else None


def _reviewer_profile(service: Client, user_id: int) -> dict[str, Any] | None:
    response = (
        service.table("lecturers")
        .select("id,user_id,nidn,nip,full_name,academic_title,email")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return _first_row(response.data)


def _enrich_assignments(
    service: Client,
    assignments: list[dict[str, Any]],
    *,
    include_reviews: bool = True,
) -> list[dict[str, Any]]:
    if not assignments:
        return []

    article_ids = {int(row["article_id"]) for row in assignments if row.get("article_id")}
    version_ids = {int(row["article_version_id"]) for row in assignments if row.get("article_version_id")}

    articles = (
        service.table("articles")
        .select("id,project_id,title,abstract,journal_id,status,current_version_id,submitted_at,finalized_at,created_at,updated_at")
        .in_("id", list(article_ids))
        .execute()
        .data
        if article_ids
        else []
    )
    article_map = {int(row["id"]): row for row in articles or []}

    journal_ids = {int(row["journal_id"]) for row in articles or [] if row.get("journal_id")}
    journals = (
        service.table("journals")
        .select("id,name,abbreviation,sinta_level,field,website_url,submission_url,template_url,apc_info")
        .in_("id", list(journal_ids))
        .execute()
        .data
        if journal_ids
        else []
    )
    journal_map = {int(row["id"]): row for row in journals or []}

    versions = (
        service.table("article_versions")
        .select("id,article_id,version_number,file_name,file_path,file_url,file_type,file_size,uploaded_by,version_status,submission_note,uploaded_at")
        .in_("id", list(version_ids))
        .execute()
        .data
        if version_ids
        else []
    )
    version_map = {int(row["id"]): row for row in versions or []}

    authors = (
        service.table("article_authors")
        .select("id,article_id,student_id,author_order,is_corresponding")
        .in_("article_id", list(article_ids))
        .order("author_order")
        .execute()
        .data
        if article_ids
        else []
    )
    student_ids = {int(row["student_id"]) for row in authors or [] if row.get("student_id")}
    students = (
        service.table("students")
        .select("id,user_id,nim,full_name,study_program,class_name,phone")
        .in_("id", list(student_ids))
        .execute()
        .data
        if student_ids
        else []
    )
    student_map = {int(row["id"]): row for row in students or []}

    authors_by_article: dict[int, list[dict[str, Any]]] = {}
    for author in authors or []:
        item = dict(author)
        item["student"] = student_map.get(int(author["student_id"])) if author.get("student_id") else None
        authors_by_article.setdefault(int(author["article_id"]), []).append(item)

    mentorships = (
        service.table("mentorship_assignments")
        .select("id,student_id,lecturer_id,article_id,assigned_by,assigned_at,status,notes")
        .in_("article_id", list(article_ids))
        .order("assigned_at", desc=True)
        .execute()
        .data
        if article_ids
        else []
    )
    lecturer_ids = {int(row["lecturer_id"]) for row in mentorships or [] if row.get("lecturer_id")}
    lecturers = (
        service.table("lecturers")
        .select("id,user_id,nidn,nip,full_name,academic_title,email")
        .in_("id", list(lecturer_ids))
        .execute()
        .data
        if lecturer_ids
        else []
    )
    lecturer_map = {int(row["id"]): row for row in lecturers or []}

    mentorship_by_article: dict[int, dict[str, Any]] = {}
    for row in mentorships or []:
        article_id = int(row["article_id"])
        mentorship_by_article.setdefault(
            article_id,
            {**row, "lecturer": lecturer_map.get(int(row["lecturer_id"])) if row.get("lecturer_id") else None},
        )

    reviews_by_assignment: dict[int, list[dict[str, Any]]] = {}
    if include_reviews:
        assignment_ids = {int(row["id"]) for row in assignments if row.get("id")}
        reviews = (
            service.table("reviews")
            .select("id,assignment_id,article_version_id,reviewer_id,recommendation,overall_score,methodology_score,originality_score,results_score,discussion_score,writing_score,comments_for_author,comments_for_coordinator,status,submitted_at,created_at,updated_at")
            .in_("assignment_id", list(assignment_ids))
            .order("created_at", desc=True)
            .execute()
            .data
            if assignment_ids
            else []
        )
        for review in reviews or []:
            reviews_by_assignment.setdefault(int(review["assignment_id"]), []).append(review)

    enriched: list[dict[str, Any]] = []
    for assignment in assignments:
        item = dict(assignment)
        article = article_map.get(int(assignment["article_id"])) if assignment.get("article_id") else None
        version = version_map.get(int(assignment["article_version_id"])) if assignment.get("article_version_id") else None
        item["article"] = article
        item["version"] = version
        item["journal"] = journal_map.get(int(article["journal_id"])) if article and article.get("journal_id") else None
        article_authors = sorted(
            authors_by_article.get(int(assignment["article_id"]), []),
            key=lambda x: x.get("author_order") or 0,
        ) if assignment.get("article_id") else []
        item["authors"] = article_authors
        item["pendamping"] = mentorship_by_article.get(int(assignment["article_id"])) if assignment.get("article_id") else None
        assignment_reviews = reviews_by_assignment.get(int(assignment["id"]), []) if include_reviews and assignment.get("id") else []
        item["reviews"] = assignment_reviews

        # "latest_review" harus merepresentasikan versi yang sedang ditugaskan.
        # Setelah peserta mengunggah revisi, assignment.article_version_id
        # berpindah ke versi baru sementara review versi lama tetap menjadi histori.
        assigned_version_id = int(assignment["article_version_id"]) if assignment.get("article_version_id") else None
        item["latest_review"] = next(
            (review for review in assignment_reviews
             if assigned_version_id is not None
             and review.get("article_version_id") is not None
             and int(review["article_version_id"]) == assigned_version_id),
            None,
        )
        item["display_status"] = _display_status(assignment, item["latest_review"])
        enriched.append(item)

    return enriched


def _get_reviewer_assignment(service: Client, reviewer_id: int, assignment_id: int) -> dict[str, Any]:
    assignment_response = (
        service.table("reviewer_assignments")
        .select("id,article_id,article_version_id,reviewer_id,assigned_by,assigned_at,deadline,status,admin_note,completed_at,created_at,updated_at")
        .eq("id", assignment_id)
        .eq("reviewer_id", reviewer_id)
        .limit(1)
        .execute()
    )
    assignment = _first_row(assignment_response.data)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment review tidak ditemukan")

    rows = _enrich_assignments(service, [assignment], include_reviews=True)
    if not rows:
        raise HTTPException(status_code=404, detail="Assignment review tidak ditemukan")
    return rows[0]


@router.get("/dashboard", response_model=dict[str, Any])
def dashboard(
    current_reviewer: dict[str, Any] = Depends(require_reviewer),
    supabase: Client = Depends(get_service_client),
):
    try:
        assignments = (
            supabase.table("reviewer_assignments")
            .select("id,article_id,article_version_id,reviewer_id,assigned_by,assigned_at,deadline,status,admin_note,completed_at,created_at,updated_at")
            .eq("reviewer_id", int(current_reviewer["id"]))
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        )
        enriched = _enrich_assignments(supabase, assignments)
        profile = _reviewer_profile(supabase, int(current_reviewer["id"]))
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat dashboard reviewer")
        raise AssertionError("unreachable")

    counts = {
        "articles_selected": len(enriched),
        "pending_reviews": sum(1 for row in enriched if row["display_status"] == "Perlu Direview"),
        "in_revision": sum(1 for row in enriched if row["display_status"] == "Sedang Revisi"),
        "completed": sum(1 for row in enriched if row["display_status"] == "Selesai"),
    }

    return {
        **counts,
        "reviewer": profile or {
            "id": current_reviewer["id"],
            "full_name": current_reviewer.get("username") or current_reviewer.get("email"),
            "email": current_reviewer.get("email"),
        },
        "recent_assignments": enriched[:5],
    }


@router.get("/assignments", response_model=list[dict[str, Any]])
def list_assignments(
    current_reviewer: dict[str, Any] = Depends(require_reviewer),
    supabase: Client = Depends(get_service_client),
):
    try:
        rows = (
            supabase.table("reviewer_assignments")
            .select("id,article_id,article_version_id,reviewer_id,assigned_by,assigned_at,deadline,status,admin_note,completed_at,created_at,updated_at")
            .eq("reviewer_id", int(current_reviewer["id"]))
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        )
        return _enrich_assignments(supabase, rows)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat artikel reviewer")
        raise AssertionError("unreachable")


@router.get("/assignments/{assignment_id}", response_model=dict[str, Any])
def assignment_detail(
    assignment_id: int,
    current_reviewer: dict[str, Any] = Depends(require_reviewer),
    supabase: Client = Depends(get_service_client),
):
    try:
        item = _get_reviewer_assignment(supabase, int(current_reviewer["id"]), assignment_id)
        revision_requests = (
            supabase.table("revision_requests")
            .select("id,article_id,review_id,requested_by,revision_round,instructions,deadline,status,created_at,completed_at")
            .eq("article_id", int(item["article_id"]))
            .order("revision_round", desc=True)
            .execute()
            .data
            or []
        )
        review_ids = {int(row["id"]) for row in item.get("reviews", []) if row.get("id")}
        comments = (
            supabase.table("review_comments")
            .select("id,review_id,comment_type,comment_text,page_number,section_name,created_at")
            .in_("review_id", list(review_ids))
            .order("created_at")
            .execute()
            .data
            if review_ids
            else []
        )
        item["revision_requests"] = revision_requests
        item["review_comments"] = comments or []
        return item
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat detail assignment reviewer")
        raise AssertionError("unreachable")




@router.get("/assignments/{assignment_id}/download")
def download_assigned_article(
    assignment_id: int,
    current_reviewer: dict[str, Any] = Depends(require_reviewer),
    supabase: Client = Depends(get_service_client),
):
    """Return a short-lived signed URL for the assigned article version."""
    try:
        assignment_response = (
            supabase.table("reviewer_assignments")
            .select("id,article_id,article_version_id,reviewer_id")
            .eq("id", assignment_id)
            .eq("reviewer_id", int(current_reviewer["id"]))
            .limit(1)
            .execute()
        )
        assignment = _first_row(assignment_response.data)
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment review tidak ditemukan")

        version_id = assignment.get("article_version_id")
        if not version_id:
            raise HTTPException(status_code=404, detail="Versi artikel pada assignment tidak ditemukan")

        version_response = (
            supabase.table("article_versions")
            .select("id,article_id,file_path,file_url")
            .eq("id", int(version_id))
            .eq("article_id", int(assignment["article_id"]))
            .limit(1)
            .execute()
        )
        version = _first_row(version_response.data)
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


@router.get("/history", response_model=list[dict[str, Any]])
def history(
    current_reviewer: dict[str, Any] = Depends(require_reviewer),
    supabase: Client = Depends(get_service_client),
):
    try:
        reviews = (
            supabase.table("reviews")
            .select("id,assignment_id,article_version_id,reviewer_id,recommendation,overall_score,methodology_score,originality_score,results_score,discussion_score,writing_score,comments_for_author,comments_for_coordinator,status,submitted_at,created_at,updated_at")
            .eq("reviewer_id", int(current_reviewer["id"]))
            .eq("status", "submitted")
            .order("submitted_at", desc=True)
            .execute()
            .data
            or []
        )
        assignment_ids = {int(row["assignment_id"]) for row in reviews if row.get("assignment_id")}
        assignments = (
            supabase.table("reviewer_assignments")
            .select("id,article_id,article_version_id,deadline,status")
            .in_("id", list(assignment_ids))
            .execute()
            .data
            if assignment_ids
            else []
        )
        assignment_map = {int(row["id"]): row for row in assignments or []}
        article_ids = {int(row["article_id"]) for row in assignments or [] if row.get("article_id")}
        articles = (
            supabase.table("articles")
            .select("id,title,journal_id,status")
            .in_("id", list(article_ids))
            .execute()
            .data
            if article_ids
            else []
        )
        article_map = {int(row["id"]): row for row in articles or []}
        journal_ids = {int(row["journal_id"]) for row in articles or [] if row.get("journal_id")}
        journals = (
            supabase.table("journals")
            .select("id,name,abbreviation,sinta_level")
            .in_("id", list(journal_ids))
            .execute()
            .data
            if journal_ids
            else []
        )
        journal_map = {int(row["id"]): row for row in journals or []}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memuat riwayat review")
        raise AssertionError("unreachable")

    result: list[dict[str, Any]] = []
    for review in reviews:
        item = dict(review)
        assignment = assignment_map.get(int(review["assignment_id"])) if review.get("assignment_id") else None
        article = article_map.get(int(assignment["article_id"])) if assignment and assignment.get("article_id") else None
        item["assignment"] = assignment
        item["article"] = article
        item["journal"] = journal_map.get(int(article["journal_id"])) if article and article.get("journal_id") else None
        result.append(item)
    return result


@router.post("/assignments/{assignment_id}/review", response_model=dict[str, Any])
def save_review(
    assignment_id: int,
    payload: ReviewerReviewPayload,
    current_reviewer: dict[str, Any] = Depends(require_reviewer),
    supabase: Client = Depends(get_service_client),
):
    reviewer_id = int(current_reviewer["id"])

    if payload.status == "submitted":
        recommendation = RECOMMENDATIONS.get(_normalize_status(payload.recommendation))
        if not recommendation:
            raise HTTPException(
                status_code=422,
                detail="Pilih rekomendasi hasil review sebelum submit",
            )
    else:
        recommendation = payload.recommendation.strip() if payload.recommendation else None

    try:
        assignment_response = (
            supabase.table("reviewer_assignments")
            .select("id,article_id,article_version_id,reviewer_id,deadline,status")
            .eq("id", assignment_id)
            .eq("reviewer_id", reviewer_id)
            .limit(1)
            .execute()
        )
        assignment = _first_row(assignment_response.data)
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment review tidak ditemukan")

        article_id = int(assignment["article_id"])
        version_id = int(assignment["article_version_id"]) if assignment.get("article_version_id") else None
        if not version_id:
            raise HTTPException(status_code=400, detail="Assignment belum memiliki versi artikel")

        latest_reviews = (
            supabase.table("reviews")
            .select("id,assignment_id,article_version_id,reviewer_id,recommendation,overall_score,methodology_score,originality_score,results_score,discussion_score,writing_score,comments_for_author,comments_for_coordinator,status,submitted_at,created_at,updated_at")
            .eq("assignment_id", assignment_id)
            .eq("reviewer_id", reviewer_id)
            .eq("article_version_id", version_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        existing = latest_reviews[0] if latest_reviews else None

        if existing and _normalize_status(existing.get("status")) == "submitted":
            raise HTTPException(status_code=409, detail="Review untuk assignment ini sudah disubmit")

        data = {
            "assignment_id": assignment_id,
            "article_version_id": version_id,
            "reviewer_id": reviewer_id,
            "recommendation": recommendation,
            "overall_score": payload.overall_score,
            "methodology_score": payload.methodology_score,
            "originality_score": payload.originality_score,
            "results_score": payload.results_score,
            "discussion_score": payload.discussion_score,
            "writing_score": payload.writing_score,
            "comments_for_author": payload.comments_for_author.strip(),
            "comments_for_coordinator": payload.comments_for_coordinator.strip(),
            "status": payload.status,
        }

        now_iso = _now_iso()
        if payload.status == "submitted":
            data["submitted_at"] = now_iso

        if existing:
            review = (
                supabase.table("reviews")
                .update(data)
                .eq("id", int(existing["id"]))
                .execute()
                .data
                or []
            )
        else:
            review = supabase.table("reviews").insert(data).execute().data or []

        if not review:
            raise HTTPException(status_code=400, detail="Review tidak berhasil disimpan")
        review_row = review[0]

        if payload.status == "draft":
            supabase.table("reviewer_assignments").update({"status": "in_review", "updated_at": now_iso}).eq("id", assignment_id).execute()
        else:
            normalized_rec = _normalize_status(recommendation)
            assignment_update: dict[str, Any]
            article_update: dict[str, Any]

            if normalized_rec == "accept":
                assignment_update = {"status": "completed", "completed_at": now_iso, "updated_at": now_iso}
                article_update = {"status": "Selesai Review", "updated_at": now_iso}
            elif normalized_rec == "rejected":
                assignment_update = {"status": "rejected", "completed_at": now_iso, "updated_at": now_iso}
                article_update = {"status": "Ditolak", "updated_at": now_iso}
            elif normalized_rec in {"minor revision", "major revision"}:
                assignment_update = {"status": "revision_requested", "updated_at": now_iso}
                article_update = {"status": "Sedang Revisi", "updated_at": now_iso}
                existing_requests = (
                    supabase.table("revision_requests")
                    .select("revision_round")
                    .eq("article_id", article_id)
                    .order("revision_round", desc=True)
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                next_round = int(existing_requests[0]["revision_round"]) + 1 if existing_requests else 1
                revision_status = "Open"
                supabase.table("revision_requests").insert({
                    "article_id": article_id,
                    "review_id": int(review_row["id"]),
                    "requested_by": reviewer_id,
                    "revision_round": next_round,
                    "instructions": payload.comments_for_author.strip(),
                    "deadline": assignment.get("deadline"),
                    "status": revision_status,
                }).execute()
            else:
                assignment_update = {"status": "in_review", "updated_at": now_iso}
                article_update = {"status": "Sedang Direview", "updated_at": now_iso}

            supabase.table("reviewer_assignments").update(assignment_update).eq("id", assignment_id).execute()
            supabase.table("articles").update(article_update).eq("id", article_id).execute()

        return {
            "message": "Draft review berhasil disimpan" if payload.status == "draft" else "Review berhasil disubmit",
            "review": review_row,
            "assignment_id": assignment_id,
        }
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menyimpan review")
        raise AssertionError("unreachable")
