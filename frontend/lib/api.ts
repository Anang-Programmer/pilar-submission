import { supabase } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type ClientCacheMode = "default" | "no-store";
type RequestOptions = RequestInit & {
  auth?: boolean;
  clientCache?: ClientCacheMode;
};

type SessionSnapshot = {
  token: string;
  userId: string | null;
};

type CacheEntry = {
  value: unknown;
  updatedAt: number;
};

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const cacheGenerations = new Map<string, number>();
let lastSessionUserId: string | null | undefined;

// Cache is intentionally memory-only. Next.js client navigation keeps this
// module alive, so sibling pages can reuse GET responses without persisting
// application data into browser storage.
function cacheTtl(path: string): number {
  if (path === "/api/auth/me") return 120_000;
  if (path.includes("/dashboard")) return 30_000;
  if (path.includes("/assignments")) return 30_000;
  if (path.includes("/hasil-review")) return 20_000;
  if (path.includes("/riwayat")) return 30_000;
  if (path.endsWith("/profil")) return 120_000;
  if (path.includes("/upload-context")) return 300_000;
  if (path.includes("/notifikasi")) return 15_000;

  if (path.startsWith("/api/admin/courses")) return 300_000;
  if (path.startsWith("/api/admin/journals")) return 300_000;
  if (path.startsWith("/api/admin/reviewers")) return 300_000;
  if (path.startsWith("/api/admin/participants")) return 120_000;
  if (path.startsWith("/api/admin/users")) return 30_000;
  if (path.startsWith("/api/admin/projects")) return 30_000;
  if (path.startsWith("/api/admin/articles")) return 30_000;
  if (path.startsWith("/api/admin/reviewer-assignments")) return 20_000;
  if (path.startsWith("/api/admin/reviews")) return 20_000;
  if (path.startsWith("/api/admin/mentorship")) return 30_000;
  if (path.startsWith("/api/admin/reports")) return 60_000;
  if (path.startsWith("/api/admin/audit-logs")) return 20_000;
  if (path.startsWith("/api/admin/recent-activity")) return 10_000;

  return 30_000;
}

function buildCacheKey(path: string, userId: string | null): string {
  return `${userId ?? "public"}:${path}`;
}

function cacheScopePrefix(userId: string | null): string {
  return `${userId ?? "public"}:`;
}

function isFresh(entry: CacheEntry, path: string): boolean {
  return Date.now() - entry.updatedAt < cacheTtl(path);
}

function clearCacheEntries(userId: string | null, prefixes: string[] = []): void {
  const prefix = cacheScopePrefix(userId);
  const keys = new Set([
    ...responseCache.keys(),
    ...inFlightRequests.keys(),
  ]);

  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;

    const path = key.slice(prefix.length);
    const shouldClear =
      prefixes.length === 0 ||
      prefixes.some((item) => path === item || path.startsWith(item));

    if (!shouldClear) continue;

    responseCache.delete(key);
    // Do not let an already-running GET put pre-mutation data back into cache.
    inFlightRequests.delete(key);
    cacheGenerations.set(key, (cacheGenerations.get(key) ?? 0) + 1);
  }
}

function mutationInvalidations(path: string, method: string): string[] {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return [];
  }

  // Participant article lifecycle.
  if (path === "/api/peserta/articles/upload" || path.includes("/api/peserta/articles/") && path.endsWith("/revisions")) {
    return [
      "/api/peserta/dashboard",
      "/api/peserta/articles",
      "/api/peserta/riwayat",
      "/api/peserta/hasil-review",
    ];
  }

  if (path === "/api/peserta/profil") {
    return ["/api/auth/me", "/api/peserta/profil", "/api/peserta/dashboard"];
  }

  // Reviewer review lifecycle.
  if (/^\/api\/reviewer\/assignments\/[^/]+\/review$/.test(path)) {
    return [
      "/api/reviewer/assignments",
      "/api/reviewer/dashboard",
      "/api/reviewer/history",
    ];
  }

  // Admin users and reference data.
  if (path.startsWith("/api/admin/users")) {
    return [
      "/api/admin/users",
      "/api/admin/reviewers",
      "/api/admin/participants",
      "/api/admin/dashboard",
    ];
  }
  if (path.startsWith("/api/admin/courses")) {
    return ["/api/admin/courses", "/api/admin/dashboard"];
  }
  if (path.startsWith("/api/admin/journals")) {
    return ["/api/admin/journals", "/api/admin/dashboard"];
  }
  if (path.startsWith("/api/admin/projects") || path.startsWith("/api/admin/project-selection")) {
    return ["/api/admin/projects", "/api/admin/project-selection", "/api/admin/dashboard"];
  }
  if (path.startsWith("/api/admin/articles")) {
    return [
      "/api/admin/articles",
      "/api/admin/projects",
      "/api/admin/project-selection",
      "/api/admin/dashboard",
    ];
  }
  if (path.startsWith("/api/admin/reviewer-assignments")) {
    return [
      "/api/admin/reviewer-assignments",
      "/api/admin/reviews",
      "/api/admin/dashboard",
    ];
  }
  if (path.startsWith("/api/admin/mentorship")) {
    return ["/api/admin/mentorship-assignments", "/api/admin/mentorship-sessions", "/api/admin/dashboard"];
  }
  if (path.startsWith("/api/admin/notifications")) {
    return ["/api/admin/notifications"];
  }

  return [];
}

async function getSessionSnapshot(): Promise<SessionSnapshot> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const userId = data.session?.user?.id ?? null;
  if (lastSessionUserId !== undefined && lastSessionUserId !== userId) {
    // Never reuse one account's cached API data for another account.
    clearCacheEntries(lastSessionUserId);
  }
  lastSessionUserId = userId;

  return {
    token: data.session?.access_token ?? "",
    userId,
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
    const { auth: _auth, clientCache: _clientCache, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers);

    if (!headers.has("Content-Type") && !isForm) {
      headers.set("Content-Type", "application/json");
    }

    if (options.auth !== false && currentToken) {
      headers.set("Authorization", `Bearer ${currentToken}`);
    }

    return fetch(`${API_URL}${path}`, {
      ...fetchOptions,
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

  if (response.status === 401 && options.auth !== false && retryAuth) {
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

function revalidateInBackground<T>(
  key: string,
  path: string,
  options: RequestOptions,
  retryNetwork: boolean,
  retryAuth: boolean,
  token: string | null,
): void {
  if (inFlightRequests.has(key)) return;

  const generation = cacheGenerations.get(key) ?? 0;
  const promise = requestUncached<T>(
    path,
    options,
    retryNetwork,
    retryAuth,
    token,
  );

  inFlightRequests.set(key, promise);
  void promise
    .then((value) => {
      const currentGeneration = cacheGenerations.get(key) ?? 0;
      if (currentGeneration === generation) {
        responseCache.set(key, {
          value,
          updatedAt: Date.now(),
        });
      }
    })
    .catch((error) => {
      // Background revalidation must never surface as a page error.
      console.warn(`Background revalidation failed for ${path}:`, error);
    })
    .finally(() => {
      if (inFlightRequests.get(key) === promise) {
        inFlightRequests.delete(key);
      }
    });

}

async function request<T = any>(
  path: string,
  options: RequestOptions = {},
  retryNetwork = true,
  retryAuth = true,
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const cacheable = method === "GET" && options.clientCache !== "no-store";
  const session =
    options.auth === false
      ? { token: "", userId: null }
      : await getSessionSnapshot();

  if (options.auth !== false && !session.token) {
    throw new ApiError(
      "Sesi login tidak tersedia atau sudah kedaluwarsa.",
      401,
    );
  }

  if (!cacheable) {
    const value = await requestUncached<T>(
      path,
      options,
      retryNetwork,
      retryAuth,
      session.token || null,
    );

    const invalidations = mutationInvalidations(path, method);
    const mutationTargets = [...new Set([
      ...invalidations,
      ...(method !== "GET" && path.startsWith("/api/admin/")
        ? ["/api/admin/recent-activity"]
        : []),
    ])];
    if (mutationTargets.length > 0) {
      clearCacheEntries(session.userId, mutationTargets);
      for (const target of mutationTargets) {
        // Warm affected GETs after the mutation without delaying the mutation response.
        void prefetch(target);
      }
    } else if (!isSafeMethod(method)) {
      // Unknown mutations invalidate all current-user cache rather than risk stale data.
      clearCacheEntries(session.userId);
    }

    return value;
  }

  const key = buildCacheKey(path, session.userId);
  const cached = responseCache.get(key);

  if (cached) {
    if (isFresh(cached, path)) {
      return cached.value as T;
    }

    // Stale-while-revalidate: return stale data immediately and refresh in background.
    revalidateInBackground(
      key,
      path,
      options,
      retryNetwork,
      retryAuth,
      session.token || null,
    );
    return cached.value as T;
  }

  const active = inFlightRequests.get(key);
  if (active) return (await active) as T;

  const generation = cacheGenerations.get(key) ?? 0;
  const promise = requestUncached<T>(
    path,
    options,
    retryNetwork,
    retryAuth,
    session.token || null,
  );
  inFlightRequests.set(key, promise);

  try {
    const value = await promise;
    const currentGeneration = cacheGenerations.get(key) ?? 0;
    if (currentGeneration === generation) {
      responseCache.set(key, {
        value,
        updatedAt: Date.now(),
      });
    }
    return value;
  } finally {
    if (inFlightRequests.get(key) === promise) {
      inFlightRequests.delete(key);
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

function canPrefetch(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  if (document.hidden) return false;

  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;

  if (connection?.saveData) return false;
  if (connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") {
    return false;
  }

  return true;
}

async function waitForIdle(delayMs = 2200): Promise<void> {
  if (typeof window === "undefined") return;

  // Give the active page a head start before background work is even considered.
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });

  if (!canPrefetch()) return;

  const idle = (window as Window & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
  }).requestIdleCallback;

  if (!idle) return;

  await new Promise<void>((resolve) => {
    idle(() => resolve(), { timeout: 1500 });
  });
}

async function prefetch(paths: string | string[]): Promise<void> {
  if (!canPrefetch()) return;

  const unique = [...new Set(Array.isArray(paths) ? paths : [paths])];

  for (let index = 0; index < unique.length; index += 1) {
    if (index > 0) {
      await waitForIdle(600);
      if (!canPrefetch()) return;
    }

    try {
      // request() deduplicates with an active request and reuses a fresh cache entry,
      // so prefetch never creates a duplicate GET for the same resource.
      await request(unique[index]);
    } catch {
      // Prefetch is optional. A failed background request must not affect the UI.
    }
  }
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
  prefetch,

  peserta: {
    dashboard: () => request("/api/peserta/dashboard"),
    articles: () => request("/api/peserta/articles"),
    article: (id: number | string) => request(`/api/peserta/articles/${id}`),
    projects: () => request("/api/peserta/projects"),
    uploadContext: () => request("/api/peserta/upload-context"),
    reviewResults: () => request("/api/peserta/hasil-review"),
    history: () => request("/api/peserta/riwayat"),
    profile: () => request("/api/peserta/profil"),
    updateProfile: (payload: any) =>
      request("/api/peserta/profil", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    uploadInitialArticle: (form: FormData) =>
      request("/api/peserta/articles/upload", {
        method: "POST",
        body: form,
      }),
    uploadRevision: (articleId: number | string, form: FormData) =>
      request(`/api/peserta/articles/${articleId}/revisions`, {
        method: "POST",
        body: form,
      }),
    downloadVersion: (articleId: number | string, versionId: number | string) =>
      request<{ url: string }>(
        `/api/peserta/articles/${articleId}/versions/${versionId}/download`,
      ),
    notifications: () => request("/api/peserta/notifikasi"),
  },

  reviewer: {
    dashboard: () => request("/api/reviewer/dashboard"),
    assignments: () => request("/api/reviewer/assignments"),
    assignment: (id: number | string) =>
      request(`/api/reviewer/assignments/${id}`),
    downloadArticle: (id: number | string) =>
      request<{ url: string }>(`/api/reviewer/assignments/${id}/download`),
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
    user: (id: number | string) => request(`/api/admin/users/${id}`),
    participantAssignments: (userId: number | string) =>
      request(`/api/admin/users/${userId}/participant-assignments`),
    createParticipantAssignment: (userId: number | string, payload: any) =>
      request(`/api/admin/users/${userId}/participant-assignments`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateParticipantAssignment: (
      userId: number | string,
      assignmentId: number | string,
      payload: any,
    ) =>
      request(`/api/admin/users/${userId}/participant-assignments/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    deleteParticipantAssignment: (
      userId: number | string,
      assignmentId: number | string,
    ) =>
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
    finalizeArticle: (articleId: number | string) =>
      request(`/api/admin/articles/${articleId}/finalize`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
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
    recentActivity: () => request("/api/admin/recent-activity"),

    reportSummary: () => request("/api/admin/reports/summary"),
    exportReport: () => download("/api/admin/reports/summary.csv"),
  },
};
