// Dark theme — mirrors the Helm web app's CSS variables (public/css/style.css).
export const colors = {
  bg: '#0d1017',
  bgSoft: '#131722',
  card: '#181d2a',
  card2: '#1e2433',
  border: '#262d3f',
  borderSoft: '#1f2535',
  text: '#e8ebf4',
  textDim: '#9aa3b8',
  textFaint: '#67718a',
  accent: '#6d6ffb',
  accent2: '#9b6dfb',
  green: '#34d399',
  amber: '#fbbf24',
  red: '#f87171',
  blue: '#60a5fa',
};

export const radius = { sm: 9, md: 14 };

// Per-priority accent, matching the web app's semantics.
export const priorityColor: Record<string, string> = {
  critical: colors.red,
  high: colors.amber,
  medium: colors.blue,
  low: colors.textFaint,
};

// Per-task-status accent.
export const statusColor: Record<string, string> = {
  todo: colors.textDim,
  doing: colors.accent,
  waiting: colors.amber,
  done: colors.green,
};

export const statusLabel: Record<string, string> = {
  todo: 'To do',
  doing: 'In progress',
  waiting: 'Waiting on',
  done: 'Done',
};
