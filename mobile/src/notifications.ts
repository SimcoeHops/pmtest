// Reminders that fire even when the app is closed.
//
// Two paths, both driven by each task's `remind` ("YYYY-MM-DDTHH:MM" wall-clock):
//   1. On-device LOCAL notifications, scheduled here and reconciled on every
//      refresh. These work in Expo Go today (incl. iOS) and need no server.
//   2. SERVER push (Expo Push API) for reminders whose time arrives while the
//      app is fully closed and was never scheduled locally. We register an Expo
//      push token with the backend; getting a token requires a dev build on iOS
//      (Expo Go can't), so this is best-effort and silently no-ops otherwise.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from './api';
import type { Task } from './types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let permissionState: 'unknown' | 'granted' | 'denied' = 'unknown';

export async function ensurePermission(): Promise<boolean> {
  if (permissionState === 'granted') return true;
  if (permissionState === 'denied') return false;
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.HIGH,
      }).catch(() => {});
    }
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  permissionState = status === 'granted' ? 'granted' : 'denied';
  return permissionState === 'granted';
}

// Parse "YYYY-MM-DDTHH:MM" as a LOCAL date (no timezone shift).
function remindDate(remind: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(remind);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}

let scheduled = new Map<string, string>(); // taskId -> scheduled notification id
let hydrated = false;

async function hydrateScheduled() {
  if (hydrated) return;
  hydrated = true;
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of all) {
    const taskId = (n.content?.data as { taskId?: string } | undefined)?.taskId;
    if (taskId) scheduled.set(taskId, n.identifier);
  }
}

// Schedule a local notification for every future, un-fired reminder, and cancel
// any we previously scheduled that no longer apply. Idempotent — safe to call on
// every refresh.
export async function reconcileLocalReminders(tasks: Task[]) {
  if (!(await ensurePermission())) return;
  await hydrateScheduled();

  const now = Date.now();
  const wanted = new Map<string, Task>();
  for (const t of tasks) {
    if (t.status === 'done' || !t.remind || t.remindedAt) continue;
    const d = remindDate(t.remind);
    if (!d || d.getTime() <= now) continue; // past reminders are handled by server push / in-app
    wanted.set(t.id, t);
  }

  for (const [taskId, notifId] of [...scheduled]) {
    if (!wanted.has(taskId)) {
      await Notifications.cancelScheduledNotificationAsync(notifId).catch(() => {});
      scheduled.delete(taskId);
    }
  }

  for (const [taskId, t] of wanted) {
    if (scheduled.has(taskId)) continue;
    const d = remindDate(t.remind as string);
    if (!d) continue;
    try {
      const notifId = await Notifications.scheduleNotificationAsync({
        content: {
          title: '⏰ ' + t.title,
          body: t.due ? 'Due ' + t.due : 'Reminder',
          data: { taskId },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d },
      });
      scheduled.set(taskId, notifId);
    } catch {
      /* ignore individual scheduling failures */
    }
  }
}

let pushRegistered = false;
export async function registerPushToken() {
  if (pushRegistered) return;
  try {
    if (!Device.isDevice) return;
    if (!(await ensurePermission())) return;
    const projectId =
      (Constants?.expoConfig as { extra?: { eas?: { projectId?: string } } } | null)?.extra?.eas
        ?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await api.registerPush(data, Platform.OS);
    pushRegistered = true;
  } catch {
    // Expo Go on iOS can't mint a push token (needs a dev build). Local
    // notifications already cover reminders, so this is non-fatal.
  }
}

// Tell the server which timezone we're in so its push scheduler fires reminders
// at the right wall-clock.
let reportedTz: string | null = null;
export async function reportTimezone(currentTz: string | undefined) {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || tz === currentTz || tz === reportedTz) return;
    await api.patchSettings({ tz });
    reportedTz = tz;
  } catch {
    /* non-fatal */
  }
}
