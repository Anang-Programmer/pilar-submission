from __future__ import annotations

from datetime import date, datetime, timezone
import csv
import os
import bcrypt
import io
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from supabase import Client

from ..deps import require_admin
from ..schemas import (
    AdminCourseCreate,
    AdminCourseUpdate,
    AdminDashboardOut,
    AdminJournalCreate,
    AdminJournalUpdate,
    AdminUserCreate,
    AdminUserListItem,
    AdminUserUpdate,
    AdminNotificationCreate,
    AdminNotificationUpdate,
    AdminReportSummaryOut,
    AdminProjectCreate,
    AdminProjectUpdate,
    AdminProjectMemberCreate,
    AdminProjectMemberUpdate,
    AdminArticleCreate,
    AdminArticleUpdate,
    AdminArticleAuthorCreate,
    AdminArticleAuthorUpdate,
    MentorshipAssignmentCreate,
    MentorshipAssignmentUpdate,
    MessageOut,
    ProjectSelectionCreate,
    ProjectSelectionUpdate,
    ReviewerAssignmentCreate,
    ReviewerAssignmentUpdate,
    ParticipantCourseAssignmentCreate,
    ParticipantCourseAssignmentUpdate,
)
from ..supabase import (
    get_service_client,
    is_transient_supabase_error,
    reset_service_client,
)

router = APIRouter(prefix="/api/admin", tags=["Admin"])

ARTICLE_STORAGE_BUCKET = os.getenv("ARTICLE_STORAGE_BUCKET", "article-files")


def _make_signed_url(service: Client, file_path: str | None) -> str | None:
    """Create a temporary signed URL for an article file in Supabase Storage."""
    if not file_path:
        return None
    try:
        result = service.storage.from_(ARTICLE_STORAGE_BUCKET).create_signed_url(file_path, 60 * 60)
        if isinstance(result, dict):
            return result.get("signedURL") or result.get("signedUrl") or result.get("url")
        return getattr(result, "signedURL", None) or getattr(result, "signedUrl", None) or getattr(result, "url", None)
    except Exception as exc:
        if is_transient_supabase_error(exc):
            reset_service_client()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Layanan Supabase sementara tidak tersedia",
            ) from exc
        print(f"[WARN] Signed URL gagal dibuat: {exc}")
        return None


def _as_roles(data: list[dict[str, Any]] | None) -> dict[int, list[str]]:
    result: dict[int, list[str]] = {}
    for row in data or []:
        user_id = row.get("user_id")
        role = row.get("role") or {}
        role_name = role.get("name")
        if user_id is not None and role_name:
            result.setdefault(int(user_id), []).append(str(role_name).lower())
    return result


def _normalize_profile(value: Any) -> dict[str, Any] | None:
    """PostgREST may return a one-to-many relation as a list."""
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        return value[0] if value and isinstance(value[0], dict) else None
    return None


def _first_row(response: Any) -> dict[str, Any] | None:
    """Read the first row without relying on maybe_single()."""
    data = getattr(response, "data", None)
    if isinstance(data, list):
        return data[0] if data else None
    return data if isinstance(data, dict) else None


def _load_participant_assignments(
    service: Client,
    student_ids: set[int],
) -> dict[int, list[dict[str, Any]]]:
    if not student_ids:
        return {}

    rows = (
        service.table("participant_course_assignments")
        .select(
            "id,student_id,course_id,lecturer_id,assigned_by,assigned_at,status,updated_at"
        )
        .in_("student_id", list(student_ids))
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

    result: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        item = dict(row)
        item["course"] = course_map.get(int(row["course_id"])) if row.get("course_id") is not None else None
        item["mentor"] = lecturer_map.get(int(row["lecturer_id"])) if row.get("lecturer_id") is not None else None
        result.setdefault(int(row["student_id"]), []).append(item)
    return result


def _save_participant_assignment(
    service: Client,
    *,
    student_id: int,
    course_id: int | None,
    mentor_lecturer_id: int | None,
    assigned_by: int,
) -> dict[str, Any]:
    if course_id is None and mentor_lecturer_id is None:
        raise HTTPException(status_code=400, detail="Mata kuliah dan Dosen Pendamping wajib dipilih")
    if course_id is None:
        raise HTTPException(status_code=400, detail="Mata kuliah wajib dipilih")
    if mentor_lecturer_id is None:
        raise HTTPException(status_code=400, detail="Dosen pendamping wajib dipilih")

    course = _first_row(
        service.table("courses")
        .select("id")
        .eq("id", course_id)
        .limit(1)
        .execute()
    )
    if not course:
        raise HTTPException(status_code=400, detail="Mata kuliah tidak ditemukan")

    # Dosen pendamping harus berasal dari profil Reviewer.
    _ensure_reviewer(service, _lecturer_user_id(service, mentor_lecturer_id))

    payload = {
        "student_id": student_id,
        "course_id": course_id,
        "lecturer_id": mentor_lecturer_id,
        "assigned_by": assigned_by,
        "status": "active",
        "updated_at": _now_iso(),
    }

    existing = _first_row(
        service.table("participant_course_assignments")
        .select("id")
        .eq("student_id", student_id)
        .eq("course_id", course_id)
        .limit(1)
        .execute()
    )

    if existing:
        result = (
            service.table("participant_course_assignments")
            .update({
                "lecturer_id": mentor_lecturer_id,
                "assigned_by": assigned_by,
                "status": "active",
                "updated_at": _now_iso(),
            })
            .eq("id", int(existing["id"]))
            .execute()
        )
    else:
        result = (
            service.table("participant_course_assignments")
            .insert(payload)
            .execute()
        )

    if not result.data:
        raise HTTPException(status_code=400, detail="Assignment Peserta berhasil disimpan")
    return result.data[0]


def _lecturer_user_id(service: Client, lecturer_id: int) -> int:
    profile = _first_row(
        service.table("lecturers")
        .select("id,user_id")
        .eq("id", lecturer_id)
        .limit(1)
        .execute()
    )
    if not profile:
        raise HTTPException(status_code=400, detail="Dosen pendamping tidak ditemukan")
    return int(profile["user_id"])


def _raise_supabase_error(exc: Exception, default_message: str) -> None:
    if is_transient_supabase_error(exc):
        reset_service_client()
        raise HTTPException(
            status_code=503,
            detail="Layanan Supabase sementara tidak tersedia. Silakan coba lagi.",
        ) from exc

    message = str(exc)
    lowered = message.lower()
    if any(token in lowered for token in ("duplicate", "unique", "already registered")):
        raise HTTPException(status_code=409, detail="Data sudah digunakan") from exc
    raise HTTPException(status_code=400, detail=default_message) from exc


def _require_role(service: Client, user_id: int, role_name: str) -> dict[str, Any]:
    response = (
        service.table("user_roles")
        .select("user_id,role_id,role:roles(id,name)")
        .eq("user_id", user_id)
        .execute()
    )
    for row in response.data or []:
        role = row.get("role") or {}
        if str(role.get("name", "")).lower() == role_name.lower():
            return row
    raise HTTPException(status_code=400, detail=f"User bukan {role_name}")


def _get_user_for_admin_response(supabase: Client, user_id: int) -> dict[str, Any]:
    response = (
        supabase.table("users")
        .select(
            "id,auth_user_id,username,email,is_active,created_at,updated_at,"
            "student_profile:students(id,user_id,nim,full_name,study_program,class_name,phone),"
            "lecturer_profile:lecturers(id,user_id,nidn,nip,full_name,academic_title,email)"
        )
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    user = _first_row(response)
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")

    roles_response = (
        supabase.table("user_roles")
        .select("role:roles(name)")
        .eq("user_id", user_id)
        .execute()
    )
    user["student_profile"] = _normalize_profile(user.get("student_profile"))
    user["lecturer_profile"] = _normalize_profile(user.get("lecturer_profile"))
    student_profile = user.get("student_profile") or {}
    assignments = _load_participant_assignments(
        supabase,
        {int(student_profile["id"])} if student_profile.get("id") is not None else set(),
    )
    user["participant_assignments"] = assignments.get(int(student_profile["id"]), []) if student_profile.get("id") is not None else []
    user["roles"] = [
        str((row.get("role") or {}).get("name")).lower()
        for row in (roles_response.data or [])
        if (row.get("role") or {}).get("name")
    ]
    return user


def count_with_status(supabase: Client, table: str, statuses: set[str]) -> int:
    total = 0
    for status_value in statuses:
        response = (
            supabase.table(table)
            .select("id", count="exact", head=True)
            .eq("status", status_value)
            .execute()
        )
        total += int(response.count or 0)
    return total


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def _write_audit_log(
    service: Client,
    *,
    user_id: int,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    description: str | None = None,
) -> None:
    # Audit logging is intentionally best-effort: it must not break the main action.
    try:
        service.table("audit_logs").insert(
            {
                "user_id": user_id,
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "description": description,
            }
        ).execute()
    except Exception:
        pass


def _notify_user(
    service: Client,
    *,
    user_id: int,
    title: str,
    message: str,
    notification_type: str | None = None,
    reference_type: str | None = None,
    reference_id: int | None = None,
) -> None:
    # Notification delivery is best-effort; the business transaction remains primary.
    try:
        service.table("notifications").insert(
            {
                "user_id": user_id,
                "title": title,
                "message": message,
                "notification_type": notification_type,
                "reference_type": reference_type,
                "reference_id": reference_id,
            }
        ).execute()
    except Exception:
        pass


def _ensure_reviewer(service: Client, reviewer_user_id: int) -> dict[str, Any]:
    _require_role(service, reviewer_user_id, "reviewer")
    profile = _first_row(
        service.table("lecturers")
        .select("id,user_id,full_name,academic_title,nidn,nip,email")
        .eq("user_id", reviewer_user_id)
        .limit(1)
        .execute()
    )
    if not profile:
        raise HTTPException(status_code=400, detail="Reviewer belum memiliki profil lecturers")
    return profile


def _ensure_article_version(service: Client, article_id: int, article_version_id: int) -> dict[str, Any]:
    version = _first_row(
        service.table("article_versions")
        .select("id,article_id,version_number,file_name,file_url,version_status")
        .eq("id", article_version_id)
        .limit(1)
        .execute()
    )
    if not version:
        raise HTTPException(status_code=404, detail="Versi artikel tidak ditemukan")
    if int(version["article_id"]) != int(article_id):
        raise HTTPException(status_code=400, detail="Versi artikel tidak sesuai dengan artikel")
    return version


def _project_has_student(service: Client, project_id: int, student_id: int) -> bool:
    project = _first_row(
        service.table("projects")
        .select("id,submitted_by")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )
    if not project:
        return False
    if int(project["submitted_by"]) == int(student_id):
        return True
    member = _first_row(
        service.table("project_members")
        .select("id")
        .eq("project_id", project_id)
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    return bool(member)


@router.get("/dashboard", response_model=AdminDashboardOut)
def dashboard(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    def count(table: str, column: str = "id") -> int:
        response = supabase.table(table).select(column, count="exact", head=True).execute()
        return int(response.count or 0)

    role_rows = (
        supabase.table("user_roles")
        .select("user_id,role:roles(name)")
        .execute()
        .data
        or []
    )
    users_by_role: dict[str, set[int]] = {"reviewer": set(), "peserta": set()}
    for row in role_rows:
        role = str((row.get("role") or {}).get("name", "")).lower()
        user_id = row.get("user_id")
        if role in users_by_role and user_id is not None:
            users_by_role[role].add(int(user_id))

    total_assignments = count("reviewer_assignments")
    completed_assignments = count_with_status(
        supabase, "reviewer_assignments", {"completed", "Completed", "Selesai"}
    )

    return {
        "total_users": count("users"),
        "total_reviewers": len(users_by_role["reviewer"]),
        "total_peserta": len(users_by_role["peserta"]),
        "total_articles": count("articles"),
        "total_projects": count("projects"),
        "pending_assignments": max(total_assignments - completed_assignments, 0),
        "active_reviews": count_with_status(
            supabase, "reviews", {"draft", "in_review", "Sedang Direview"}
        ),
        "revision_requests": count("revision_requests"),
    }


@router.get("/users", response_model=list[AdminUserListItem])
def list_users(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
    search: str | None = Query(default=None, min_length=1, max_length=100),
    role: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
):
    query = supabase.table("users").select(
        "id,auth_user_id,username,email,is_active,created_at,updated_at,"
        "student_profile:students(id,user_id,nim,full_name,study_program,class_name,phone),"
        "lecturer_profile:lecturers(id,user_id,nidn,nip,full_name,academic_title,email)"
    )
    if search:
        query = query.or_(f"username.ilike.%{search}%,email.ilike.%{search}%")
    if is_active is not None:
        query = query.eq("is_active", is_active)

    response = query.order("created_at", desc=True).execute()
    users = response.data or []

    role_rows = (
        supabase.table("user_roles")
        .select("user_id,role:roles(name)")
        .execute()
        .data
        or []
    )
    roles_by_user = _as_roles(role_rows)
    student_ids = {
        int((_normalize_profile(user.get("student_profile")) or {}).get("id"))
        for user in users
        if (_normalize_profile(user.get("student_profile")) or {}).get("id") is not None
    }
    assignments_by_student = _load_participant_assignments(supabase, student_ids)

    result: list[dict[str, Any]] = []
    for user in users:
        user_roles = roles_by_user.get(int(user["id"]), [])
        if role and role.lower() not in user_roles:
            continue
        user["student_profile"] = _normalize_profile(user.get("student_profile"))
        user["lecturer_profile"] = _normalize_profile(user.get("lecturer_profile"))
        student_id = int(user["student_profile"]["id"]) if user.get("student_profile") and user["student_profile"].get("id") is not None else None
        user["participant_assignments"] = assignments_by_student.get(student_id, []) if student_id is not None else []
        user["roles"] = user_roles
        result.append(user)
    return result


@router.get("/users/{user_id}", response_model=AdminUserListItem)
def get_user(
    user_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    return _get_user_for_admin_response(supabase, user_id)


@router.post("/users", response_model=AdminUserListItem, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: AdminUserCreate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()

    existing = (
        service.table("users")
        .select("id")
        .or_(f"username.eq.{payload.username},email.eq.{payload.email}")
        .limit(1)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=409, detail="Username atau email sudah digunakan")

    auth_user_id: str | None = None
    local_user_id: int | None = None

    try:
        auth_response = service.auth.admin.create_user(
            {
                "email": str(payload.email),
                "password": payload.password,
                "email_confirm": True,
                "user_metadata": {"username": payload.username},
            }
        )
        auth_user = getattr(auth_response, "user", None)
        if auth_user is None:
            raise RuntimeError("Supabase Auth tidak mengembalikan user")
        auth_user_id = str(auth_user.id)

        user_insert = (
            service.table("users")
            .insert(
                {
                    "auth_user_id": auth_user_id,
                    "username": payload.username,
                    "email": str(payload.email),
                    "password_hash": bcrypt.hashpw(
                        payload.password.encode("utf-8"),
                        bcrypt.gensalt(),
                    ).decode("utf-8"),
                    "is_active": payload.is_active,
                }
            )
            .execute()
        )
        user = (user_insert.data or [None])[0]
        if not user:
            raise RuntimeError("Gagal membuat users record")
        local_user_id = int(user["id"])

        role = _first_row(
            service.table("roles")
            .select("id,name")
            .eq("name", payload.role)
            .limit(1)
            .execute()
        )
        if not role:
            raise RuntimeError(f"Role {payload.role} tidak ditemukan")

        service.table("user_roles").insert(
            {"user_id": local_user_id, "role_id": role["id"]}
        ).execute()

        if payload.role == "reviewer":
            service.table("lecturers").insert(
                {
                    "user_id": local_user_id,
                    "nidn": payload.nidn,
                    "nip": payload.nip,
                    "full_name": payload.full_name,
                    "academic_title": payload.academic_title,
                    "email": str(payload.email),
                }
            ).execute()
        elif payload.role == "peserta":
            student_response = service.table("students").insert(
                {
                    "user_id": local_user_id,
                    "nim": payload.nim,
                    "full_name": payload.full_name,
                    "study_program": payload.study_program,
                    "class_name": payload.class_name,
                    "phone": payload.phone,
                }
            ).execute()
            student = (student_response.data or [None])[0]
            if not student:
                raise RuntimeError("Gagal membuat students record")

            _save_participant_assignment(
                service,
                student_id=int(student["id"]),
                course_id=payload.course_id,
                mentor_lecturer_id=payload.mentor_lecturer_id,
                assigned_by=int(current_admin["id"]),
            )

        return _get_user_for_admin_response(supabase, local_user_id)

    except HTTPException:
        raise
    except Exception as exc:
        if local_user_id:
            try:
                service.table("user_roles").delete().eq("user_id", local_user_id).execute()
            except Exception:
                pass
            try:
                service.table("students").delete().eq("user_id", local_user_id).execute()
            except Exception:
                pass
            try:
                service.table("lecturers").delete().eq("user_id", local_user_id).execute()
            except Exception:
                pass
            try:
                service.table("users").delete().eq("id", local_user_id).execute()
            except Exception:
                pass

        if auth_user_id:
            try:
                service.auth.admin.delete_user(auth_user_id)
            except Exception:
                pass

        _raise_supabase_error(exc, "Gagal membuat user")
        raise AssertionError("unreachable")


@router.patch("/users/{user_id}", response_model=AdminUserListItem)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    if payload.role == "admin" and int(current_admin["id"]) != user_id:
        # Allowed: an admin may create/change another user to admin.
        pass

    service = get_service_client()
    current = _first_row(
        service.table("users")
        .select("id,auth_user_id,email,username,is_active")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    if not current:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")

    current_roles_rows = (
        service.table("user_roles")
        .select("role:roles(name)")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    current_roles = {
        str((row.get("role") or {}).get("name", "")).lower()
        for row in current_roles_rows
    }
    target_role = payload.role.lower() if payload.role else next(iter(current_roles), None)

    local_update: dict[str, Any] = {}
    if payload.username is not None:
        local_update["username"] = payload.username
    if payload.is_active is not None:
        local_update["is_active"] = payload.is_active
    if payload.email is not None:
        local_update["email"] = str(payload.email)

    old_email = current.get("email")
    auth_updated = False

    try:
        # Change Auth email first so authentication remains authoritative.
        if payload.email is not None and current.get("auth_user_id"):
            service.auth.admin.update_user_by_id(
                str(current["auth_user_id"]),
                {"email": str(payload.email), "email_confirm": True},
            )
            auth_updated = True

        if local_update:
            service.table("users").update(local_update).eq("id", user_id).execute()

        if payload.role is not None and target_role not in current_roles:
            role = _first_row(
                service.table("roles")
                .select("id,name")
                .eq("name", target_role)
                .limit(1)
                .execute()
            )
            if not role:
                raise HTTPException(status_code=400, detail="Role tidak ditemukan")

            # Role changes are intentionally conservative: remove old role rows,
            # then add the selected role. Existing academic profiles are reused
            # or created; they are not deleted automatically because doing so can
            # cascade into projects/articles for a participant.
            service.table("user_roles").delete().eq("user_id", user_id).execute()
            service.table("user_roles").insert(
                {"user_id": user_id, "role_id": role["id"]}
            ).execute()

        if target_role == "reviewer":
            existing_profile = _first_row(
                service.table("lecturers")
                .select("id")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            update_profile: dict[str, Any] = {}
            for field in ("nidn", "nip", "full_name", "academic_title"):
                value = getattr(payload, field)
                if value is not None:
                    update_profile[field] = value
            if payload.email is not None:
                update_profile["email"] = str(payload.email)
            elif not existing_profile:
                update_profile["email"] = str(current["email"])
            if existing_profile:
                if update_profile:
                    service.table("lecturers").update(update_profile).eq("user_id", user_id).execute()
            elif payload.full_name:
                update_profile["user_id"] = user_id
                update_profile["full_name"] = payload.full_name
                service.table("lecturers").insert(update_profile).execute()

        if target_role == "peserta":
            existing_profile = _first_row(
                service.table("students")
                .select("id")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            update_profile = {}
            for field in ("nim", "full_name", "study_program", "class_name", "phone"):
                value = getattr(payload, field)
                if value is not None:
                    update_profile[field] = value
            if existing_profile:
                if update_profile:
                    service.table("students").update(update_profile).eq("user_id", user_id).execute()
                if payload.course_id is not None or payload.mentor_lecturer_id is not None:
                    _save_participant_assignment(
                        service,
                        student_id=int(existing_profile["id"]),
                        course_id=payload.course_id,
                        mentor_lecturer_id=payload.mentor_lecturer_id,
                        assigned_by=int(current_admin["id"]),
                    )
            elif payload.nim and payload.full_name:
                update_profile["user_id"] = user_id
                update_profile["nim"] = payload.nim
                update_profile["full_name"] = payload.full_name
                student = (service.table("students").insert(update_profile).execute().data or [None])[0]
                if student and (payload.course_id is not None or payload.mentor_lecturer_id is not None):
                    _save_participant_assignment(
                        service,
                        student_id=int(student["id"]),
                        course_id=payload.course_id,
                        mentor_lecturer_id=payload.mentor_lecturer_id,
                        assigned_by=int(current_admin["id"]),
                    )

        return _get_user_for_admin_response(supabase, user_id)

    except HTTPException:
        if auth_updated and old_email and current.get("auth_user_id"):
            try:
                service.auth.admin.update_user_by_id(
                    str(current["auth_user_id"]),
                    {"email": old_email, "email_confirm": True},
                )
            except Exception:
                pass
        raise
    except Exception as exc:
        if auth_updated and old_email and current.get("auth_user_id"):
            try:
                service.auth.admin.update_user_by_id(
                    str(current["auth_user_id"]),
                    {"email": old_email, "email_confirm": True},
                )
            except Exception:
                pass
        _raise_supabase_error(exc, "Gagal memperbarui user")
        raise AssertionError("unreachable")


@router.delete("/users/{user_id}", response_model=MessageOut)
def delete_user(
    user_id: int,
    current_admin: dict = Depends(require_admin),
):
    if int(current_admin["id"]) == int(user_id):
        raise HTTPException(
            status_code=400,
            detail="Admin yang sedang login tidak boleh menghapus dirinya sendiri",
        )

    service = get_service_client()
    current = _first_row(
        service.table("users")
        .select("id,auth_user_id")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    if not current:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")

    try:
        # Delete local row first so FK cascades happen deterministically.
        service.table("users").delete().eq("id", user_id).execute()
        if current.get("auth_user_id"):
            service.auth.admin.delete_user(str(current["auth_user_id"]))
        return {"message": "User berhasil dihapus"}
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus user")
        raise AssertionError("unreachable")


@router.get("/users/{user_id}/participant-assignments", response_model=list[dict[str, Any]])
def list_participant_assignments(
    user_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    student = _first_row(
        supabase.table("students")
        .select("id,user_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not student:
        raise HTTPException(status_code=404, detail="Profil peserta tidak ditemukan")
    assignments = _load_participant_assignments(supabase, {int(student["id"])})
    return assignments.get(int(student["id"]), [])


@router.post("/users/{user_id}/participant-assignments", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_participant_assignment(
    user_id: int,
    payload: ParticipantCourseAssignmentCreate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    student = _first_row(
        supabase.table("students")
        .select("id,user_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not student:
        raise HTTPException(status_code=404, detail="Profil peserta tidak ditemukan")
    return _save_participant_assignment(
        supabase,
        student_id=int(student["id"]),
        course_id=payload.course_id,
        mentor_lecturer_id=payload.lecturer_id,
        assigned_by=int(current_admin["id"]),
    )


@router.patch("/users/{user_id}/participant-assignments/{assignment_id}", response_model=dict[str, Any])
def update_participant_assignment(
    user_id: int,
    assignment_id: int,
    payload: ParticipantCourseAssignmentUpdate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    student = _first_row(
        supabase.table("students")
        .select("id,user_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not student:
        raise HTTPException(status_code=404, detail="Profil peserta tidak ditemukan")

    existing = _first_row(
        supabase.table("participant_course_assignments")
        .select("id,student_id,course_id,lecturer_id,status")
        .eq("id", assignment_id)
        .eq("student_id", int(student["id"]))
        .limit(1)
        .execute()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Assignment peserta tidak ditemukan")

    course_id = payload.course_id if payload.course_id is not None else int(existing["course_id"])
    lecturer_id = payload.lecturer_id if payload.lecturer_id is not None else int(existing["lecturer_id"])

    # Validasi course dan reviewer.
    course = _first_row(
        supabase.table("courses").select("id").eq("id", course_id).limit(1).execute()
    )
    if not course:
        raise HTTPException(status_code=400, detail="Mata kuliah tidak ditemukan")
    _ensure_reviewer(supabase, _lecturer_user_id(supabase, lecturer_id))

    try:
        response = (
            supabase.table("participant_course_assignments")
            .update({
                "course_id": course_id,
                "lecturer_id": lecturer_id,
                "status": payload.status or existing.get("status") or "active",
                "assigned_by": int(current_admin["id"]),
                "updated_at": _now_iso(),
            })
            .eq("id", assignment_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Assignment peserta tidak ditemukan")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui assignment peserta")
        raise AssertionError("unreachable")


@router.delete("/users/{user_id}/participant-assignments/{assignment_id}", response_model=MessageOut)
def delete_participant_assignment(
    user_id: int,
    assignment_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    student = _first_row(
        supabase.table("students")
        .select("id,user_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not student:
        raise HTTPException(status_code=404, detail="Profil peserta tidak ditemukan")

    try:
        response = (
            supabase.table("participant_course_assignments")
            .delete()
            .eq("id", assignment_id)
            .eq("student_id", int(student["id"]))
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Assignment peserta tidak ditemukan")
        return {"message": "Assignment peserta berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus assignment peserta")
        raise AssertionError("unreachable")


@router.get("/reviewers", response_model=list[dict[str, Any]])
def list_reviewers(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    response = (
        supabase.table("users")
        .select(
            "id,auth_user_id,username,email,is_active,"
            "lecturer_profile:lecturers(id,nidn,nip,full_name,academic_title,email)"
        )
        .order("username")
        .execute()
    )
    rows = response.data or []
    for row in rows:
        row["lecturer_profile"] = _normalize_profile(row.get("lecturer_profile"))
    role_rows = supabase.table("user_roles").select("user_id,role:roles(name)").execute().data or []
    reviewer_ids = {
        int(row["user_id"])
        for row in role_rows
        if str((row.get("role") or {}).get("name", "")).lower() == "reviewer"
    }
    return [row for row in rows if int(row["id"]) in reviewer_ids]


@router.get("/participants", response_model=list[dict[str, Any]])
def list_participants(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    response = (
        supabase.table("users")
        .select(
            "id,auth_user_id,username,email,is_active,"
            "student_profile:students(id,nim,full_name,study_program,class_name,phone)"
        )
        .order("username")
        .execute()
    )
    rows = response.data or []
    for row in rows:
        row["student_profile"] = _normalize_profile(row.get("student_profile"))
    student_ids = {
        int((row.get("student_profile") or {}).get("id"))
        for row in rows
        if (row.get("student_profile") or {}).get("id") is not None
    }
    assignment_map = _load_participant_assignments(supabase, student_ids)
    for row in rows:
        profile = row.get("student_profile") or {}
        sid = int(profile["id"]) if profile.get("id") is not None else None
        row["participant_assignments"] = assignment_map.get(sid, []) if sid is not None else []
    role_rows = supabase.table("user_roles").select("user_id,role:roles(name)").execute().data or []
    peserta_ids = {
        int(row["user_id"])
        for row in role_rows
        if str((row.get("role") or {}).get("name", "")).lower() == "peserta"
    }
    return [row for row in rows if int(row["id"]) in peserta_ids]


@router.get("/courses", response_model=list[dict[str, Any]])
def list_courses(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
    search: str | None = Query(default=None, max_length=100),
):
    query = supabase.table("courses").select("id,code,name,semester,study_program,created_at")
    if search:
        query = query.or_(f"code.ilike.%{search}%,name.ilike.%{search}%")
    return query.order("name").execute().data or []


@router.post("/courses", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_course(
    payload: AdminCourseCreate,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        return (supabase.table("courses").insert(payload.model_dump(exclude_none=True)).execute().data or [{}])[0]
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal membuat mata kuliah")
        raise AssertionError("unreachable")


@router.patch("/courses/{course_id}", response_model=dict[str, Any])
def update_course(
    course_id: int,
    payload: AdminCourseUpdate,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        response = (
            supabase.table("courses")
            .update(payload.model_dump(exclude_none=True))
            .eq("id", course_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Mata kuliah tidak ditemukan")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui mata kuliah")
        raise AssertionError("unreachable")


@router.delete("/courses/{course_id}", response_model=MessageOut)
def delete_course(
    course_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        response = supabase.table("courses").delete().eq("id", course_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Mata kuliah tidak ditemukan")
        return {"message": "Mata kuliah berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus mata kuliah")
        raise AssertionError("unreachable")


@router.get("/journals", response_model=list[dict[str, Any]])
def list_journals(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
    search: str | None = Query(default=None, max_length=100),
    is_active: bool | None = Query(default=None),
):
    query = supabase.table("journals").select(
        "id,name,abbreviation,sinta_level,field,website_url,submission_url,template_url,apc_info,is_active,created_at,updated_at"
    )
    if search:
        query = query.or_(f"name.ilike.%{search}%,abbreviation.ilike.%{search}%")
    if is_active is not None:
        query = query.eq("is_active", is_active)
    return query.order("name").execute().data or []


@router.post("/journals", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_journal(
    payload: AdminJournalCreate,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        return (supabase.table("journals").insert(payload.model_dump(exclude_none=True)).execute().data or [{}])[0]
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal membuat jurnal")
        raise AssertionError("unreachable")


@router.patch("/journals/{journal_id}", response_model=dict[str, Any])
def update_journal(
    journal_id: int,
    payload: AdminJournalUpdate,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        response = (
            supabase.table("journals")
            .update(payload.model_dump(exclude_none=True))
            .eq("id", journal_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Jurnal tidak ditemukan")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui jurnal")
        raise AssertionError("unreachable")


@router.delete("/journals/{journal_id}", response_model=MessageOut)
def delete_journal(
    journal_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        response = supabase.table("journals").delete().eq("id", journal_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Jurnal tidak ditemukan")
        return {"message": "Jurnal berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus jurnal")
        raise AssertionError("unreachable")


@router.get("/projects", response_model=list[dict[str, Any]])
def list_projects(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
    search: str | None = Query(default=None, max_length=100),
    status_filter: str | None = Query(default=None, alias="status", max_length=50),
):
    query = supabase.table("projects").select(
        "id,title,description,course_id,project_type,project_url,documentation_url,submitted_by,submitted_at,status,created_at,updated_at"
    )
    if search:
        query = query.ilike("title", f"%{search}%")
    projects = query.order("created_at", desc=True).execute().data or []

    course_ids = {int(row["course_id"]) for row in projects if row.get("course_id")}
    student_ids = {int(row["submitted_by"]) for row in projects if row.get("submitted_by")}
    course_map: dict[int, dict[str, Any]] = {}
    student_map: dict[int, dict[str, Any]] = {}

    if course_ids:
        course_rows = (
            supabase.table("courses")
            .select("id,code,name")
            .in_("id", list(course_ids))
            .execute()
            .data
            or []
        )
        course_map = {int(row["id"]): row for row in course_rows}

    if student_ids:
        student_rows = (
            supabase.table("students")
            .select("id,user_id,nim,full_name,study_program")
            .in_("id", list(student_ids))
            .execute()
            .data
            or []
        )
        student_map = {int(row["id"]): row for row in student_rows}

    project_ids = {int(row["id"]) for row in projects if row.get("id")}
    selection_map: dict[int, dict[str, Any]] = {}
    mentor_map: dict[int, dict[str, Any]] = {}
    latest_article_by_project: dict[int, dict[str, Any]] = {}

    if project_ids:
        selections = (
            supabase.table("project_selection")
            .select("id,project_id,selected_by,selection_date,status,score,notes")
            .in_("project_id", list(project_ids))
            .execute()
            .data
            or []
        )
        selection_map = {int(row["project_id"]): row for row in selections}

        project_articles = (
            supabase.table("articles")
            .select("id,project_id,title,status,current_version_id,created_at,updated_at")
            .in_("project_id", list(project_ids))
            .order("updated_at", desc=True)
            .execute()
            .data
            or []
        )

        article_ids: list[int] = []
        for article in project_articles:
            if not article.get("id") or not article.get("project_id"):
                continue
            article_id = int(article["id"])
            project_id = int(article["project_id"])
            article_ids.append(article_id)
            latest_article_by_project.setdefault(project_id, article)

        if article_ids:
            mentorships = (
                supabase.table("mentorship_assignments")
                .select("id,article_id,lecturer_id,status")
                .in_("article_id", article_ids)
                .order("assigned_at", desc=True)
                .execute()
                .data
                or []
            )
            lecturer_ids = {int(row["lecturer_id"]) for row in mentorships if row.get("lecturer_id")}
            lecturer_map: dict[int, dict[str, Any]] = {}
            if lecturer_ids:
                lecturers = (
                    supabase.table("lecturers")
                    .select("id,user_id,full_name,academic_title,nidn,nip")
                    .in_("id", list(lecturer_ids))
                    .execute()
                    .data
                    or []
                )
                lecturer_map = {int(row["id"]): row for row in lecturers}

            article_to_project = {
                int(row["id"]): int(row["project_id"])
                for row in project_articles
                if row.get("id") and row.get("project_id")
            }
            for mentorship in mentorships:
                article_id = mentorship.get("article_id")
                project_id = article_to_project.get(int(article_id)) if article_id else None
                if project_id is not None and project_id not in mentor_map:
                    mentor = (
                        lecturer_map.get(int(mentorship["lecturer_id"]))
                        if mentorship.get("lecturer_id")
                        else None
                    )
                    if mentor:
                        mentor_map[project_id] = mentor

    current_version_ids = {
        int(article["current_version_id"])
        for article in latest_article_by_project.values()
        if article.get("current_version_id") is not None
    }

    version_map: dict[int, dict[str, Any]] = {}
    if current_version_ids:
        version_rows = (
            supabase.table("article_versions")
            .select("id,article_id,version_number,file_name,file_path,version_status")
            .in_("id", list(current_version_ids))
            .execute()
            .data
            or []
        )
        version_map = {int(row["id"]): row for row in version_rows}

    latest_review_by_version: dict[int, dict[str, Any]] = {}
    if current_version_ids:
        review_rows = (
            supabase.table("reviews")
            .select("id,article_version_id,recommendation,status,submitted_at,created_at")
            .in_("article_version_id", list(current_version_ids))
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        )
        for review in review_rows:
            version_id = review.get("article_version_id")
            if version_id is None or int(version_id) in latest_review_by_version:
                continue
            review_status = str(review.get("status") or "").strip().lower()
            if review.get("submitted_at") or review_status == "submitted":
                latest_review_by_version[int(version_id)] = review

    for row in projects:
        pid = int(row["id"]) if row.get("id") else None
        row["course"] = course_map.get(int(row["course_id"])) if row.get("course_id") else None
        row["submitter"] = student_map.get(int(row["submitted_by"])) if row.get("submitted_by") else None
        row["selection"] = selection_map.get(pid) if pid is not None else None
        row["pendamping"] = mentor_map.get(pid) if pid is not None else None

        article = latest_article_by_project.get(pid) if pid is not None else None
        version = (
            version_map.get(int(article["current_version_id"]))
            if article and article.get("current_version_id") is not None
            else None
        )
        review = (
            latest_review_by_version.get(int(version["id"]))
            if version and version.get("id") is not None
            else None
        )
        recommendation = str((review or {}).get("recommendation") or "").strip().lower()

        # Status proyek harus mengikuti keputusan seleksi Admin/proyek.
        # Reviewer Accept hanya membuat artikel siap difinalisasi; tidak
        # menjadikan proyek otomatis terpilih. Finalisasi Admin akan mengubah
        # projects.status menjadi "Terpilih". Data project_selection tetap
        # menjadi sumber tambahan bila memang sudah ada.
        project_status = str(row.get("status") or "").strip().lower()
        selection_status = str((row.get("selection") or {}).get("status") or "").strip().lower()
        row["review_selection_status"] = (
            "Terpilih"
            if project_status in {"terpilih", "selected", "select"}
            or selection_status in {"terpilih", "selected", "select"}
            else "Belum Terpilih"
        )

        if article:
            row["article"] = {
                "id": int(article["id"]),
                "title": article.get("title"),
                "status": article.get("status"),
                "current_version": {
                    "id": int(version["id"]),
                    "version_number": version.get("version_number"),
                    "file_name": version.get("file_name"),
                    "version_status": version.get("version_status"),
                    "has_file": bool(version.get("file_path")),
                } if version else None,
                "review": {
                    "recommendation": review.get("recommendation"),
                    "status": review.get("status"),
                    "submitted_at": review.get("submitted_at"),
                } if review else None,
            }
        else:
            row["article"] = None

    if status_filter in {"Terpilih", "Belum Terpilih"}:
        projects = [
            row for row in projects
            if row.get("review_selection_status") == status_filter
        ]
    elif status_filter:
        projects = [
            row for row in projects
            if str(row.get("status") or "").strip().lower() == status_filter.strip().lower()
        ]

    return projects


@router.get("/project-selection", response_model=list[dict[str, Any]])
def list_project_selection(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    return (
        supabase.table("project_selection")
        .select("id,project_id,selected_by,selection_date,status,score,notes,created_at,updated_at")
        .order("selection_date", desc=True)
        .execute()
        .data
        or []
    )


@router.post("/project-selection", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_project_selection(
    payload: ProjectSelectionCreate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    reviewer = _ensure_reviewer(service, payload.reviewer_user_id)
    project = (
        service.table("projects")
        .select("id,title,submitted_by")
        .eq("id", payload.project_id)
        .limit(1)
        .execute()
        .data
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project tidak ditemukan")
    existing = (
        service.table("project_selection")
        .select("id")
        .eq("project_id", payload.project_id)
        .limit(1)
        .execute()
        .data
    )
    if existing:
        raise HTTPException(status_code=409, detail="Project sudah memiliki data seleksi")
    try:
        data = payload.model_dump(exclude={"reviewer_user_id"})
        data["selected_by"] = reviewer["id"]
        selection = (supabase.table("project_selection").insert(data).execute().data or [{}])[0]
        normalized = payload.status.strip().lower()
        if normalized in {"terpilih", "selected", "select"}:
            supabase.table("projects").update({"status": "Terpilih", "updated_at": _now_iso()}).eq("id", payload.project_id).execute()
            _notify_user(
                service,
                user_id=int(project["submitted_by"]),
                title="Project terpilih",
                message=f'Project "{project["title"]}" berhasil dipilih.',
                notification_type="project_selection",
                reference_type="project",
                reference_id=payload.project_id,
            )
        elif normalized in {"ditolak", "rejected", "reject"}:
            supabase.table("projects").update({"status": "Ditolak", "updated_at": _now_iso()}).eq("id", payload.project_id).execute()
        _write_audit_log(
            service,
            user_id=int(current_admin["id"]),
            action="project_selection.create",
            entity_type="project_selection",
            entity_id=int(selection["id"]) if selection.get("id") else None,
            description=f"Seleksi project {payload.project_id}",
        )
        return selection
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menyimpan seleksi project")
        raise AssertionError("unreachable")


@router.patch("/project-selection/{selection_id}", response_model=dict[str, Any])
def update_project_selection(
    selection_id: int,
    payload: ProjectSelectionUpdate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    data = payload.model_dump(exclude_none=True, exclude={"reviewer_user_id"})
    if payload.reviewer_user_id is not None:
        _require_role(service, payload.reviewer_user_id, "reviewer")
        lecturer = (
            service.table("lecturers")
            .select("id")
            .eq("user_id", payload.reviewer_user_id)
            .maybe_single()
            .execute()
            .data
        )
        if not lecturer:
            raise HTTPException(status_code=400, detail="Reviewer belum memiliki profil lecturers")
        data["selected_by"] = lecturer["id"]
    try:
        response = supabase.table("project_selection").update(data).eq("id", selection_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Data seleksi tidak ditemukan")
        normalized = str(data.get("status", "")).strip().lower()
        project_id_row = service.table("project_selection").select("project_id").eq("id", selection_id).maybe_single().execute().data
        if normalized in {"terpilih", "selected", "select"} and project_id_row:
            supabase.table("projects").update({"status": "Terpilih", "updated_at": _now_iso()}).eq("id", project_id_row["project_id"]).execute()
        elif normalized in {"ditolak", "rejected", "reject"} and project_id_row:
            supabase.table("projects").update({"status": "Ditolak", "updated_at": _now_iso()}).eq("id", project_id_row["project_id"]).execute()
        _write_audit_log(service, user_id=int(current_admin["id"]), action="project_selection.update", entity_type="project_selection", entity_id=selection_id)
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui seleksi project")
        raise AssertionError("unreachable")


@router.delete("/project-selection/{selection_id}", response_model=MessageOut)
def delete_project_selection(
    selection_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        response = supabase.table("project_selection").delete().eq("id", selection_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Data seleksi tidak ditemukan")
        return {"message": "Seleksi project berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus seleksi project")
        raise AssertionError("unreachable")


@router.get("/articles", response_model=list[dict[str, Any]])
def list_articles(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
    search: str | None = Query(default=None, max_length=100),
    status_filter: str | None = Query(default=None, alias="status", max_length=50),
):
    query = supabase.table("articles").select(
        "id,project_id,title,abstract,journal_id,status,current_version_id,submitted_at,finalized_at,created_at,updated_at"
    )
    if search:
        query = query.ilike("title", f"%{search}%")
    if status_filter:
        query = query.eq("status", status_filter)
    articles = query.order("created_at", desc=True).execute().data or []

    article_ids = [int(row["id"]) for row in articles]
    journal_ids = {int(row["journal_id"]) for row in articles if row.get("journal_id")}
    project_ids = {int(row["project_id"]) for row in articles if row.get("project_id")}
    version_ids = {int(row["current_version_id"]) for row in articles if row.get("current_version_id")}

    journals = supabase.table("journals").select("id,name,abbreviation,sinta_level").in_("id", list(journal_ids)).execute().data if journal_ids else []
    projects = supabase.table("projects").select("id,title,submitted_by").in_("id", list(project_ids)).execute().data if project_ids else []
    versions = supabase.table("article_versions").select("id,article_id,version_number,file_name,file_url,version_status,uploaded_by,uploaded_at").in_("id", list(version_ids)).execute().data if version_ids else []
    authors = supabase.table("article_authors").select("article_id,student_id,author_order,is_corresponding").in_("article_id", article_ids).execute().data if article_ids else []

    journal_map = {int(row["id"]): row for row in (journals or [])}
    project_map = {int(row["id"]): row for row in (projects or [])}
    version_map = {int(row["id"]): row for row in (versions or [])}
    author_student_ids = {int(row["student_id"]) for row in (authors or []) if row.get("student_id")}
    student_rows = supabase.table("students").select("id,nim,full_name").in_("id", list(author_student_ids)).execute().data if author_student_ids else []
    student_map = {int(row["id"]): row for row in (student_rows or [])}

    authors_by_article: dict[int, list[dict[str, Any]]] = {}
    for author in authors or []:
        item = dict(author)
        item["student"] = student_map.get(int(author["student_id"])) if author.get("student_id") else None
        authors_by_article.setdefault(int(author["article_id"]), []).append(item)

    for row in articles:
        row["journal"] = journal_map.get(int(row["journal_id"])) if row.get("journal_id") else None
        row["project"] = project_map.get(int(row["project_id"])) if row.get("project_id") else None
        row["current_version"] = version_map.get(int(row["current_version_id"])) if row.get("current_version_id") else None
        row["authors"] = sorted(authors_by_article.get(int(row["id"]), []), key=lambda x: x.get("author_order") or 0)
        current_review = None
        current_version = row.get("current_version")
        if current_version and current_version.get("id") is not None:
            review_rows = (
                supabase.table("reviews")
                .select("id,article_version_id,recommendation,status,submitted_at,created_at")
                .eq("article_version_id", int(current_version["id"]))
                .order("created_at", desc=True)
                .limit(20)
                .execute()
                .data
                or []
            )
            current_review = next(
                (review for review in review_rows
                 if review.get("submitted_at")
                 or str(review.get("status") or "").strip().lower() == "submitted"),
                None,
            )
        row["latest_review"] = current_review
        row["can_finalize"] = bool(
            current_review
            and str(current_review.get("recommendation") or "").strip().lower()
            in {"accept", "accepted", "diterima"}
            and str(row.get("status") or "").strip().lower()
            not in {"final", "finalized", "selesai"}
            and not row.get("finalized_at")
        )
    return articles


@router.post("/articles/{article_id}/finalize", response_model=dict[str, Any])
def finalize_article(
    article_id: int,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    """Finalize an article and synchronize the related project selection.

    Admin finalization is idempotent: even when the article was already marked
    finalized, the related project and project_selection are brought into sync.
    """
    service = get_service_client()
    try:
        article_rows = (
            service.table("articles")
            .select("id,project_id,title,status,current_version_id,finalized_at")
            .eq("id", article_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not article_rows:
            raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")

        article = article_rows[0]
        article_status = str(article.get("status") or "").strip().lower()
        already_finalized = bool(
            article.get("finalized_at")
            or article_status in {"final", "finalized", "selesai"}
        )

        if not already_finalized:
            current_version_id = article.get("current_version_id")
            if current_version_id is None:
                raise HTTPException(status_code=409, detail="Artikel belum memiliki versi aktif")

            accepted_rows = (
                service.table("reviews")
                .select("id,article_version_id,recommendation,status,submitted_at,created_at")
                .eq("article_version_id", int(current_version_id))
                .order("created_at", desc=True)
                .limit(20)
                .execute()
                .data
                or []
            )
            accepted_review = next(
                (
                    row
                    for row in accepted_rows
                    if (
                        row.get("submitted_at")
                        or str(row.get("status") or "").strip().lower() == "submitted"
                    )
                    and str(row.get("recommendation") or "").strip().lower()
                    in {"accept", "accepted", "diterima"}
                ),
                None,
            )
            if not accepted_review:
                raise HTTPException(
                    status_code=409,
                    detail="Artikel belum mendapatkan keputusan Accept dari Reviewer pada versi aktif",
                )

            now_iso = _now_iso()
            updated_rows = (
                service.table("articles")
                .update({
                    "status": "finalized",
                    "finalized_at": now_iso,
                    "updated_at": now_iso,
                })
                .eq("id", article_id)
                .execute()
                .data
                or []
            )
            if not updated_rows:
                raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
            article = updated_rows[0]
        else:
            now_iso = _now_iso()

        project_id = article.get("project_id")
        if project_id is not None:
            project_id = int(project_id)

            # Finalisasi artikel oleh Admin juga menetapkan project sebagai
            # Terpilih. project_selection.selected_by mereferensikan lecturers,
            # sehingga admin tidak dipaksakan masuk ke kolom tersebut.
            project_update = (
                service.table("projects")
                .update({
                    "status": "Terpilih",
                    "updated_at": now_iso,
                })
                .eq("id", project_id)
                .execute()
            )
            if not project_update.data:
                raise HTTPException(status_code=404, detail="Project artikel tidak ditemukan")

            existing_selection = (
                service.table("project_selection")
                .select("id")
                .eq("project_id", project_id)
                .limit(1)
                .execute()
                .data
                or []
            )
            selection_data = {
                "status": "Terpilih",
                "selection_date": now_iso[:10],
                "notes": f"Project ditetapkan melalui finalisasi artikel oleh Admin (artikel {article_id}).",
                "updated_at": now_iso,
            }

            if existing_selection:
                service.table("project_selection").update(selection_data).eq(
                    "id", int(existing_selection[0]["id"])
                ).execute()
            else:
                service.table("project_selection").insert({
                    "project_id": project_id,
                    **selection_data,
                }).execute()

        _write_audit_log(
            service,
            user_id=int(current_admin["id"]),
            action="article.finalize",
            entity_type="article",
            entity_id=article_id,
            description=f"Finalisasi artikel {article_id} oleh Admin",
        )
        return article
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memfinalisasi artikel")
        raise AssertionError("unreachable")


@router.get("/articles/{article_id}/versions", response_model=list[dict[str, Any]])
def list_article_versions(
    article_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    if not supabase.table("articles").select("id").eq("id", article_id).maybe_single().execute().data:
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
    return (
        supabase.table("article_versions")
        .select("id,article_id,version_number,file_name,file_path,file_url,file_type,file_size,uploaded_by,version_status,submission_note,uploaded_at")
        .eq("article_id", article_id)
        .order("version_number", desc=True)
        .execute()
        .data
        or []
    )


@router.get("/articles/{article_id}/workflow", response_model=dict[str, Any])
def article_workflow(
    article_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    article = (
        supabase.table("articles")
        .select("id,project_id,title,abstract,journal_id,status,current_version_id,submitted_at,finalized_at,created_at,updated_at")
        .eq("id", article_id)
        .limit(1)
        .execute()
        .data
    )
    if not article:
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
    return {
        "article": article,
        "versions": supabase.table("article_versions").select("id,article_id,version_number,file_name,file_url,file_type,file_size,uploaded_by,version_status,submission_note,uploaded_at").eq("article_id", article_id).order("version_number", desc=True).execute().data or [],
        "authors": supabase.table("article_authors").select("id,student_id,author_order,is_corresponding").eq("article_id", article_id).order("author_order").execute().data or [],
        "reviewer_assignments": supabase.table("reviewer_assignments").select("id,article_id,article_version_id,reviewer_id,assigned_by,assigned_at,deadline,status,admin_note,completed_at,created_at,updated_at").eq("article_id", article_id).order("created_at", desc=True).execute().data or [],
        "mentorship_assignments": supabase.table("mentorship_assignments").select("id,student_id,lecturer_id,article_id,assigned_by,assigned_at,status,notes").eq("article_id", article_id).order("assigned_at", desc=True).execute().data or [],
        "revision_requests": supabase.table("revision_requests").select("id,article_id,review_id,requested_by,revision_round,instructions,deadline,status,created_at,completed_at").eq("article_id", article_id).order("revision_round", desc=True).execute().data or [],
    }


@router.get("/reviewer-assignments", response_model=list[dict[str, Any]])
def list_reviewer_assignments(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
    status_filter: str | None = Query(default=None, alias="status", max_length=50),
):
    query = supabase.table("reviewer_assignments").select(
        "id,article_id,article_version_id,reviewer_id,assigned_by,assigned_at,deadline,status,admin_note,completed_at,created_at,updated_at"
    )
    if status_filter:
        query = query.eq("status", status_filter)
    rows = query.order("created_at", desc=True).execute().data or []

    article_ids = {int(row["article_id"]) for row in rows if row.get("article_id")}
    reviewer_ids = {int(row["reviewer_id"]) for row in rows if row.get("reviewer_id")}
    article_map: dict[int, dict[str, Any]] = {}
    reviewer_map: dict[int, dict[str, Any]] = {}
    if article_ids:
        article_rows = supabase.table("articles").select("id,title,status,journal_id,current_version_id").in_("id", list(article_ids)).execute().data or []
        article_map = {int(row["id"]): row for row in article_rows}
    if reviewer_ids:
        reviewer_rows = supabase.table("users").select("id,username,email,is_active").in_("id", list(reviewer_ids)).execute().data or []
        lecturer_rows = supabase.table("lecturers").select("user_id,full_name,academic_title,nidn,nip").in_("user_id", list(reviewer_ids)).execute().data or []
        lecturer_map = {int(row["user_id"]): row for row in lecturer_rows}
        reviewer_map = {int(row["id"]): {**row, "profile": lecturer_map.get(int(row["id"]))} for row in reviewer_rows}

    version_ids = {int(row["article_version_id"]) for row in rows if row.get("article_version_id")}
    version_map: dict[int, dict[str, Any]] = {}
    if version_ids:
        version_rows = (
            supabase.table("article_versions")
            .select("id,article_id,version_number,file_name,file_url,version_status,uploaded_at")
            .in_("id", list(version_ids))
            .execute()
            .data
            or []
        )
        version_map = {int(row["id"]): row for row in version_rows}

    for row in rows:
        row["article"] = article_map.get(int(row["article_id"])) if row.get("article_id") else None
        row["reviewer"] = reviewer_map.get(int(row["reviewer_id"])) if row.get("reviewer_id") else None
        row["article_version"] = version_map.get(int(row["article_version_id"])) if row.get("article_version_id") else None
    return rows


@router.post("/reviewer-assignments", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_reviewer_assignment(
    payload: ReviewerAssignmentCreate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    _ensure_reviewer(service, payload.reviewer_user_id)
    article = _first_row(
        service.table("articles")
        .select("id,title,current_version_id,status")
        .eq("id", payload.article_id)
        .limit(1)
        .execute()
    )
    if not article:
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
    if str(article.get("status", "")).lower() in {"final", "finalized"}:
        raise HTTPException(status_code=409, detail="Artikel yang sudah final tidak dapat di-assign")
    article_version_id = payload.article_version_id or article.get("current_version_id")

    # If current_version_id was not maintained, gracefully fall back to the
    # newest uploaded version instead of forcing the Admin to know its ID.
    if not article_version_id:
        latest_version = (
            service.table("article_versions")
            .select("id,article_id,version_number,file_name,file_url,version_status")
            .eq("article_id", payload.article_id)
            .order("version_number", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        if latest_version:
            article_version_id = latest_version[0]["id"]
            service.table("articles").update({
                "current_version_id": int(article_version_id),
                "updated_at": _now_iso(),
            }).eq("id", payload.article_id).execute()
        else:
            raise HTTPException(
                status_code=400,
                detail="Artikel belum memiliki file versi. Peserta harus mengunggah artikel terlebih dahulu.",
            )

    version = _ensure_article_version(service, payload.article_id, int(article_version_id))

    existing_rows = (
        service.table("reviewer_assignments")
        .select("id,status")
        .eq("article_id", payload.article_id)
        .eq("article_version_id", int(article_version_id))
        .eq("reviewer_id", payload.reviewer_user_id)
        .execute()
        .data
        or []
    )
    active_statuses = {"assigned", "pending", "in_review", "sedang direview", "review"}
    if any(str(r.get("status", "")).strip().lower() in active_statuses for r in existing_rows):
        raise HTTPException(status_code=409, detail="Reviewer sudah memiliki assignment aktif untuk versi ini")

    data = payload.model_dump(mode="json", exclude={"reviewer_user_id", "article_version_id"})
    data.update({
        "reviewer_id": payload.reviewer_user_id,
        "assigned_by": int(current_admin["id"]),
        "article_version_id": int(article_version_id),
    })
    try:
        assignment = (supabase.table("reviewer_assignments").insert(data).execute().data or [{}])[0]
        supabase.table("articles").update({"status": "Sedang Direview", "updated_at": _now_iso()}).eq("id", payload.article_id).execute()
        _notify_user(
            service,
            user_id=payload.reviewer_user_id,
            title="Assignment review baru",
            message=f'Artikel "{article["title"]}" ditugaskan kepada Anda untuk direview (v{version["version_number"]}).',
            notification_type="review_assignment",
            reference_type="reviewer_assignment",
            reference_id=int(assignment["id"]) if assignment.get("id") else None,
        )
        _write_audit_log(service, user_id=int(current_admin["id"]), action="reviewer_assignment.create", entity_type="reviewer_assignment", entity_id=int(assignment["id"]) if assignment.get("id") else None)
        return assignment
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal membuat assignment reviewer")
        raise AssertionError("unreachable")


@router.patch("/reviewer-assignments/{assignment_id}", response_model=dict[str, Any])
def update_reviewer_assignment(
    assignment_id: int,
    payload: ReviewerAssignmentUpdate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    data = payload.model_dump(mode="json", exclude_none=True, exclude={"reviewer_user_id"})
    if payload.reviewer_user_id is not None:
        _ensure_reviewer(service, payload.reviewer_user_id)
        data["reviewer_id"] = payload.reviewer_user_id

    if payload.article_version_id is not None:
        assignment = (
            service.table("reviewer_assignments")
            .select("article_id")
            .eq("id", assignment_id)
            .maybe_single()
            .execute()
            .data
        )
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
        version = (
            service.table("article_versions")
            .select("id,article_id")
            .eq("id", payload.article_version_id)
            .maybe_single()
            .execute()
            .data
        )
        if not version or int(version["article_id"]) != int(assignment["article_id"]):
            raise HTTPException(status_code=400, detail="Versi artikel tidak sesuai dengan assignment")

    try:
        response = supabase.table("reviewer_assignments").update(data).eq("id", assignment_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
        _write_audit_log(service, user_id=int(current_admin["id"]), action="reviewer_assignment.update", entity_type="reviewer_assignment", entity_id=assignment_id)
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui assignment reviewer")
        raise AssertionError("unreachable")


@router.delete("/reviewer-assignments/{assignment_id}", response_model=MessageOut)
def delete_reviewer_assignment(
    assignment_id: int,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    try:
        response = supabase.table("reviewer_assignments").delete().eq("id", assignment_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
        _write_audit_log(service, user_id=int(current_admin["id"]), action="reviewer_assignment.delete", entity_type="reviewer_assignment", entity_id=assignment_id)
        return {"message": "Assignment reviewer berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus assignment reviewer")
        raise AssertionError("unreachable")


@router.get("/reviews", response_model=list[dict[str, Any]])
def list_reviews(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
    status_filter: str | None = Query(default=None, alias="status", max_length=50),
    recommendation: str | None = Query(default=None, max_length=50),
):
    query = supabase.table("reviews").select(
        "id,assignment_id,article_version_id,reviewer_id,recommendation,overall_score,methodology_score,originality_score,results_score,discussion_score,writing_score,comments_for_author,comments_for_coordinator,status,submitted_at,created_at,updated_at"
    )
    if status_filter:
        query = query.eq("status", status_filter)
    if recommendation:
        query = query.eq("recommendation", recommendation)
    rows = query.order("created_at", desc=True).execute().data or []

    assignment_ids = {int(row["assignment_id"]) for row in rows if row.get("assignment_id")}
    article_map: dict[int, dict[str, Any]] = {}
    reviewer_map: dict[int, dict[str, Any]] = {}
    if assignment_ids:
        assignments = supabase.table("reviewer_assignments").select("id,article_id,deadline,status").in_("id", list(assignment_ids)).execute().data or []
        article_ids = {int(row["article_id"]) for row in assignments if row.get("article_id")}
        if article_ids:
            articles = supabase.table("articles").select("id,title,status,journal_id").in_("id", list(article_ids)).execute().data or []
            article_map = {int(row["id"]): row for row in articles}
        assignment_map = {int(row["id"]): row for row in assignments}
    else:
        assignment_map = {}

    reviewer_ids = {int(row["reviewer_id"]) for row in rows if row.get("reviewer_id")}
    if reviewer_ids:
        reviewer_rows = supabase.table("users").select("id,username,email").in_("id", list(reviewer_ids)).execute().data or []
        reviewer_map = {int(row["id"]): row for row in reviewer_rows}

    for row in rows:
        assignment = assignment_map.get(int(row["assignment_id"])) if row.get("assignment_id") else None
        row["assignment"] = assignment
        row["article"] = article_map.get(int(assignment["article_id"])) if assignment and assignment.get("article_id") else None
        row["reviewer"] = reviewer_map.get(int(row["reviewer_id"])) if row.get("reviewer_id") else None
    return rows


@router.get("/mentorship-assignments", response_model=list[dict[str, Any]])
def list_mentorship_assignments(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    rows = (
        supabase.table("mentorship_assignments")
        .select("id,student_id,lecturer_id,article_id,assigned_by,assigned_at,status,notes")
        .order("assigned_at", desc=True)
        .execute()
        .data
        or []
    )
    student_ids = {int(row["student_id"]) for row in rows if row.get("student_id")}
    lecturer_ids = {int(row["lecturer_id"]) for row in rows if row.get("lecturer_id")}
    article_ids = {int(row["article_id"]) for row in rows if row.get("article_id")}
    student_map = {}
    lecturer_map = {}
    article_map = {}
    if student_ids:
        student_rows = supabase.table("students").select("id,user_id,nim,full_name,study_program").in_("id", list(student_ids)).execute().data or []
        student_map = {int(row["id"]): row for row in student_rows}
    if lecturer_ids:
        lecturer_rows = supabase.table("lecturers").select("id,user_id,full_name,academic_title,nidn,nip").in_("id", list(lecturer_ids)).execute().data or []
        lecturer_map = {int(row["id"]): row for row in lecturer_rows}
    if article_ids:
        article_rows = supabase.table("articles").select("id,title,status").in_("id", list(article_ids)).execute().data or []
        article_map = {int(row["id"]): row for row in article_rows}
    for row in rows:
        row["student"] = student_map.get(int(row["student_id"])) if row.get("student_id") else None
        row["reviewer"] = lecturer_map.get(int(row["lecturer_id"])) if row.get("lecturer_id") else None
        row["article"] = article_map.get(int(row["article_id"])) if row.get("article_id") else None
    return rows


@router.post("/mentorship-assignments", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_mentorship_assignment(
    payload: MentorshipAssignmentCreate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    _ensure_student(service, payload.student_id)
    reviewer = _ensure_reviewer(service, payload.reviewer_user_id)
    article = (
        service.table("articles")
        .select("id,title,project_id")
        .eq("id", payload.article_id)
        .limit(1)
        .execute()
        .data
    )
    if not article:
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
    if article.get("project_id") and not _project_has_student(service, int(article["project_id"]), payload.student_id):
        raise HTTPException(status_code=400, detail="Peserta bukan pengusul/anggota project artikel tersebut")
    existing = (
        service.table("mentorship_assignments")
        .select("id,status")
        .eq("student_id", payload.student_id)
        .eq("lecturer_id", reviewer["id"])
        .eq("article_id", payload.article_id)
        .execute()
        .data
        or []
    )
    active = {"active", "berjalan", "in_progress"}
    if any(str(r.get("status", "")).strip().lower() in active for r in existing):
        raise HTTPException(status_code=409, detail="Assignment pembimbing aktif sudah ada")

    data = payload.model_dump(exclude={"reviewer_user_id"})
    data.update({"lecturer_id": reviewer["id"], "assigned_by": int(current_admin["id"])})
    try:
        assignment = (supabase.table("mentorship_assignments").insert(data).execute().data or [{}])[0]
        student = service.table("students").select("user_id").eq("id", payload.student_id).maybe_single().execute().data
        if student:
            _notify_user(service, user_id=int(student["user_id"]), title="Reviewer pendamping ditetapkan", message=f'Anda mendapatkan Reviewer {reviewer.get("full_name", "")} untuk artikel "{article["title"]}".', notification_type="mentorship_assignment", reference_type="mentorship_assignment", reference_id=int(assignment["id"]) if assignment.get("id") else None)
        _notify_user(service, user_id=payload.reviewer_user_id, title="Assignment pendampingan baru", message=f'Anda ditetapkan sebagai Reviewer pendamping untuk artikel "{article["title"]}".', notification_type="mentorship_assignment", reference_type="mentorship_assignment", reference_id=int(assignment["id"]) if assignment.get("id") else None)
        _write_audit_log(service, user_id=int(current_admin["id"]), action="mentorship_assignment.create", entity_type="mentorship_assignment", entity_id=int(assignment["id"]) if assignment.get("id") else None)
        return assignment
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal membuat assignment pembimbing")
        raise AssertionError("unreachable")


@router.patch("/mentorship-assignments/{assignment_id}", response_model=dict[str, Any])
def update_mentorship_assignment(
    assignment_id: int,
    payload: MentorshipAssignmentUpdate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    data = payload.model_dump(exclude_none=True, exclude={"reviewer_user_id"})
    if payload.reviewer_user_id is not None:
        reviewer = _ensure_reviewer(service, payload.reviewer_user_id)
        data["lecturer_id"] = reviewer["id"]
    try:
        response = supabase.table("mentorship_assignments").update(data).eq("id", assignment_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Assignment pembimbing tidak ditemukan")
        _write_audit_log(service, user_id=int(current_admin["id"]), action="mentorship_assignment.update", entity_type="mentorship_assignment", entity_id=assignment_id)
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui assignment pembimbing")
        raise AssertionError("unreachable")


@router.delete("/mentorship-assignments/{assignment_id}", response_model=MessageOut)
def delete_mentorship_assignment(
    assignment_id: int,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    try:
        response = supabase.table("mentorship_assignments").delete().eq("id", assignment_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Assignment pembimbing tidak ditemukan")
        _write_audit_log(service, user_id=int(current_admin["id"]), action="mentorship_assignment.delete", entity_type="mentorship_assignment", entity_id=assignment_id)
        return {"message": "Assignment pembimbing berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus assignment pembimbing")
        raise AssertionError("unreachable")


@router.get("/mentorship-sessions", response_model=list[dict[str, Any]])
def list_mentorship_sessions(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
    assignment_id: int | None = Query(default=None),
):
    query = supabase.table("mentorship_sessions").select(
        "id,assignment_id,session_date,topic,progress,guidance,student_notes,attendance_status,evidence_url,created_at"
    )
    if assignment_id is not None:
        query = query.eq("assignment_id", assignment_id)
    return query.order("session_date", desc=True).execute().data or []


# ============================================================
# PROJECT CRUD + MEMBERS
# ============================================================

def _ensure_course(service: Client, course_id: int | None) -> None:
    if course_id is None:
        return
    row = (
        service.table("courses")
        .select("id")
        .eq("id", course_id)
        .limit(1)
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="Mata kuliah tidak ditemukan")


def _ensure_student(service: Client, student_id: int | None) -> None:
    if student_id is None:
        return
    row = (
        service.table("students")
        .select("id")
        .eq("id", student_id)
        .limit(1)
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="Peserta tidak ditemukan")


def _ensure_journal(service: Client, journal_id: int | None) -> None:
    if journal_id is None:
        return
    row = (
        service.table("journals")
        .select("id")
        .eq("id", journal_id)
        .limit(1)
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="Jurnal tidak ditemukan")


@router.post("/projects", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_project(
    payload: AdminProjectCreate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    _ensure_student(service, payload.submitted_by)
    _ensure_course(service, payload.course_id)
    try:
        row = (
            supabase.table("projects")
            .insert(payload.model_dump(exclude_none=True))
            .execute()
            .data
            or [{}]
        )[0]
        _write_audit_log(
            service,
            user_id=int(current_admin["id"]),
            action="project.create",
            entity_type="project",
            entity_id=int(row["id"]) if row.get("id") else None,
        )
        return row
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal membuat project")
        raise AssertionError("unreachable")


@router.patch("/projects/{project_id}", response_model=dict[str, Any])
def update_project(
    project_id: int,
    payload: AdminProjectUpdate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    _ensure_student(service, payload.submitted_by)
    _ensure_course(service, payload.course_id)
    try:
        response = (
            supabase.table("projects")
            .update(payload.model_dump(exclude_none=True))
            .eq("id", project_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Project tidak ditemukan")
        _write_audit_log(service, user_id=int(current_admin["id"]), action="project.update", entity_type="project", entity_id=project_id)
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui project")
        raise AssertionError("unreachable")


@router.delete("/projects/{project_id}", response_model=MessageOut)
def delete_project(
    project_id: int,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    try:
        response = supabase.table("projects").delete().eq("id", project_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Project tidak ditemukan")
        _write_audit_log(service, user_id=int(current_admin["id"]), action="project.delete", entity_type="project", entity_id=project_id)
        return {"message": "Project berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus project")
        raise AssertionError("unreachable")


@router.get("/projects/{project_id}/article-access", response_model=dict[str, Any])
def project_article_access(
    project_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    """Return signed URLs for the latest article file belonging to a project."""
    try:
        project = (
            supabase.table("projects")
            .select("id")
            .eq("id", project_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not project:
            raise HTTPException(status_code=404, detail="Project tidak ditemukan")

        articles = (
            supabase.table("articles")
            .select("id,project_id,title,current_version_id,status,updated_at,created_at")
            .eq("project_id", project_id)
            .order("updated_at", desc=True)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not articles:
            raise HTTPException(status_code=404, detail="Artikel project belum tersedia")

        article = articles[0]
        version_id = article.get("current_version_id")
        if version_id is None:
            raise HTTPException(status_code=404, detail="Versi artikel aktif belum tersedia")

        versions = (
            supabase.table("article_versions")
            .select("id,article_id,version_number,file_name,file_path,version_status")
            .eq("id", int(version_id))
            .limit(1)
            .execute()
            .data
            or []
        )
        if not versions:
            raise HTTPException(status_code=404, detail="Versi artikel tidak ditemukan")

        version = versions[0]
        file_path = version.get("file_path")
        if not file_path:
            raise HTTPException(status_code=404, detail="File artikel belum tersedia")

        signed_url = _make_signed_url(supabase, str(file_path))
        if not signed_url:
            raise HTTPException(status_code=503, detail="Link file artikel gagal dibuat")

        return {
            "project_id": project_id,
            "article": {
                "id": int(article["id"]),
                "title": article.get("title"),
                "status": article.get("status"),
            },
            "version": {
                "id": int(version["id"]),
                "version_number": version.get("version_number"),
                "file_name": version.get("file_name"),
                "version_status": version.get("version_status"),
            },
            "view_url": signed_url,
            "download_url": signed_url,
        }
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal membuat akses artikel project")
        raise AssertionError("unreachable")


@router.get("/projects/{project_id}/workflow", response_model=dict[str, Any])
def project_workflow(
    project_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    project = (
        supabase.table("projects")
        .select("id,title,description,course_id,project_type,project_url,documentation_url,submitted_by,submitted_at,status,created_at,updated_at")
        .eq("id", project_id)
        .limit(1)
        .execute()
        .data
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project tidak ditemukan")
    articles = supabase.table("articles").select("id,project_id,title,journal_id,status,current_version_id,submitted_at,finalized_at").eq("project_id", project_id).order("created_at", desc=True).execute().data or []
    return {
        "project": project,
        "members": supabase.table("project_members").select("id,project_id,student_id,member_role").eq("project_id", project_id).order("id").execute().data or [],
        "selection": supabase.table("project_selection").select("id,project_id,selected_by,selection_date,status,score,notes,created_at,updated_at").eq("project_id", project_id).maybe_single().execute().data,
        "articles": articles,
        "mentorship_assignments": (supabase.table("mentorship_assignments").select("id,student_id,lecturer_id,article_id,assigned_by,assigned_at,status,notes").in_("article_id", [int(a["id"]) for a in articles]).execute().data if articles else []) or [],
    }


@router.get("/projects/{project_id}/members", response_model=list[dict[str, Any]])
def list_project_members(
    project_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    project = supabase.table("projects").select("id").eq("id", project_id).maybe_single().execute().data
    if not project:
        raise HTTPException(status_code=404, detail="Project tidak ditemukan")
    rows = (
        supabase.table("project_members")
        .select("id,project_id,student_id,member_role")
        .eq("project_id", project_id)
        .order("id")
        .execute()
        .data
        or []
    )
    student_ids = {int(r["student_id"]) for r in rows if r.get("student_id")}
    students = (
        supabase.table("students")
        .select("id,nim,full_name,study_program")
        .in_("id", list(student_ids))
        .execute()
        .data
        if student_ids
        else []
    )
    student_map = {int(r["id"]): r for r in (students or [])}
    for row in rows:
        row["student"] = student_map.get(int(row["student_id"])) if row.get("student_id") else None
    return rows


@router.post("/projects/{project_id}/members", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_project_member(
    project_id: int,
    payload: AdminProjectMemberCreate,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    if not service.table("projects").select("id").eq("id", project_id).maybe_single().execute().data:
        raise HTTPException(status_code=404, detail="Project tidak ditemukan")
    _ensure_student(service, payload.student_id)
    try:
        existing = (
            service.table("project_members")
            .select("id")
            .eq("project_id", project_id)
            .eq("student_id", payload.student_id)
            .limit(1)
            .execute()
            .data
        )
        if existing:
            raise HTTPException(status_code=409, detail="Peserta sudah menjadi anggota project")
        data = payload.model_dump(exclude_none=True)
        data["project_id"] = project_id
        return (supabase.table("project_members").insert(data).execute().data or [{}])[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menambahkan anggota project")
        raise AssertionError("unreachable")


@router.patch("/projects/{project_id}/members/{member_id}", response_model=dict[str, Any])
def update_project_member(
    project_id: int,
    member_id: int,
    payload: AdminProjectMemberUpdate,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    member = (
        service.table("project_members")
        .select("id,project_id")
        .eq("id", member_id)
        .eq("project_id", project_id)
        .limit(1)
        .execute()
        .data
    )
    if not member:
        raise HTTPException(status_code=404, detail="Anggota project tidak ditemukan")
    _ensure_student(service, payload.student_id)
    data = payload.model_dump(exclude_none=True)
    try:
        response = (
            supabase.table("project_members")
            .update(data)
            .eq("id", member_id)
            .eq("project_id", project_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Anggota project tidak ditemukan")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui anggota project")
        raise AssertionError("unreachable")


@router.delete("/projects/{project_id}/members/{member_id}", response_model=MessageOut)
def delete_project_member(
    project_id: int,
    member_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        response = (
            supabase.table("project_members")
            .delete()
            .eq("id", member_id)
            .eq("project_id", project_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Anggota project tidak ditemukan")
        return {"message": "Anggota project berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus anggota project")
        raise AssertionError("unreachable")


# ============================================================
# ARTICLE CRUD + AUTHORS
# ============================================================

@router.post("/articles", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_article(
    payload: AdminArticleCreate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    if payload.project_id is not None:
        if not service.table("projects").select("id").eq("id", payload.project_id).maybe_single().execute().data:
            raise HTTPException(status_code=404, detail="Project tidak ditemukan")
    _ensure_journal(service, payload.journal_id)
    try:
        row = (supabase.table("articles").insert(payload.model_dump(exclude_none=True)).execute().data or [{}])[0]
        _write_audit_log(service, user_id=int(current_admin["id"]), action="article.create", entity_type="article", entity_id=int(row["id"]) if row.get("id") else None)
        return row
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal membuat artikel")
        raise AssertionError("unreachable")


@router.patch("/articles/{article_id}", response_model=dict[str, Any])
def update_article(
    article_id: int,
    payload: AdminArticleUpdate,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    if payload.project_id is not None:
        if not service.table("projects").select("id").eq("id", payload.project_id).maybe_single().execute().data:
            raise HTTPException(status_code=404, detail="Project tidak ditemukan")
    _ensure_journal(service, payload.journal_id)
    if payload.current_version_id is not None:
        version = (
            service.table("article_versions")
            .select("id,article_id")
            .eq("id", payload.current_version_id)
            .maybe_single()
            .execute()
            .data
        )
        if not version or int(version["article_id"]) != article_id:
            raise HTTPException(status_code=400, detail="Versi artikel tidak sesuai dengan artikel")
    try:
        response = (
            supabase.table("articles")
            .update(payload.model_dump(exclude_none=True))
            .eq("id", article_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
        _write_audit_log(service, user_id=int(current_admin["id"]), action="article.update", entity_type="article", entity_id=article_id)
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui artikel")
        raise AssertionError("unreachable")


@router.delete("/articles/{article_id}", response_model=MessageOut)
def delete_article(
    article_id: int,
    current_admin: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    try:
        response = supabase.table("articles").delete().eq("id", article_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
        _write_audit_log(service, user_id=int(current_admin["id"]), action="article.delete", entity_type="article", entity_id=article_id)
        return {"message": "Artikel berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus artikel")
        raise AssertionError("unreachable")


@router.get("/articles/{article_id}/authors", response_model=list[dict[str, Any]])
def list_article_authors(
    article_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    if not supabase.table("articles").select("id").eq("id", article_id).maybe_single().execute().data:
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
    rows = (
        supabase.table("article_authors")
        .select("id,article_id,student_id,author_order,is_corresponding")
        .eq("article_id", article_id)
        .order("author_order")
        .execute()
        .data
        or []
    )
    student_ids = {int(r["student_id"]) for r in rows if r.get("student_id")}
    students = (
        supabase.table("students").select("id,nim,full_name,study_program").in_("id", list(student_ids)).execute().data
        if student_ids
        else []
    )
    student_map = {int(r["id"]): r for r in (students or [])}
    for row in rows:
        row["student"] = student_map.get(int(row["student_id"])) if row.get("student_id") else None
    return rows


@router.post("/articles/{article_id}/authors", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_article_author(
    article_id: int,
    payload: AdminArticleAuthorCreate,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    if not service.table("articles").select("id").eq("id", article_id).maybe_single().execute().data:
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
    _ensure_student(service, payload.student_id)
    existing_student = (
        service.table("article_authors")
        .select("id")
        .eq("article_id", article_id)
        .eq("student_id", payload.student_id)
        .limit(1)
        .execute()
        .data
    )
    if existing_student:
        raise HTTPException(status_code=409, detail="Peserta sudah menjadi author artikel")
    try:
        data = payload.model_dump()
        data["article_id"] = article_id
        return (supabase.table("article_authors").insert(data).execute().data or [{}])[0]
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menambahkan author artikel")
        raise AssertionError("unreachable")


@router.patch("/articles/{article_id}/authors/{author_id}", response_model=dict[str, Any])
def update_article_author(
    article_id: int,
    author_id: int,
    payload: AdminArticleAuthorUpdate,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    author = (
        service.table("article_authors")
        .select("id,article_id")
        .eq("id", author_id)
        .eq("article_id", article_id)
        .limit(1)
        .execute()
        .data
    )
    if not author:
        raise HTTPException(status_code=404, detail="Author artikel tidak ditemukan")
    if payload.student_id is not None:
        _ensure_student(service, payload.student_id)
    try:
        response = (
            supabase.table("article_authors")
            .update(payload.model_dump(exclude_none=True))
            .eq("id", author_id)
            .eq("article_id", article_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Author artikel tidak ditemukan")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui author artikel")
        raise AssertionError("unreachable")


@router.delete("/articles/{article_id}/authors/{author_id}", response_model=MessageOut)
def delete_article_author(
    article_id: int,
    author_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        response = (
            supabase.table("article_authors")
            .delete()
            .eq("id", author_id)
            .eq("article_id", article_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Author artikel tidak ditemukan")
        return {"message": "Author artikel berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus author artikel")
        raise AssertionError("unreachable")


# ============================================================
# NOTIFICATIONS
# ============================================================

@router.get("/notifications", response_model=list[dict[str, Any]])
def list_notifications(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
    user_id: int | None = Query(default=None),
    unread_only: bool = Query(default=False),
):
    query = supabase.table("notifications").select(
        "id,user_id,title,message,notification_type,reference_type,reference_id,is_read,created_at"
    )
    if user_id is not None:
        query = query.eq("user_id", user_id)
    if unread_only:
        query = query.eq("is_read", False)
    return query.order("created_at", desc=True).execute().data or []


@router.post("/notifications", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_notification(
    payload: AdminNotificationCreate,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    service = get_service_client()
    if not service.table("users").select("id").eq("id", payload.user_id).maybe_single().execute().data:
        raise HTTPException(status_code=404, detail="User penerima tidak ditemukan")
    try:
        return (
            supabase.table("notifications")
            .insert(payload.model_dump(exclude_none=True))
            .execute()
            .data
            or [{}]
        )[0]
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal membuat notifikasi")
        raise AssertionError("unreachable")


@router.patch("/notifications/{notification_id}", response_model=dict[str, Any])
def update_notification(
    notification_id: int,
    payload: AdminNotificationUpdate,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        response = (
            supabase.table("notifications")
            .update(payload.model_dump())
            .eq("id", notification_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Notifikasi tidak ditemukan")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal memperbarui notifikasi")
        raise AssertionError("unreachable")


@router.delete("/notifications/{notification_id}", response_model=MessageOut)
def delete_notification(
    notification_id: int,
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    try:
        response = (
            supabase.table("notifications")
            .delete()
            .eq("id", notification_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Notifikasi tidak ditemukan")
        return {"message": "Notifikasi berhasil dihapus"}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_supabase_error(exc, "Gagal menghapus notifikasi")
        raise AssertionError("unreachable")


def count_finalized_articles(supabase: Client) -> int:
    """Count only articles explicitly finalized by Admin."""
    response = (
        supabase.table("articles")
        .select("id", count="exact", head=True)
        .in_("status", ["final", "finalized", "Final", "Finalized"])
        .execute()
    )
    return int(response.count or 0)


# ============================================================
# RECENT WORKFLOW ACTIVITY
# ============================================================

@router.get("/recent-activity", response_model=list[dict[str, Any]])
def recent_activity(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    """Return the latest cross-role workflow events for the Admin dashboard.

    This intentionally builds events from the workflow tables as well as audit
    logs, because Reviewer/Peserta workflow actions are not all recorded in
    audit_logs. The endpoint is safe to load in the background.
    """
    events: list[dict[str, Any]] = []

    audit_rows = (
        supabase.table("audit_logs")
        .select("id,user_id,action,entity_type,entity_id,description,created_at")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
        .data
        or []
    )

    assignment_rows = (
        supabase.table("reviewer_assignments")
        .select("id,article_id,reviewer_id,assigned_at,status,updated_at")
        .order("assigned_at", desc=True)
        .limit(20)
        .execute()
        .data
        or []
    )

    review_rows = (
        supabase.table("reviews")
        .select("id,assignment_id,reviewer_id,recommendation,status,submitted_at,created_at")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
        .data
        or []
    )
    assignment_map = {int(row["id"]): row for row in assignment_rows if row.get("id") is not None}

    revision_rows = (
        supabase.table("revision_requests")
        .select("id,article_id,requested_by,revision_round,status,created_at,completed_at")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
        .data
        or []
    )

    version_rows = (
        supabase.table("article_versions")
        .select("id,article_id,version_number,uploaded_by,uploaded_at,file_name")
        .order("uploaded_at", desc=True)
        .limit(20)
        .execute()
        .data
        or []
    )

    selection_rows = (
        supabase.table("project_selection")
        .select("id,project_id,selected_by,status,selection_date,updated_at")
        .order("updated_at", desc=True)
        .limit(20)
        .execute()
        .data
        or []
    )

    article_ids: set[int] = set()
    project_ids: set[int] = set()
    user_ids: set[int] = set()
    lecturer_ids: set[int] = set()

    for row in assignment_rows:
        if row.get("article_id") is not None:
            article_ids.add(int(row["article_id"]))
        if row.get("reviewer_id") is not None:
            user_ids.add(int(row["reviewer_id"]))

    for row in review_rows:
        assignment = assignment_map.get(int(row["assignment_id"])) if row.get("assignment_id") is not None else None
        if assignment and assignment.get("article_id") is not None:
            article_ids.add(int(assignment["article_id"]))
        if row.get("reviewer_id") is not None:
            user_ids.add(int(row["reviewer_id"]))

    for row in revision_rows:
        if row.get("article_id") is not None:
            article_ids.add(int(row["article_id"]))
        if row.get("requested_by") is not None:
            user_ids.add(int(row["requested_by"]))

    for row in version_rows:
        if row.get("article_id") is not None:
            article_ids.add(int(row["article_id"]))
        if row.get("uploaded_by") is not None:
            user_ids.add(int(row["uploaded_by"]))

    for row in selection_rows:
        if row.get("project_id") is not None:
            project_ids.add(int(row["project_id"]))
        if row.get("selected_by") is not None:
            lecturer_ids.add(int(row["selected_by"]))

    for row in audit_rows:
        if row.get("user_id") is not None:
            user_ids.add(int(row["user_id"]))

    articles = (
        supabase.table("articles")
        .select("id,title,project_id")
        .in_("id", list(article_ids))
        .execute()
        .data
        if article_ids
        else []
    ) or []
    article_map = {int(row["id"]): row for row in articles}

    projects = (
        supabase.table("projects")
        .select("id,title")
        .in_("id", list(project_ids))
        .execute()
        .data
        if project_ids
        else []
    ) or []
    project_map = {int(row["id"]): row for row in projects}

    users = (
        supabase.table("users")
        .select("id,username,email")
        .in_("id", list(user_ids))
        .execute()
        .data
        if user_ids
        else []
    ) or []
    user_map = {int(row["id"]): (row.get("username") or row.get("email") or "Pengguna") for row in users}

    lecturers = (
        supabase.table("lecturers")
        .select("id,full_name,academic_title")
        .in_("id", list(lecturer_ids))
        .execute()
        .data
        if lecturer_ids
        else []
    ) or []
    lecturer_map = {}
    for row in lecturers:
        lecturer_name = row.get("full_name") or "Reviewer"
        academic_title = row.get("academic_title")
        lecturer_map[int(row["id"])] = (
            f"{lecturer_name}, {academic_title}"
            if academic_title
            else lecturer_name
        )

    # Keep the audit-log stream for actual Admin actions, but reconstruct
    # workflow actions that historically were not written to audit_logs.
    reconstructed_audit_actions = {
        "reviewer_assignment.create",
        "project_selection.create",
        "project_selection.update",
    }
    for row in audit_rows:
        action = str(row.get("action") or "")
        if action in reconstructed_audit_actions:
            continue
        events.append({
            "id": f'audit:{row.get("id")}',
            "action": action,
            "description": row.get("description") or (f'oleh {user_map.get(int(row["user_id"]), "Admin")}' if row.get("user_id") else ""),
            "created_at": row.get("created_at"),
        })

    for row in assignment_rows:
        article = article_map.get(int(row["article_id"])) if row.get("article_id") is not None else None
        reviewer_name = user_map.get(int(row["reviewer_id"]), "Reviewer") if row.get("reviewer_id") is not None else "Reviewer"
        events.append({
            "id": f'assignment:{row.get("id")}',
            "action": "reviewer_assignment.create",
            "description": f'{reviewer_name} ditugaskan untuk "{article.get("title")}"' if article and article.get("title") else f"{reviewer_name} ditugaskan sebagai Reviewer",
            "created_at": row.get("assigned_at") or row.get("updated_at"),
        })

    for row in review_rows:
        assignment = assignment_map.get(int(row["assignment_id"])) if row.get("assignment_id") is not None else None
        article_id = assignment.get("article_id") if assignment else None
        article = article_map.get(int(article_id)) if article_id is not None else None
        reviewer_name = user_map.get(int(row["reviewer_id"]), "Reviewer") if row.get("reviewer_id") is not None else "Reviewer"
        status = str(row.get("status") or "").strip().lower()
        recommendation = str(row.get("recommendation") or "").strip()
        if status == "draft" and not row.get("submitted_at"):
            action = "review.start"
            description = f'{reviewer_name} sedang mereview "{article.get("title")}"' if article and article.get("title") else f"{reviewer_name} sedang mereview"
            created_at = row.get("created_at")
        else:
            action = "review.submit"
            description = f'{reviewer_name} mengirim review: {recommendation or "keputusan review"}'
            created_at = row.get("submitted_at") or row.get("created_at")
        events.append({"id": f'review:{row.get("id")}', "action": action, "description": description, "created_at": created_at})

    for row in revision_rows:
        article = article_map.get(int(row["article_id"])) if row.get("article_id") is not None else None
        reviewer_name = user_map.get(int(row["requested_by"]), "Reviewer") if row.get("requested_by") is not None else "Reviewer"
        events.append({
            "id": f'revision:{row.get("id")}',
            "action": "revision.request",
            "description": f'{reviewer_name} meminta revisi  {row.get("revision_round") or ""}'.strip() + (f' untuk "{article.get("title")}"' if article and article.get("title") else ""),
            "created_at": row.get("created_at"),
        })

    for row in version_rows:
        article = article_map.get(int(row["article_id"])) if row.get("article_id") is not None else None
        uploader = user_map.get(int(row["uploaded_by"]), "Peserta") if row.get("uploaded_by") is not None else "Peserta"
        version_number = int(row.get("version_number") or 0)
        events.append({
            "id": f'version:{row.get("id")}',
            "action": "article.revision_upload" if version_number > 1 else "article.submit",
            "description": f'{uploader} mengunggah revisi v{version_number}' if version_number > 1 else f'{uploader} mengirim artikel',
            "created_at": row.get("uploaded_at"),
        })

    for row in selection_rows:
        project = project_map.get(int(row["project_id"])) if row.get("project_id") is not None else None
        status = str(row.get("status") or "").strip().lower()
        selected_by = lecturer_map.get(int(row["selected_by"]), "Reviewer") if row.get("selected_by") is not None else "Reviewer"
        events.append({
            "id": f'selection:{row.get("id")}',
            "action": "project_selection.update",
            "description": f'Proyek "{project.get("title")}" berstatus {row.get("status")}' if project and project.get("title") else f"Status proyek diperbarui oleh {selected_by}",
            "created_at": row.get("updated_at") or row.get("selection_date"),
        })

    events.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return events[:5]


# ============================================================
# AUDIT LOGS
# ============================================================

@router.get("/audit-logs", response_model=list[dict[str, Any]])
def list_audit_logs(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
    user_id: int | None = Query(default=None),
    action: str | None = Query(default=None, max_length=100),
    entity_type: str | None = Query(default=None, max_length=100),
):
    query = supabase.table("audit_logs").select(
        "id,user_id,action,entity_type,entity_id,description,ip_address,created_at"
    )
    if user_id is not None:
        query = query.eq("user_id", user_id)
    if action:
        query = query.eq("action", action)
    if entity_type:
        query = query.eq("entity_type", entity_type)
    return query.order("created_at", desc=True).execute().data or []


# ============================================================
# REPORTS
# ============================================================

@router.get("/reports/summary", response_model=AdminReportSummaryOut)
def report_summary(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    def count(table: str) -> int:
        response = supabase.table(table).select("id", count="exact", head=True).execute()
        return int(response.count or 0)

    role_rows = supabase.table("user_roles").select("user_id,role:roles(name)").execute().data or []
    reviewer_ids: set[int] = set()
    peserta_ids: set[int] = set()
    for row in role_rows:
        uid = row.get("user_id")
        role = str((row.get("role") or {}).get("name", "")).lower()
        if uid is None:
            continue
        if role == "reviewer":
            reviewer_ids.add(int(uid))
        elif role == "peserta":
            peserta_ids.add(int(uid))

    active_response = (
        supabase.table("users")
        .select("id", count="exact", head=True)
        .eq("is_active", True)
        .execute()
    )

    selected_projects = count_with_status(supabase, "projects", {"selected", "Selected", "Terpilih"})
    assignment_rows = supabase.table("reviewer_assignments").select("id,article_id,status").execute().data or []
    completed = sum(1 for row in assignment_rows if str(row.get("status", "")).lower() in {"completed", "selesai"})
    total_assignments = len(assignment_rows)

    article_rows = supabase.table("articles").select("id").execute().data or []
    assigned_article_ids = {int(row["article_id"]) for row in assignment_rows if row.get("article_id")}
    waiting_assignment = sum(1 for row in article_rows if int(row["id"]) not in assigned_article_ids)

    return {
        "total_users": count("users"),
        "total_reviewers": len(reviewer_ids),
        "total_peserta": len(peserta_ids),
        "active_users": int(active_response.count or 0),
        "total_projects": count("projects"),
        "selected_projects": selected_projects,
        "total_articles": len(article_rows),
        "articles_waiting_assignment": waiting_assignment,
        "articles_in_review": count_with_status(supabase, "articles", {"review", "in_review", "Sedang Direview"}),
        "articles_in_revision": count_with_status(supabase, "articles", {"revision", "revisi", "Dalam Revisi"}),
        "articles_finalized": count_finalized_articles(supabase),
        "total_review_assignments": total_assignments,
        "completed_review_assignments": completed,
        "pending_review_assignments": max(total_assignments - completed, 0),
        "total_revision_requests": count("revision_requests"),
    }


@router.get("/reports/summary.csv")
def report_summary_csv(
    _: dict = Depends(require_admin),
    supabase: Client = Depends(get_service_client),
):
    data = report_summary(_, supabase)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Metric", "Value"])
    for key, value in data.items():
        writer.writerow([key, value])
    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=pilar-admin-summary.csv"},
    )
