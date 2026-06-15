#!/usr/bin/env node
/*
 * Helm — project & task manager.
 * Zero-dependency Node.js server: static files + JSON REST API + OpenRouter proxy.
 * Run:  node server.js   (then open http://localhost:4321)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4321;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'helm.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---------------------------------------------------------------- storage

function defaultData() {
  return {
    version: 1,
    projects: [],
    tasks: [],
    activity: [],
    settings: {
      userName: '',
      theme: 'dark',
      openrouterKey: '',
      openrouterModel: 'anthropic/claude-sonnet-4.5',
      weekStart: 'monday',
    },
  };
}

let db = defaultData();

/* ---- optional cloud sync: Neon Postgres -------------------------------
 * Set DATABASE_URL to a Neon connection string (postgres://...neon.tech/...)
 * and the whole document is stored in Postgres via Neon's HTTP SQL endpoint
 * (no driver needed). The local JSON file is still written as a backup.
 * Run the server on any number of machines pointed at the same DATABASE_URL
 * and they share data (last-writer-wins; state is re-pulled every few
 * seconds of idle, so switching devices Just Works for a single user).
 */
const NEON_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
const useNeon = /^postgres(ql)?:\/\//.test(NEON_URL);
let neonEndpoint = null;
if (useNeon) {
  try { neonEndpoint = `https://${new URL(NEON_URL).hostname}/sql`; }
  catch (e) { console.error('Invalid DATABASE_URL:', e.message); process.exit(1); }
}

async function neonQuery(query, params = []) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000); // 10s max — prevents startup hang
  try {
    const resp = await fetch(neonEndpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': NEON_URL,
        'Neon-Raw-Text-Output': 'true',
        'Neon-Array-Mode': 'false',
      },
      body: JSON.stringify({ query, params }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error((data && data.message) || `Neon HTTP ${resp.status}`);
    return data; // { rows: [...] }
  } finally {
    clearTimeout(timer);
  }
}

let lastNeonLoad = 0;

function hydrate(raw) {
  db = Object.assign(defaultData(), raw);
  db.settings = Object.assign(defaultData().settings, (raw && raw.settings) || {});
}

async function neonLoad() {
  await neonQuery(`CREATE TABLE IF NOT EXISTS helm_store (
    id text PRIMARY KEY, doc jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await neonQuery(`SELECT doc FROM helm_store WHERE id = 'main'`);
  if (rows && rows.length) {
    const doc = typeof rows[0].doc === 'string' ? JSON.parse(rows[0].doc) : rows[0].doc;
    hydrate(doc);
  }
  lastNeonLoad = Date.now();
}

// In Neon mode, refresh from the cloud when idle so multiple devices stay in sync.
async function maybeRefreshFromNeon() {
  if (!useNeon || saveTimer || Date.now() - lastNeonLoad < 10000) return;
  try {
    const { rows } = await neonQuery(`SELECT doc FROM helm_store WHERE id = 'main'`);
    if (rows && rows.length) {
      const doc = typeof rows[0].doc === 'string' ? JSON.parse(rows[0].doc) : rows[0].doc;
      hydrate(doc);
    }
    lastNeonLoad = Date.now();
  } catch (err) {
    console.error('Neon refresh failed (serving local copy):', err.message);
  }
}

function loadDataLocal() {
  try {
    if (fs.existsSync(DATA_FILE)) hydrate(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch (err) {
    // Corrupt file: keep a copy aside rather than silently overwrite it.
    const backup = DATA_FILE + '.corrupt-' + Date.now();
    try { fs.copyFileSync(DATA_FILE, backup); } catch (_) {}
    console.error(`Could not parse ${DATA_FILE} (saved copy at ${backup}):`, err.message);
    db = defaultData();
  }
}

function persistLocal() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

let saveTimer = null;
function saveData() {
  // Debounced atomic write (local file always; Neon too when configured).
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try { persistLocal(); } catch (err) { console.error('Failed to save data:', err.message); }
    if (useNeon) {
      try {
        await neonQuery(
          `INSERT INTO helm_store (id, doc, updated_at) VALUES ('main', $1::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
          [JSON.stringify(db)]
        );
        lastNeonLoad = Date.now();
      } catch (err) {
        console.error('Neon save failed (local copy is safe):', err.message);
      }
    }
  }, 150);
}

process.on('exit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    try { persistLocal(); } catch (_) {}
  }
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// ---------------------------------------------------------------- helpers

const uid = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();

function logActivity(type, text, refId) {
  db.activity.unshift({ id: uid(), ts: now(), type, text, refId: refId || null });
  if (db.activity.length > 400) db.activity.length = 400;
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10 * 1024 * 1024) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);

// ---------------------------------------------------------------- entities

function sanitizeProject(input, existing) {
  const p = existing || {
    id: uid(), createdAt: now(),
  };
  if (input.name !== undefined) p.name = str(input.name).slice(0, 200);
  if (input.description !== undefined) p.description = str(input.description).slice(0, 5000);
  if (input.notes !== undefined) p.notes = str(input.notes).slice(0, 20000);
  if (input.status !== undefined) p.status = ['active', 'planning', 'on-hold', 'done', 'archived'].includes(input.status) ? input.status : 'active';
  if (input.priority !== undefined) p.priority = ['critical', 'high', 'medium', 'low'].includes(input.priority) ? input.priority : 'medium';
  if (input.color !== undefined) p.color = str(input.color, '#6366f1').slice(0, 20);
  if (input.area !== undefined) p.area = str(input.area).slice(0, 100);
  if (input.due !== undefined) p.due = input.due ? str(input.due).slice(0, 10) : null;
  if (input.pinned !== undefined) p.pinned = !!input.pinned;
  p.name = p.name || 'Untitled project';
  p.status = p.status || 'active';
  p.priority = p.priority || 'medium';
  p.color = p.color || '#6366f1';
  p.description = p.description || '';
  p.notes = p.notes || '';
  p.area = p.area || '';
  p.due = p.due || null;
  p.pinned = !!p.pinned;
  p.updatedAt = now();
  return p;
}

function sanitizeTask(input, existing) {
  const t = existing || { id: uid(), createdAt: now(), completedAt: null };
  if (input.title !== undefined) t.title = str(input.title).slice(0, 300);
  if (input.notes !== undefined) t.notes = str(input.notes).slice(0, 20000);
  if (input.status !== undefined) t.status = ['todo', 'doing', 'waiting', 'done'].includes(input.status) ? input.status : 'todo';
  if (input.priority !== undefined) t.priority = ['critical', 'high', 'medium', 'low'].includes(input.priority) ? input.priority : 'medium';
  if (input.due !== undefined) t.due = input.due ? str(input.due).slice(0, 10) : null;
  if (input.today !== undefined) t.today = !!input.today;
  if (input.remind !== undefined) {
    const v = str(input.remind).slice(0, 16);
    const newRemind = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : null;
    if (newRemind !== t.remind) t.remindedAt = null; // re-arm when the time changes
    t.remind = newRemind;
  }
  if (input.remindedAt !== undefined) t.remindedAt = input.remindedAt ? str(input.remindedAt).slice(0, 30) : null;
  if (input.repeat !== undefined) t.repeat = ['none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly'].includes(input.repeat) ? input.repeat : 'none';
  if (input.projectIds !== undefined) {
    const valid = new Set(db.projects.map((p) => p.id));
    t.projectIds = arr(input.projectIds).filter((id) => valid.has(id)).slice(0, 20);
  }
  if (input.tags !== undefined) {
    t.tags = arr(input.tags).map((x) => str(x).toLowerCase().trim().slice(0, 40)).filter(Boolean).slice(0, 20);
  }
  if (input.subtasks !== undefined) {
    t.subtasks = arr(input.subtasks).slice(0, 100).map((s) => ({
      id: str(s.id) || uid(),
      title: str(s.title).slice(0, 300),
      done: !!s.done,
    })).filter((s) => s.title);
  }
  t.title = t.title || 'Untitled task';
  t.notes = t.notes || '';
  t.status = t.status || 'todo';
  t.priority = t.priority || 'medium';
  t.due = t.due || null;
  t.today = !!t.today;
  t.remind = t.remind || null;
  t.remindedAt = t.remindedAt || null;
  t.repeat = t.repeat || 'none';
  t.projectIds = t.projectIds || [];
  t.tags = t.tags || [];
  t.subtasks = t.subtasks || [];
  t.updatedAt = now();
  return t;
}

function nextDue(due, repeat) {
  const d = due ? new Date(due + 'T12:00:00') : new Date();
  switch (repeat) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekdays': do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    default: return due;
  }
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- API router

async function handleAPI(req, res, pathname) {
  const seg = pathname.split('/').filter(Boolean); // ['api', 'tasks', ':id', ...]
  const method = req.method;

  // GET /api/health — instant liveness check for Railway/Render
  if (pathname === '/api/health' && method === 'GET') {
    return sendJSON(res, 200, { ok: true });
  }

  // GET /api/state — everything the client needs
  if (pathname === '/api/state' && method === 'GET') {
    await maybeRefreshFromNeon();
    const { openrouterKey, ...safeSettings } = db.settings;
    return sendJSON(res, 200, {
      projects: db.projects,
      tasks: db.tasks,
      activity: db.activity.slice(0, 100),
      settings: { ...safeSettings, hasKey: !!openrouterKey },
      authEnabled: !!HELM_PASSWORD || useGoogleAuth,
      googleAuth: useGoogleAuth,
    });
  }

  // ---- projects
  if (seg[1] === 'projects') {
    if (method === 'POST' && seg.length === 2) {
      const body = await readBody(req);
      const p = sanitizeProject(body);
      db.projects.push(p);
      logActivity('project-created', `Created project "${p.name}"`, p.id);
      saveData();
      return sendJSON(res, 201, p);
    }
    const proj = db.projects.find((p) => p.id === seg[2]);
    if (!proj) return sendJSON(res, 404, { error: 'Project not found' });
    if (method === 'PATCH') {
      const body = await readBody(req);
      const wasStatus = proj.status;
      sanitizeProject(body, proj);
      if (body.status && body.status !== wasStatus) {
        logActivity('project-status', `Project "${proj.name}" → ${proj.status}`, proj.id);
      }
      saveData();
      return sendJSON(res, 200, proj);
    }
    if (method === 'DELETE') {
      db.projects = db.projects.filter((p) => p.id !== proj.id);
      // Detach (don't delete) tasks that referenced this project.
      db.tasks.forEach((t) => { t.projectIds = t.projectIds.filter((id) => id !== proj.id); });
      logActivity('project-deleted', `Deleted project "${proj.name}"`);
      saveData();
      return sendJSON(res, 200, { ok: true });
    }
  }

  // ---- tasks
  if (seg[1] === 'tasks') {
    if (method === 'POST' && seg.length === 2) {
      const body = await readBody(req);
      const t = sanitizeTask(body);
      db.tasks.push(t);
      logActivity('task-created', `Added task "${t.title}"`, t.id);
      saveData();
      return sendJSON(res, 201, t);
    }
    const task = db.tasks.find((t) => t.id === seg[2]);
    if (!task) return sendJSON(res, 404, { error: 'Task not found' });

    // POST /api/tasks/:id/promote — the task grew up: turn it into a project.
    // Its checklist items become real tasks; the original task is removed.
    if (method === 'POST' && seg[3] === 'promote') {
      const palette = ['#6d6ffb', '#9b6dfb', '#f06292', '#ef5350', '#ffa726', '#ffd54f', '#66bb6a', '#26c6da', '#42a5f5', '#8d6e63'];
      const project = sanitizeProject({
        name: task.title,
        description: task.notes.split('\n')[0].slice(0, 500),
        notes: task.notes,
        status: 'active',
        priority: task.priority,
        due: task.due,
        color: palette[db.projects.length % palette.length],
      });
      db.projects.push(project);
      for (const s of task.subtasks) {
        const child = sanitizeTask({
          title: s.title,
          status: s.done ? 'done' : 'todo',
          priority: task.priority,
          tags: task.tags,
        });
        child.projectIds = [project.id];
        if (s.done) child.completedAt = now();
        db.tasks.push(child);
      }
      db.tasks = db.tasks.filter((t) => t.id !== task.id);
      logActivity('task-promoted', `Promoted "${task.title}" into a project`, project.id);
      saveData();
      return sendJSON(res, 201, project);
    }

    if (method === 'PATCH') {
      const body = await readBody(req);
      const wasDone = task.status === 'done';
      sanitizeTask(body, task);
      if (!wasDone && task.status === 'done') {
        if (task.repeat && task.repeat !== 'none') {
          // Recurring: roll forward instead of completing.
          task.status = 'todo';
          task.due = nextDue(task.due, task.repeat);
          task.today = false;
          task.subtasks.forEach((s) => { s.done = false; });
          if (task.remind) { // carry the reminder forward to the new due date, same time of day
            task.remind = task.due + 'T' + task.remind.slice(11, 16);
            task.remindedAt = null;
          }
          logActivity('task-done', `Completed "${task.title}" (repeats — next: ${task.due})`, task.id);
        } else {
          task.completedAt = now();
          logActivity('task-done', `Completed "${task.title}"`, task.id);
        }
      } else if (wasDone && task.status !== 'done') {
        task.completedAt = null;
      }
      saveData();
      return sendJSON(res, 200, task);
    }
    if (method === 'DELETE') {
      db.tasks = db.tasks.filter((t) => t.id !== task.id);
      logActivity('task-deleted', `Deleted task "${task.title}"`);
      saveData();
      return sendJSON(res, 200, { ok: true });
    }
  }

  // ---- settings
  if (pathname === '/api/settings' && method === 'PATCH') {
    const body = await readBody(req);
    const s = db.settings;
    if (body.userName !== undefined) s.userName = str(body.userName).slice(0, 100);
    if (body.theme !== undefined) s.theme = body.theme === 'light' ? 'light' : 'dark';
    if (body.openrouterModel !== undefined) s.openrouterModel = str(body.openrouterModel).slice(0, 100);
    if (body.openrouterKey !== undefined) s.openrouterKey = str(body.openrouterKey).slice(0, 300);
    saveData();
    const { openrouterKey, ...safe } = s;
    return sendJSON(res, 200, { ...safe, hasKey: !!openrouterKey });
  }

  // ---- full backup / restore
  if (pathname === '/api/backup' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="helm-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    });
    return res.end(JSON.stringify(db, null, 2));
  }
  if (pathname === '/api/restore' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !Array.isArray(body.projects) || !Array.isArray(body.tasks)) {
      return sendJSON(res, 400, { error: 'Not a valid Helm backup file' });
    }
    db = Object.assign(defaultData(), body);
    db.settings = Object.assign(defaultData().settings, body.settings || {});
    logActivity('restore', 'Restored data from backup');
    saveData();
    return sendJSON(res, 200, { ok: true });
  }

  // ---- AI proxy (OpenRouter)
  if (pathname === '/api/ai' && method === 'POST') {
    const body = await readBody(req);
    const key = db.settings.openrouterKey;
    if (!key) return sendJSON(res, 400, { error: 'No OpenRouter API key set. Add one in Settings.' });
    const messages = [];
    if (body.system) messages.push({ role: 'system', content: str(body.system).slice(0, 20000) });
    messages.push({ role: 'user', content: str(body.prompt).slice(0, 60000) });
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'Helm',
        },
        body: JSON.stringify({
          model: db.settings.openrouterModel || 'anthropic/claude-sonnet-4.5',
          messages,
          max_tokens: 2000,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const msg = (data.error && data.error.message) || `OpenRouter error (${resp.status})`;
        return sendJSON(res, 502, { error: msg });
      }
      const text = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : '';
      return sendJSON(res, 200, { text });
    } catch (err) {
      return sendJSON(res, 502, { error: 'Could not reach OpenRouter: ' + err.message });
    }
  }

  return sendJSON(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------- static files

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA fallback: serve index.html for unknown non-file routes.
      if (!path.extname(rel)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, b2) => {
          if (e2) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(b2);
        });
      }
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(buf);
  });
}

// ---------------------------------------------------------------- session auth
// Cookie-based sessions replace HTTP Basic Auth — works in iOS PWA standalone mode
// where the browser never shows a Basic Auth dialog.
// Set HELM_PASSWORD env var to enable password protection.

const HELM_PASSWORD = process.env.HELM_PASSWORD || '';
const HELM_USER = process.env.HELM_USER || 'helm'; // kept for display only

const sessions = new Set(); // in-memory; cleared on restart (forces re-login)

// Google OAuth (optional) — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + ALLOWED_GOOGLE_EMAIL
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const ALLOWED_GOOGLE_EMAIL = process.env.ALLOWED_GOOGLE_EMAIL || '';
const useGoogleAuth = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const oauthStates = new Set(); // CSRF tokens for OAuth flow

// Rate limiter — blocks an IP for 15 min after 5 failed password attempts
const loginAttempts = new Map(); // ip → { count, until }

function checkRateLimit(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return true;
  if (rec.until && Date.now() < rec.until) return false;
  if (rec.until) loginAttempts.delete(ip); // unblock expired
  return true;
}

function recordAttempt(ip, success) {
  if (success) { loginAttempts.delete(ip); return; }
  const rec = loginAttempts.get(ip) || { count: 0, until: null };
  rec.count++;
  if (rec.count >= 5) { rec.until = Date.now() + 15 * 60 * 1000; console.log(`  ⚠ IP ${ip} locked out after ${rec.count} failed logins`); }
  loginAttempts.set(ip, rec);
  if (loginAttempts.size > 10000) { const n = Date.now(); for (const [k, v] of loginAttempts) if (!v.until || v.until < n) loginAttempts.delete(k); }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq < 0) return;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  });
  return out;
}

function sessionCookie(token) {
  return `helm_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000`; // 30 days
}

function getBaseURL(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers['host'] || `localhost:${PORT}`}`;
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.add(token);
  if (sessions.size > 500) sessions.clear(); // safety valve
  return token;
}

function checkAuth(req, res) {
  if (!HELM_PASSWORD && !useGoogleAuth) return true;
  const cookies = parseCookies(req.headers['cookie']);
  if (cookies.helm_session && sessions.has(cookies.helm_session)) return true;
  sendJSON(res, 401, { error: 'Authentication required' });
  return false;
}

// Login handler (password-based)
async function handleLogin(req, res) {
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (!checkRateLimit(ip)) {
    return sendJSON(res, 429, { error: 'Too many failed attempts — try again in 15 minutes' });
  }
  if (!HELM_PASSWORD) {
    // No password configured — grant access unconditionally
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(createSession()) });
    return res.end(JSON.stringify({ ok: true }));
  }
  const body = await readBody(req);
  const pa = Buffer.from(String(body.password || '').padEnd(64));
  const pb = Buffer.from(HELM_PASSWORD.padEnd(64));
  if (crypto.timingSafeEqual(pa, pb)) {
    recordAttempt(ip, true);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(createSession()) });
    return res.end(JSON.stringify({ ok: true }));
  }
  recordAttempt(ip, false);
  const rec = loginAttempts.get(ip);
  const left = rec ? Math.max(0, 5 - rec.count) : 4;
  return sendJSON(res, 403, { error: `Incorrect password${left > 0 ? ` — ${left} attempt${left !== 1 ? 's' : ''} remaining` : ' — account locked for 15 minutes'}` });
}

// Logout handler
function handleLogout(req, res) {
  const cookies = parseCookies(req.headers['cookie']);
  if (cookies.helm_session) sessions.delete(cookies.helm_session);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': 'helm_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0' });
  res.end(JSON.stringify({ ok: true }));
}

// Google OAuth handlers
async function handleGoogleStart(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.add(state);
  setTimeout(() => oauthStates.delete(state), 10 * 60 * 1000);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: getBaseURL(req) + '/auth/callback',
    response_type: 'code', scope: 'openid email', state, access_type: 'online',
  });
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  res.end();
}

async function handleGoogleCallback(req, res, url) {
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || !state || !oauthStates.has(state)) {
    res.writeHead(302, { Location: '/?error=google_failed' }); return res.end();
  }
  oauthStates.delete(state);
  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: getBaseURL(req) + '/auth/callback', grant_type: 'authorization_code' }).toString(),
    });
    const tokens = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok) throw new Error(tokens.error || 'Token exchange failed');
    const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const user = await userResp.json().catch(() => ({}));
    if (!userResp.ok) throw new Error('Could not get user info');
    if (ALLOWED_GOOGLE_EMAIL && user.email?.toLowerCase() !== ALLOWED_GOOGLE_EMAIL.toLowerCase()) {
      console.log(`  ⚠ Rejected Google login: ${user.email}`);
      res.writeHead(302, { Location: '/?error=not_allowed' }); return res.end();
    }
    console.log(`  ✓ Google login: ${user.email}`);
    res.writeHead(302, { Location: '/', 'Set-Cookie': sessionCookie(createSession()) });
    res.end();
  } catch (err) {
    console.error('  Google OAuth error:', err.message);
    res.writeHead(302, { Location: '/?error=google_failed' }); res.end();
  }
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method;
  try {
    // Always-public endpoints (no session required)
    if (pathname === '/api/health' && method === 'GET') return sendJSON(res, 200, { ok: true });
    if (pathname === '/api/auth-info' && method === 'GET') return sendJSON(res, 200, { hasPassword: !!HELM_PASSWORD, hasGoogle: useGoogleAuth });
    if (pathname === '/api/login' && method === 'POST') return handleLogin(req, res);
    if (pathname === '/api/logout' && method === 'POST') return handleLogout(req, res);
    if (useGoogleAuth && pathname === '/auth/google' && method === 'GET') return handleGoogleStart(req, res);
    if (useGoogleAuth && pathname === '/auth/callback' && method === 'GET') return handleGoogleCallback(req, res, url);
    // Static files are served without auth so the app shell (login UI) can load.
    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
    // All other API routes require a valid session.
    if (!checkAuth(req, res)) return;
    return await handleAPI(req, res, pathname);
  } catch (err) {
    return sendJSON(res, 500, { error: err.message || 'Server error' });
  }
});

(async function start() {
  loadDataLocal();

  // Listen FIRST so the healthcheck passes immediately, then connect to Neon.
  // Previously neonLoad() ran before listen() — if Neon was slow the server
  // never bound to the port and Railway's healthcheck timed out.
  await new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      const nets = os.networkInterfaces();
      const lan = [];
      for (const name of Object.keys(nets)) {
        for (const ni of nets[name] || []) {
          if (ni.family === 'IPv4' && !ni.internal) lan.push(ni.address);
        }
      }
      console.log('');
      console.log('  ⎈ Helm is running');
      console.log(`    Local:    http://localhost:${PORT}`);
      lan.forEach((ip) => console.log(`    Network:  http://${ip}:${PORT}   ← open this on your iPhone (same Wi-Fi)`));
      console.log(`    Data:     ${DATA_FILE}${useNeon ? '  (+ Neon cloud sync — connecting…)' : ''}`);
      if (useGoogleAuth) {
        console.log(`    Auth:     Google OAuth${ALLOWED_GOOGLE_EMAIL ? ` (${ALLOWED_GOOGLE_EMAIL})` : ' (any Google account)'}`);
      } else if (HELM_PASSWORD) {
        console.log(`    Auth:     password protected (rate-limited)`);
      } else {
        console.log('    Auth:     ⚠ no password — set HELM_PASSWORD env var before exposing to the internet');
      }
      console.log('');
      resolve();
    });
  });

  // Now connect to Neon in the background — won't block startup or healthcheck.
  if (useNeon) {
    try {
      await neonLoad();
      console.log('  ☁ Cloud sync: connected to Neon Postgres');
    } catch (err) {
      console.error('  ☁ Cloud sync FAILED (serving local data):', err.message);
    }
  }
})();
