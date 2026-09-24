from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


RoleName = Literal["admin", "reviewer", "peserta"]


class CurrentUserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    auth_user_id: str
    username: str
    email: EmailStr
    is_active: bool
    role: RoleName | None = None
    roles: list[RoleName] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AdminUserListItem(BaseModel):
    id: int
    auth_user_id: str | None = None
    username: str
    email: EmailStr
    is_active: bool
    roles: list[RoleName] = Field(default_factory=list)
    student_profile: dict | None = None
    lecturer_profile: dict | None = None
    participant_assignments: list[dict] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AdminUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: RoleName
    is_active: bool = True

    # Reviewer profile (lecturers table)
    nidn: str | None = Field(default=None, max_length=30)
    nip: str | None = Field(default=None, max_length=30)
    academic_title: str | None = Field(default=None, max_length=100)

    # Peserta profile (students table)
    nim: str | None = Field(default=None, max_length=30)
    study_program: str | None = Field(default=None, max_length=150)
    class_name: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    full_name: str | None = Field(default=None, max_length=150)
    course_id: int | None = Field(default=None, ge=1)
    mentor_lecturer_id: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_profile(self) -> "AdminUserCreate":
        if self.role == "reviewer":
            if not self.full_name:
                raise ValueError("full_name wajib diisi untuk Reviewer")
            if not self.nidn and not self.nip:
                raise ValueError("NIDN atau NIP wajib diisi untuk Reviewer")
        elif self.role == "peserta":
            if not self.full_name:
                raise ValueError("full_name wajib diisi untuk Peserta")
            if not self.nim:
                raise ValueError("NIM wajib diisi untuk Peserta")
            if (self.course_id is None) != (self.mentor_lecturer_id is None):
                raise ValueError("Mata kuliah dan Dosen Pendamping harus dipilih bersamaan")
        return self


class AdminUserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=100)
    email: EmailStr | None = None
    role: RoleName | None = None
    is_active: bool | None = None

    nidn: str | None = Field(default=None, max_length=30)
    nip: str | None = Field(default=None, max_length=30)
    academic_title: str | None = Field(default=None, max_length=100)
    full_name: str | None = Field(default=None, max_length=150)
    nim: str | None = Field(default=None, max_length=30)
    study_program: str | None = Field(default=None, max_length=150)
    class_name: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    course_id: int | None = Field(default=None, ge=1)
    mentor_lecturer_id: int | None = Field(default=None, ge=1)


class ParticipantCourseAssignmentCreate(BaseModel):
    course_id: int = Field(ge=1)
    lecturer_id: int = Field(ge=1)
    status: str = Field(default="active", max_length=50)


class ParticipantCourseAssignmentUpdate(BaseModel):
    course_id: int | None = Field(default=None, ge=1)
    lecturer_id: int | None = Field(default=None, ge=1)
    status: str | None = Field(default=None, max_length=50)


class AdminCourseCreate(BaseModel):
    code: str | None = Field(default=None, max_length=30)
    name: str = Field(min_length=1, max_length=150)
    semester: int | None = Field(default=None, ge=1, le=20)
    study_program: str | None = Field(default=None, max_length=150)


class AdminCourseUpdate(BaseModel):
    code: str | None = Field(default=None, max_length=30)
    name: str | None = Field(default=None, min_length=1, max_length=150)
    semester: int | None = Field(default=None, ge=1, le=20)
    study_program: str | None = Field(default=None, max_length=150)


class AdminJournalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    abbreviation: str | None = Field(default=None, max_length=100)
    sinta_level: str | None = Field(default=None, max_length=10)
    field: str | None = Field(default=None, max_length=150)
    website_url: str | None = Field(default=None, max_length=500)
    submission_url: str | None = Field(default=None, max_length=500)
    template_url: str | None = Field(default=None, max_length=500)
    apc_info: str | None = Field(default=None, max_length=255)
    is_active: bool = True


class AdminJournalUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    abbreviation: str | None = Field(default=None, max_length=100)
    sinta_level: str | None = Field(default=None, max_length=10)
    field: str | None = Field(default=None, max_length=150)
    website_url: str | None = Field(default=None, max_length=500)
    submission_url: str | None = Field(default=None, max_length=500)
    template_url: str | None = Field(default=None, max_length=500)
    apc_info: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None


class AdminProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    course_id: int | None = None
    project_type: str | None = Field(default=None, max_length=100)
    project_url: str | None = Field(default=None, max_length=500)
    documentation_url: str | None = Field(default=None, max_length=500)
    submitted_by: int
    submitted_at: datetime | None = None
    status: str | None = Field(default=None, max_length=50)


class AdminProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    course_id: int | None = None
    project_type: str | None = Field(default=None, max_length=100)
    project_url: str | None = Field(default=None, max_length=500)
    documentation_url: str | None = Field(default=None, max_length=500)
    submitted_by: int | None = None
    submitted_at: datetime | None = None
    status: str | None = Field(default=None, max_length=50)


class AdminProjectMemberCreate(BaseModel):
    student_id: int
    member_role: str | None = Field(default=None, max_length=50)


class AdminProjectMemberUpdate(BaseModel):
    student_id: int | None = None
    member_role: str | None = Field(default=None, max_length=50)


class AdminArticleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    abstract: str | None = None
    project_id: int | None = None
    journal_id: int | None = None
    status: str | None = Field(default=None, max_length=50)


class AdminArticleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    abstract: str | None = None
    project_id: int | None = None
    journal_id: int | None = None
    current_version_id: int | None = None
    status: str | None = Field(default=None, max_length=50)
    submitted_at: datetime | None = None
    finalized_at: datetime | None = None


class AdminArticleAuthorCreate(BaseModel):
    student_id: int
    author_order: int = Field(ge=1)
    is_corresponding: bool = False


class AdminArticleAuthorUpdate(BaseModel):
    student_id: int | None = None
    author_order: int | None = Field(default=None, ge=1)
    is_corresponding: bool | None = None


class ProjectSelectionCreate(BaseModel):
    project_id: int
    reviewer_user_id: int
    selection_date: date
    status: str = Field(min_length=1, max_length=50)
    score: float | None = Field(default=None, ge=0, le=100)
    notes: str | None = None


class ProjectSelectionUpdate(BaseModel):
    reviewer_user_id: int | None = None
    selection_date: date | None = None
    status: str | None = Field(default=None, min_length=1, max_length=50)
    score: float | None = Field(default=None, ge=0, le=100)
    notes: str | None = None


class ReviewerAssignmentCreate(BaseModel):
    article_id: int
    reviewer_user_id: int
    article_version_id: int | None = None
    deadline: date | None = None
    status: str = Field(default="assigned", min_length=1, max_length=50)
    admin_note: str | None = None


class ReviewerAssignmentUpdate(BaseModel):
    reviewer_user_id: int | None = None
    article_version_id: int | None = None
    deadline: date | None = None
    status: str | None = Field(default=None, min_length=1, max_length=50)
    admin_note: str | None = None


class MentorshipAssignmentCreate(BaseModel):
    student_id: int
    reviewer_user_id: int
    article_id: int
    status: str = Field(default="Active", min_length=1, max_length=50)
    notes: str | None = None


class MentorshipAssignmentUpdate(BaseModel):
    reviewer_user_id: int | None = None
    article_id: int | None = None
    status: str | None = Field(default=None, min_length=1, max_length=50)
    notes: str | None = None


class AdminNotificationCreate(BaseModel):
    user_id: int
    title: str = Field(min_length=1, max_length=255)
    message: str = Field(min_length=1)
    notification_type: str | None = Field(default=None, max_length=50)
    reference_type: str | None = Field(default=None, max_length=50)
    reference_id: int | None = None


class AdminNotificationUpdate(BaseModel):
    is_read: bool


class AdminReportSummaryOut(BaseModel):
    total_users: int
    total_reviewers: int
    total_peserta: int
    active_users: int
    total_projects: int
    selected_projects: int
    total_articles: int
    articles_waiting_assignment: int
    articles_in_review: int
    articles_in_revision: int
    articles_finalized: int
    total_review_assignments: int
    completed_review_assignments: int
    pending_review_assignments: int
    total_revision_requests: int


class MessageOut(BaseModel):
    message: str


class AdminDashboardOut(BaseModel):
    total_users: int
    total_reviewers: int
    total_peserta: int
    total_articles: int
    total_projects: int
    pending_assignments: int
    active_reviews: int
    revision_requests: int
    total_journals: int
    articles_accepted: int
    articles_finalized: int
    articles_ready_for_journal: int
    articles_submitted_to_journal: int
    articles_under_journal_review: int
    articles_published: int
    flow: dict[str, int]
    status_distribution: list[dict[str, Any]]
    journal_distribution: list[dict[str, Any]]
    journal_submission_distribution: list[dict[str, Any]]
    activity: list[dict[str, Any]]
    reviewer_performance: list[dict[str, Any]]
    progress: list[dict[str, Any]]
