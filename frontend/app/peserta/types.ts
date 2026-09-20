export type Student = {
  id: number;
  user_id: number;
  nim: string;
  full_name: string;
  study_program?: string | null;
  class_name?: string | null;
  phone?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type Journal = {
  id: number;
  name: string;
  abbreviation?: string | null;
  sinta_level?: string | null;
  field?: string | null;
  is_active?: boolean | null;
  website_url?: string | null;
  submission_url?: string | null;
  template_url?: string | null;
  apc_info?: string | null;
};

export type Course = {
  id: number;
  code?: string | null;
  name: string;
  semester?: number | null;
  study_program?: string | null;
};

export type ParticipantCourseAssignment = {
  id: number;
  student_id: number;
  course_id: number;
  lecturer_id?: number | null;
  assigned_by?: number | null;
  assigned_at?: string | null;
  status?: string | null;
  updated_at?: string | null;
  course?: Course | null;
  mentor?: {
    id: number;
    user_id: number;
    nidn?: string | null;
    nip?: string | null;
    full_name: string;
    academic_title?: string | null;
    email?: string | null;
  } | null;
};

export type ProjectSelection = {
  id: number;
  project_id: number;
  selected_by?: number | null;
  selection_date?: string | null;
  status?: string | null;
  score?: number | null;
  notes?: string | null;
};

export type Project = {
  id: number;
  title: string;
  description?: string | null;
  course_id?: number | null;
  project_type?: string | null;
  submitted_at?: string | null;
  status?: string | null;
  course?: Course | null;
  selection?: ProjectSelection | null;
};

export type ArticleVersion = {
  id: number;
  article_id: number;
  version_number: number;
  file_name?: string | null;
  file_path?: string | null;
  file_url?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  uploaded_by?: number | null;
  version_status?: string | null;
  submission_note?: string | null;
  uploaded_at?: string | null;
};

export type Author = {
  id: number;
  article_id: number;
  student_id: number;
  author_order: number;
  is_corresponding: boolean;
  student?: Student | null;
};

export type Mentor = {
  id: number;
  student_id: number;
  lecturer_id: number;
  article_id: number;
  assigned_by?: number | null;
  assigned_at?: string | null;
  status?: string | null;
  notes?: string | null;
  lecturer?: {
    id: number;
    user_id: number;
    nidn?: string | null;
    nip?: string | null;
    full_name: string;
    academic_title?: string | null;
    email?: string | null;
  } | null;
};

export type Review = {
  id: number;
  assignment_id: number;
  article_version_id?: number | null;
  reviewer_id: number;
  reviewer_name?: string | null;
  // reviewer_name?: string | null;
  recommendation?: string | null;
  overall_score?: number | null;
  comments_for_author?: string | null;
  status?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
};

export type RevisionRequest = {
  id: number;
  article_id: number;
  review_id?: number | null;
  requested_by: number;
  revision_round: number;
  instructions?: string | null;
  deadline?: string | null;
  status?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
};

export type Article = {
  id: number;
  project_id?: number | null;
  title: string;
  abstract?: string | null;
  journal_id?: number | null;
  status?: string | null;
  current_version_id?: number | null;
  submitted_at?: string | null;
  finalized_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  project?: Project | null;
  journal?: Journal | null;
  course?: Course | null;
  authors: Author[];
  current_version?: ArticleVersion | null;
  current_version_number?: number | null;
  latest_review?: Review | null;
  latest_revision_request?: RevisionRequest | null;
  review_count: number;
  pendamping?: Mentor | null;
  progress: number;
};

export type TimelineStep = {
  key: string;
  label: string;
  state: "done" | "current" | "pending";
  detail: string;
};

export type ParticipantDashboard = {
  student: Student;
  summary: {
    articles_count: number;
    reviews_count: number;
    revisions_required: number;
    progress: number;
    selected_projects_count: number;
  };
  active_project?: Project | null;
  active_article?: Article | null;
  timeline: TimelineStep[];
  latest_note?: {
    type: string;
    title: string;
    message: string;
    created_at?: string | null;
  } | null;
  recent_articles: Article[];
};


export type ParticipantProject = Project & {
  selection?: ProjectSelection | null;
  article?: Article | null;
};

export type UploadContext = {
  student: Student;
  assignments?: ParticipantCourseAssignment[];
  participant_assignments?: ParticipantCourseAssignment[];
  journals: Journal[];
};

export type ReviewResult = Article & {
  reviews: Review[];
};

export type HistoryRow = {
  article_id: number;
  article_title: string;
  version: ArticleVersion;
  status: string;
  recommendation?: string | null;
  description?: string | null;
};

export type ParticipantProfile = {
  user: {
    id: number;
    username?: string | null;
    email?: string | null;
  };
  student: Student;
  mentors: Mentor[];
  participant_assignments?: ParticipantCourseAssignment[];
};
