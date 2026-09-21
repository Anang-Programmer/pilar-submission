-- PILAR latency indexes
-- Run once in Supabase SQL Editor. Safe to re-run.

create index if not exists idx_users_auth_user_id on public.users(auth_user_id);
create index if not exists idx_user_roles_user_id on public.user_roles(user_id);
create index if not exists idx_user_roles_role_id on public.user_roles(role_id);
create index if not exists idx_students_user_id on public.students(user_id);
create index if not exists idx_projects_submitted_by on public.projects(submitted_by);
create index if not exists idx_projects_course_id on public.projects(course_id);
create index if not exists idx_project_members_student_id on public.project_members(student_id);
create index if not exists idx_project_members_project_id on public.project_members(project_id);
create index if not exists idx_articles_project_id on public.articles(project_id);
create index if not exists idx_articles_journal_id on public.articles(journal_id);
create index if not exists idx_articles_current_version_id on public.articles(current_version_id);
create index if not exists idx_articles_updated_at on public.articles(updated_at desc);
create index if not exists idx_article_authors_article_id on public.article_authors(article_id);
create index if not exists idx_article_authors_student_id on public.article_authors(student_id);
create index if not exists idx_article_versions_article_id_version on public.article_versions(article_id, version_number desc);
create index if not exists idx_mentorship_assignments_article_id_assigned on public.mentorship_assignments(article_id, assigned_at desc);
create index if not exists idx_mentorship_assignments_student_id on public.mentorship_assignments(student_id);
create index if not exists idx_mentorship_assignments_lecturer_id on public.mentorship_assignments(lecturer_id);
create index if not exists idx_reviewer_assignments_reviewer_created on public.reviewer_assignments(reviewer_id, created_at desc);
create index if not exists idx_reviewer_assignments_article_created on public.reviewer_assignments(article_id, created_at desc);
create index if not exists idx_reviewer_assignments_article_version on public.reviewer_assignments(article_version_id);
create index if not exists idx_reviews_assignment_created on public.reviews(assignment_id, created_at desc);
create index if not exists idx_reviews_reviewer_submitted on public.reviews(reviewer_id, status, submitted_at desc);
create index if not exists idx_reviews_article_version on public.reviews(article_version_id);
create index if not exists idx_review_comments_review_created on public.review_comments(review_id, created_at);
create index if not exists idx_revision_requests_article_round on public.revision_requests(article_id, revision_round desc, created_at desc);
create index if not exists idx_revision_requests_review_id on public.revision_requests(review_id);
create index if not exists idx_participant_course_assignments_student_assigned on public.participant_course_assignments(student_id, assigned_at desc);
create index if not exists idx_participant_course_assignments_course_id on public.participant_course_assignments(course_id);
create index if not exists idx_participant_course_assignments_lecturer_id on public.participant_course_assignments(lecturer_id);
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
