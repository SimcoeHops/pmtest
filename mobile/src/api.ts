import type { HelmState, Task, Project } from './types';

// ───────────────────────────────────────────────────────────────────────────
// API_BASE — the Helm backend this app talks to. No trailing slash.
// To run against a computer on your LAN instead, swap this for e.g.
//   'http://192.168.1.20:4321'  (the "Network:" URL `node server.js` prints).
// ───────────────────────────────────────────────────────────────────────────
export const API_BASE = 'https://pmtest-production.up.railway.app';

// Thrown when the server says we're not authenticated (HTTP 401). The store
// catches this to show the login screen. `credentials: 'include'` makes the
// native networking layer send the session cookie set by POST /api/login.
export class AuthError extends Error {
  isAuthError = true as const;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(API_BASE + path, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = (data && data.error) || `Request failed (HTTP ${res.status})`;
    if (res.status === 401) throw new AuthError(message);
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  // Auth — POST the password; on success the server sets a session cookie that
  // the native cookie store then attaches to every later request automatically.
  // A wrong password returns 403 (a normal Error), not 401.
  login: (password: string) =>
    req<{ ok?: boolean }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),

  getState: () => req<HelmState>('/api/state'),

  createTask: (t: Partial<Task>) =>
    req<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(t) }),
  updateTask: (id: string, t: Partial<Task>) =>
    req<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(t) }),
  deleteTask: (id: string) =>
    req<{ ok: true }>(`/api/tasks/${id}`, { method: 'DELETE' }),
  promoteTask: (id: string) =>
    req<Project>(`/api/tasks/${id}/promote`, { method: 'POST' }),

  patchSettings: (patch: Record<string, unknown>) =>
    req<unknown>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  registerPush: (token: string, platform: string) =>
    req<{ ok: true }>('/api/push/register', { method: 'POST', body: JSON.stringify({ token, platform }) }),

  createProject: (p: Partial<Project>) =>
    req<Project>('/api/projects', { method: 'POST', body: JSON.stringify(p) }),
  updateProject: (id: string, p: Partial<Project>) =>
    req<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  deleteProject: (id: string) =>
    req<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
};
