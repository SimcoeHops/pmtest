import type { Project, Priority } from './types';
import { todayISO } from './format';

// Quick-capture smart syntax, mirroring the web app:
//   "Renew SSL certs @Infra #security !high ^fri"
//   @project  #tag  !critical/!high/!medium/!low  ^today ^tomorrow ^fri ^eom ^2026-07-01
export interface ParsedCapture {
  title: string;
  priority: Priority;
  tags: string[];
  projectIds: string[];
  due: string | null;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function resolveDate(token: string): string | null {
  const t = token.toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;

  const now = new Date();
  if (t === 'today') return todayISO();
  if (t === 'tomorrow' || t === 'tom') {
    now.setDate(now.getDate() + 1);
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  if (t === 'eom') {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const wd = WEEKDAYS.indexOf(t.slice(0, 3));
  if (wd >= 0) {
    const diff = ((wd - now.getDay() + 7) % 7) || 7; // next occurrence (never today)
    now.setDate(now.getDate() + diff);
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  return null;
}

export function parseCapture(raw: string, projects: Project[]): ParsedCapture {
  let priority: Priority = 'medium';
  let due: string | null = null;
  const tags: string[] = [];
  const projectIds: string[] = [];
  const titleParts: string[] = [];

  for (const word of raw.trim().split(/\s+/)) {
    if (!word) continue;
    const lead = word[0];
    const rest = word.slice(1);

    if (lead === '!' && (PRIORITIES as string[]).includes(rest.toLowerCase())) {
      priority = rest.toLowerCase() as Priority;
      continue;
    }
    if (lead === '#' && rest) {
      tags.push(rest.toLowerCase());
      continue;
    }
    if (lead === '@' && rest) {
      const needle = rest.toLowerCase();
      const proj = projects.find(
        (p) =>
          p.name.toLowerCase().replace(/\s+/g, '').startsWith(needle) ||
          p.area.toLowerCase() === needle,
      );
      if (proj && !projectIds.includes(proj.id)) projectIds.push(proj.id);
      continue; // drop the token from the title whether or not it matched
    }
    if (lead === '^') {
      const d = resolveDate(rest);
      if (d) {
        due = d;
        continue;
      }
    }
    titleParts.push(word);
  }

  return { title: titleParts.join(' ').trim(), priority, tags, projectIds, due };
}
