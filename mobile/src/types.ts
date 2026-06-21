// Entity shapes returned by the Helm backend (see server.js sanitizeTask / sanitizeProject).
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done';
export type ProjectStatus = 'active' | 'planning' | 'on-hold' | 'done' | 'archived';
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  due: string | null;
  today: boolean;
  remind: string | null;
  remindedAt: string | null;
  repeat: Repeat;
  projectIds: string[];
  tags: string[];
  subtasks: Subtask[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  notes: string;
  status: ProjectStatus;
  priority: Priority;
  color: string;
  area: string;
  due: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  userName: string;
  theme: string;
  weekStart: string;
  openrouterModel: string;
  hasKey: boolean;
  tz?: string;
}

export interface Activity {
  id: string;
  ts: string;
  type: string;
  text: string;
  refId: string | null;
}

export interface HelmState {
  projects: Project[];
  tasks: Task[];
  activity: Activity[];
  settings: Settings;
}
