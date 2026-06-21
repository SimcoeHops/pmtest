// Date / display helpers shared across screens.

export function todayISO(): string {
  const d = new Date();
  // Local date, not UTC — Helm stores YYYY-MM-DD in the user's local sense.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// today + n days, as a local YYYY-MM-DD string.
export function addDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isOverdue(due: string | null, done: boolean): boolean {
  if (!due || done) return false;
  return due < todayISO();
}

export function isDueToday(due: string | null): boolean {
  return !!due && due === todayISO();
}

// Human label for a due date: "Today", "Tomorrow", "Mon", or "Jul 1".
export function fmtDue(due: string | null): string {
  if (!due) return '';
  const t = todayISO();
  if (due === t) return 'Today';

  const d = new Date(due + 'T12:00:00');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due === `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`) {
    return 'Tomorrow';
  }

  // Within the next week → weekday name.
  const diff = (d.getTime() - new Date(t + 'T12:00:00').getTime()) / 86400000;
  if (diff > 0 && diff < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}
