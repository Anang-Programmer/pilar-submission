export type ReviewerAssignment = {
  id: number;
  article_id: number;
  article_version_id: number | null;
  reviewer_id: number;
  assigned_by: number;
  assigned_at?: string | null;
  deadline?: string | null;
  status?: string | null;
  admin_note?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  display_status: string;
  article?: {
    id: number;
    title: string;
    abstract?: string | null;
    status?: string | null;
    journal_id?: number | null;
  } | null;
  version?: {
    id: number;
    version_number: number;
    file_name?: string | null;
    file_url?: string | null;
    file_type?: string | null;
    file_size?: number | null;
    uploaded_at?: string | null;
    submission_note?: string | null;
  } | null;
  journal?: {
    id: number;
    name: string;
    abbreviation?: string | null;
    sinta_level?: string | null;
    website_url?: string | null;
    submission_url?: string | null;
    template_url?: string | null;
  } | null;
  authors?: Array<{
    id: number;
    student_id: number;
    author_order: number;
    is_corresponding?: boolean;
    student?: {
      id: number;
      nim: string;
      full_name: string;
    } | null;
  }>;
  pendamping?: {
    lecturer?: {
      id: number;
      full_name: string;
      academic_title?: string | null;
      nidn?: string | null;
      nip?: string | null;
    } | null;
  } | null;
  latest_review?: ReviewerReview | null;
  reviews?: ReviewerReview[];
};

export type ReviewerReview = {
  id: number;
  assignment_id: number;
  article_version_id: number | null;
  reviewer_id: number;
  recommendation?: string | null;
  overall_score?: number | null;
  comments_for_author?: string | null;
  comments_for_coordinator?: string | null;
  status?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function authorNames(item: ReviewerAssignment): string {
  const authors = [...(item.authors || [])].sort(
    (a, b) => (a.author_order || 0) - (b.author_order || 0),
  );
  if (!authors.length) return "-";
  return authors
    .map((author) => author.student?.full_name || `Mahasiswa #${author.student_id}`)
    .join(", ");
}

export function badgeClass(status: string): string {
  if (status === "Selesai") return "done";
  if (status === "Ditolak") return "reject";
  if (status === "Sedang Revisi") return "revision";
  if (status === "Sedang Review") return "review";
  return "pending";
}
