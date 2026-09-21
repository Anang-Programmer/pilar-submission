import { supabase } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type RequestOptions = RequestInit & { auth?: boolean };

type SessionSnapshot = {
  token: string;
  userId: string | null;
};

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const responseCache = new Map<string, CacheEntry>();
const inFlightCache = new Map<string, Promise<unknown>>();
const cacheGenerations = new Map<string, number>();

// Short-lived client caching removes repeated GET round trips while keeping
// workflow data fresh. Mutations clear the current user's cache immediately.
function cacheTtl(path: string): number {
  if (path === "/api/auth/me") return 30_000;
  if (path.includes("/dashboard")) return 8_000;
  if (path.includes("/assignments")) return 8_000;
  if (path.includes("/hasil-review")) return 10_000;
  if (path.includes("/riwayat")) return 10_000;
  if (path.endsWith("/profil")) return 30_000;
  if (path.includes("/upload-context")) return 20_000;
  if (path.startsWith("/api/admin/courses")) return 30_000;
  if (path.startsWith("/api/admin/journals")) return 30_000;
  if (path.startsWith("/api/admin/reviewers")) return 30_000;
  if (path.startsWith("/api/admin/participants")) return 15_000;
  return 10_000;
}

function buildCacheKey(path: string, userId: string | null): string {
  return `${userId ?? "public"}:${path}`;
}

function clearUserCache(userId: string | null): void {
  const scope = userId ?? "public";
  const prefix = `${scope}:`;
  cacheGenerations.set(scope, (cacheGenerations.get(scope) ?? 0) + 1);
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
  for (const key of inFlightCache.keys()) {
    if (key.startsWith(prefix)) inFlightCache.delete(key);
  }
}

async function getSessionSnapshot(): Promise<SessionSnapshot> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return {
    token: data.session?.access_token ?? "",
    userId: data.session?.user?.id ?? null,
  };
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    console.error("Supabase session refresh failed:", error);
    return null;
  }
  return data.session?.access_token ?? null;
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `HTTP ${response.status}`;

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.detail === "string") return parsed.detail;
    if (typeof parsed?.message === "string") return parsed.message;
  } catch {
    // Plain-text response.
  }

  return text;
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestUncached<T = any>(
  path: string,
  options: RequestOptions,
  retryNetwork: boolean,
  retryAuth: boolean,
  initialToken: string | null,
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const isForm = options.body instanceof FormData;
  let token = initialToken;

  async function fetchRequest(currentToken: string | null): Promise<Response> {
    const headers = new Headers(options.headers);
    if (!headers.has("Content-Type") && !isForm) {
      headers.set("Content-Type", "application/json");
    }
    if (options.auth !== false && currentToken) {
      headers.set("Authorization", `Bearer ${currentToken}`);
    }
    return fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });
  }

  let response: Response;

  try {
    response = await fetchRequest(token);
  } catch (error) {
    if (retryNetwork && isSafeMethod(method)) {
      await sleep(350);
      return requestUncached(path, options, false, retryAuth, token);
    }
    throw error;
  }

  if (
    response.status === 401 &&
    options.auth !== false &&
    retryAuth
  ) {
    const refreshedToken = await refreshAccessToken();

    if (refreshedToken) {
      token = refreshedToken;
      try {
        response = await fetchRequest(token);
      } catch (error) {
        if (isSafeMethod(method)) {
          await sleep(350);
          return requestUncached(path, options, false, false, token);
        }
        throw error;
      }
    }
  }

  if (
    retryNetwork &&
    isSafeMethod(method) &&
    isTransientStatus(response.status)
  ) {
    await sleep(350);
    return requestUncached(path, options, false, retryAuth, token);
  }

  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function request<T = any>(
  path: string,
  options: RequestOptions = {},
  retryNetwork = true,
  retryAuth = true,
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const cacheable = method === "GET" && options.cache !== "no-store";
  const session = options.auth === false ? { token: "", userId: null } : await getSessionSnapshot();

  if (options.auth !== false && !session.token) {
    throw new ApiError(
      "Sesi login tidak tersedia atau sudah kedaluwarsa.",
      401,
    );
  }

  if (!cacheable) {
    const value = await requestUncached(
      path,
      options,
      retryNetwork,
      retryAuth,
      session.token || null,
    );
    if (!isSafeMethod(method)) {
      clearUserCache(session.userId);
    }
    return value;
  }

  const key = buildCacheKey(path, session.userId);
  const scopeGeneration = cacheGenerations.get(session.userId ?? "public") ?? 0;
  const cached = responseCache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
    responseCache.delete(key);
  }

  const active = inFlightCache.get(key);
  if (active) return (await active) as T;

  const promise = requestUncached<T>(
    path,
    options,
    retryNetwork,
    retryAuth,
    session.token || null,
  );
  inFlightCache.set(key, promise);

  try {
    const value = await promise;
    const currentGeneration = cacheGenerations.get(session.userId ?? "public") ?? 0;
    if (currentGeneration === scopeGeneration) {
      responseCache.set(key, {
        expiresAt: Date.now() + cacheTtl(path),
        value,
      });
    }
    return value;
  } finally {
    if (inFlightCache.get(key) === promise) {
      inFlightCache.delete(key);
    }
  }
}

async function download(path: string, retryNetwork = true): Promise<Blob> {
  const session = await getSessionSnapshot();
  if (!session.token) {
    throw new ApiError(
      "Sesi login tidak tersedia atau sudah kedaluwarsa.",
      401,
    );
  }

  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
  } catch (error) {
    if (retryNetwork) {
      await sleep(350);
      return download(path, false);
    }
    throw error;
  }

  if (response.status === 401) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      response = await fetch(`${API_URL}${path}`, {
        headers: { Authorization: `Bearer ${refreshedToken}` },
      });
    }
  }

  if (retryNetwork && isTransientStatus(response.status)) {
    await sleep(350);
    return download(path, false);
  }

  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status);
  }

  return response.blob();
}

function query(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      qs.set(key, String(value));
    }
  }
  const value = qs.toString();
  return value ? `?${value}` : "";
}

export const api = {
  getMe: () => request("/api/auth/me"),

  login: async () => {
    throw new Error(
      "Login menggunakan Supabase Auth. Gunakan supabase.auth.signInWithPassword().",
    );
  },

  history: () => request("/api/reviews"),
  articles: () => request("/api/peserta/articles"),

  peserta: {
    dashboard: () => request("/api/peserta/dashboard"),
    articles: () => request("/api/peserta/articles"),
    article: (id: number | string) => request(`/api/peserta/articles/${id}`),
    projects: () => request("/api/peserta/projects"),
    uploadContext: () => request("/api/peserta/upload-context"),
    reviewResults: () => request("/api/peserta/hasil-review"),
    history: () => request("/api/peserta/riwayat"),
    profile: () => request("/api/peserta/profil"),
    updateProfile: (payload: any) => request("/api/peserta/profil", { method: "PATCH", body: JSON.stringify(payload) }),
    uploadInitialArticle: (form: FormData) => request("/api/peserta/articles/upload", { method: "POST", body: form }),
    uploadRevision: (articleId: number | string, form: FormData) => request(`/api/peserta/articles/${articleId}/revisions`, { method: "POST", body: form }),
    downloadVersion: (articleId: number | string, versionId: number | string) => request<{ url: string }>(`/api/peserta/articles/${articleId}/versions/${versionId}/download`),
    notifications: () => request("/api/peserta/notifikasi"),
  },

  reviewer: {
    dashboard: () => request("/api/reviewer/dashboard"),
    assignments: () => request("/api/reviewer/assignments"),
    assignment: (id: number | string) => request(`/api/reviewer/assignments/${id}`),
    downloadArticle: (id: number | string) => request<{ url: string }>(`/api/reviewer/assignments/${id}/download`),
    history: () => request("/api/reviewer/history"),
    saveReview: (id: number | string, payload: any) =>
      request(`/api/reviewer/assignments/${id}/review`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    submitReview: (id: number | string, payload: any) =>
      request(`/api/reviewer/assignments/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ ...payload, status: "submitted" }),
      }),
  },

  admin: {
    dashboard: () => request("/api/admin/dashboard"),
    users: (params?: { search?: string; role?: string; is_active?: boolean }) =>
      request(`/api/admin/users${query(params || {})}`),
    user: (id: number | string) =>
      request(`/api/admin/users/${id}`),
    participantAssignments: (userId: number | string) =>
      request(`/api/admin/users/${userId}/participant-assignments`),
    createParticipantAssignment: (userId: number | string, payload: any) =>
      request(`/api/admin/users/${userId}/participant-assignments`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateParticipantAssignment: (userId: number | string, assignmentId: number | string, payload: any) =>
      request(`/api/admin/users/${userId}/participant-assignments/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    deleteParticipantAssignment: (userId: number | string, assignmentId: number | string) =>
      request(`/api/admin/users/${userId}/participant-assignments/${assignmentId}`, {
        method: "DELETE",
      }),
    createUser: (payload: any) =>
      request("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateUser: (id: number, payload: any) =>
      request(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    deleteUser: (id: number) =>
      request(`/api/admin/users/${id}`, { method: "DELETE" }),

    reviewers: () => request("/api/admin/reviewers"),
    participants: () => request("/api/admin/participants"),

    courses: (search?: string) =>
      request(`/api/admin/courses${query({ search })}`),
    createCourse: (payload: any) =>
      request("/api/admin/courses", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateCourse: (id: number, payload: any) =>
      request(`/api/admin/courses/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    deleteCourse: (id: number) =>
      request(`/api/admin/courses/${id}`, { method: "DELETE" }),

    journals: (params?: { search?: string; is_active?: boolean }) =>
      request(`/api/admin/journals${query(params || {})}`),
    createJournal: (payload: any) =>
      request("/api/admin/journals", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateJournal: (id: number, payload: any) =>
      request(`/api/admin/journals/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    deleteJournal: (id: number) =>
      request(`/api/admin/journals/${id}`, { method: "DELETE" }),

    projects: (params?: { search?: string; status?: string }) =>
      request(`/api/admin/projects${query(params || {})}`),
    projectArticleAccess: (projectId: number) =>
      request(`/api/admin/projects/${projectId}/article-access`),
    projectSelection: () => request("/api/admin/project-selection"),
    createProjectSelection: (payload: any) =>
      request("/api/admin/project-selection", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateProjectSelection: (id: number, payload: any) =>
      request(`/api/admin/project-selection/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    deleteProjectSelection: (id: number) =>
      request(`/api/admin/project-selection/${id}`, { method: "DELETE" }),

    articlesAdmin: (params?: { search?: string; status?: string }) =>
      request(`/api/admin/articles${query(params || {})}`),
    articleVersions: (articleId: number) =>
      request(`/api/admin/articles/${articleId}/versions`),
    articleWorkflow: (articleId: number) =>
      request(`/api/admin/articles/${articleId}/workflow`),

    reviewerAssignments: (status?: string) =>
      request(`/api/admin/reviewer-assignments${query({ status })}`),
    createReviewerAssignment: (payload: any) =>
      request("/api/admin/reviewer-assignments", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateReviewerAssignment: (id: number, payload: any) =>
      request(`/api/admin/reviewer-assignments/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    deleteReviewerAssignment: (id: number) =>
      request(`/api/admin/reviewer-assignments/${id}`, { method: "DELETE" }),

    reviews: (params?: { status?: string; recommendation?: string }) =>
      request(`/api/admin/reviews${query(params || {})}`),

    mentorshipAssignments: () =>
      request("/api/admin/mentorship-assignments"),
    createMentorshipAssignment: (payload: any) =>
      request("/api/admin/mentorship-assignments", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateMentorshipAssignment: (id: number, payload: any) =>
      request(`/api/admin/mentorship-assignments/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    deleteMentorshipAssignment: (id: number) =>
      request(`/api/admin/mentorship-assignments/${id}`, { method: "DELETE" }),
    mentorshipSessions: () => request("/api/admin/mentorship-sessions"),

    notifications: (params?: { user_id?: number; unread_only?: boolean }) =>
      request(`/api/admin/notifications${query(params || {})}`),
    auditLogs: (params?: {
      user_id?: number;
      action?: string;
      entity_type?: string;
    }) => request(`/api/admin/audit-logs${query(params || {})}`),

    reportSummary: () => request("/api/admin/reports/summary"),
    exportReport: () => download("/api/admin/reports/summary.csv"),
  },
};
