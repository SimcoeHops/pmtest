import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api } from './api';
import { reconcileLocalReminders, registerPushToken, reportTimezone } from './notifications';
import type { HelmState, Task, Project } from './types';

const PASSWORD_KEY = 'helm-password';

interface StoreValue {
  state: HelmState | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;

  // Auth
  needsAuth: boolean;
  authBusy: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;

  addTask: (t: Partial<Task>) => Promise<void>;
  updateTask: (id: string, t: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  promoteTask: (id: string) => Promise<void>;
  restoreTask: (t: Task) => Promise<void>;

  addProject: (p: Partial<Project>) => Promise<void>;
  updateProject: (id: string, p: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  restoreProject: (p: Project, affectedTasks: Task[]) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HelmState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  // Pull state; on 401 try a saved password once, otherwise show the login gate.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await api.getState();
      setState(next);
      setNeedsAuth(false);
      setError(null);
    } catch (e: any) {
      if (e?.isAuthError) {
        const saved = await SecureStore.getItemAsync(PASSWORD_KEY);
        if (saved) {
          try {
            await api.login(saved);
            const next = await api.getState();
            setState(next);
            setNeedsAuth(false);
            setError(null);
            return;
          } catch {
            // Saved password no longer valid — fall through to the login screen.
          }
        }
        setNeedsAuth(true);
        setError(null);
      } else {
        setError(e?.message ?? 'Could not reach Helm');
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  // Initial load + refetch whenever the app returns to the foreground.
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // Whenever state changes, keep reminders + push registration in sync.
  useEffect(() => {
    if (!state) return;
    reconcileLocalReminders(state.tasks);
    registerPushToken();
    reportTimezone(state.settings.tz);
  }, [state]);

  const login = useCallback(
    async (password: string) => {
      setAuthBusy(true);
      try {
        await api.login(password); // throws (e.g. 403 "Incorrect password") on failure
        await SecureStore.setItemAsync(PASSWORD_KEY, password);
        const next = await api.getState();
        setState(next);
        setNeedsAuth(false);
        setError(null);
      } finally {
        setAuthBusy(false);
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(PASSWORD_KEY);
    setState(null);
    setNeedsAuth(true);
  }, []);

  // Run a mutation then re-pull state. A 401 mid-session bounces to the login gate.
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e: any) {
        if (e?.isAuthError) {
          setNeedsAuth(true);
          return;
        }
        throw e;
      }
      await refresh();
    },
    [refresh],
  );

  const value: StoreValue = {
    state,
    loading,
    refreshing,
    error,
    refresh,
    needsAuth,
    authBusy,
    login,
    logout,
    addTask: (t) => act(() => api.createTask(t)),
    updateTask: (id, t) => act(() => api.updateTask(id, t)),
    deleteTask: (id) => act(() => api.deleteTask(id)),
    promoteTask: (id) => act(() => api.promoteTask(id)),
    // Recreate a deleted task. The server assigns a fresh id and ignores the
    // extra fields (id/timestamps) it doesn't sanitize, so we can pass it whole.
    restoreTask: (t) => act(() => api.createTask(t)),
    addProject: (p) => act(() => api.createProject(p)),
    updateProject: (id, p) => act(() => api.updateProject(id, p)),
    deleteProject: (id) => act(() => api.deleteProject(id)),
    // Recreate a deleted project, then re-attach the tasks that were detached
    // when it was deleted (swapping the old project id for the new one).
    restoreProject: (p, affectedTasks) =>
      act(async () => {
        const created = await api.createProject(p);
        for (const t of affectedTasks) {
          const others = t.projectIds.filter((id) => id !== p.id);
          await api.updateTask(t.id, { projectIds: [...others, created.id] });
        }
      }),
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
