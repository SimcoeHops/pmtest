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
const { parseCapture } = require('./public/js/capture.js'); // shared with the browser

const PORT = process.env.PORT ? Number(process.env.PORT) : 4321;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'helm.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------- auth config
/* Auth is enabled when a password and/or Google OAuth is configured via env.
 * With neither set, the server runs OPEN (handy for localhost). Sessions are
 * stateless signed cookies (HMAC) — zero-dependency, survive restarts as long
 * as SESSION_SECRET is stable. */
const HELM_PASSWORD = process.env.HELM_PASSWORD || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';
const ALLOWED_EMAILS = (process.env.HELM_ALLOWED_EMAILS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const hasPassword = !!HELM_PASSWORD;
const hasGoogle = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const authEnabled = hasPassword || hasGoogle;
const SESSION_SECRET = process.env.SESSION_SECRET
  || (authEnabled
    ? crypto.createHash('sha256').update('helm:' + HELM_PASSWORD + ':' + GOOGLE_CLIENT_SECRET).digest('hex')
    : crypto.randomBytes(32).toString('hex'));
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE = 'helm_session';
// A standalone token that authorizes ONLY quick-capture (creating tasks), for
// iOS Shortcuts / automations that can't carry a login session.
const CAPTURE_TOKEN = process.env.HELM_CAPTURE_TOKEN || '';

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
    pushTokens: [], // [{ token, platform, addedAt }] — Expo push targets
    settings: {
      userName: '',
      theme: 'dark',
      openrouterKey: '',
      openrouterModel: 'anthropic/claude-sonnet-4.5',
      weekStart: 'monday',
      lastRollover: '', // date (YYYY-MM-DD) My Day was last rolled over
      tz: '', // IANA timezone (e.g. America/New_York) reported by the client
    },
  };
}

let db = defaultData();

/* ---- optional cloud sync: Neon Postgres -------------------------------
 * Set DATABASE_URL to a Neon connection string (postgres://...neon.tech/...)
 * and the whole document is stored in Postgres via Neon's HTTP SQL endpoint
 * (no driver needed). The local JSON file is still written as a backup.
 * Run the server on any number of machines pointed at the same DATABASE_URL
 * and they share data. Saves are NOT blind last-writer-wins: before each write
 * we re-read the cloud copy and, if another device wrote since we last synced,
 * merge entity-by-entity (newer `updatedAt` wins per task/project) so a second
 * device's edits aren't clobbered. (Known limit: a delete on one device can be
 * resurrected by another device that still holds an older copy — no tombstones.)
 */
const NEON_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
const useNeon = /^postgres(ql)?:\/\//.test(NEON_URL);
let neonEndpoint = null;
if (useNeon) {
  try { neonEndpoint = `https://${new URL(NEON_URL).hostname}/sql`; }
  catch (e) { console.error('Invalid DATABASE_URL:', e.message); process.exit(1); }
}

async function neonQuery(query, params = []) {
  const resp = await fetch(neonEndpoint, {
    method: 'POST',
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
}

let lastNeonLoad = 0;
let lastSyncedRev = 0; // updated_at (ms) of the cloud copy we last read or wrote

function hydrate(raw) {
  db = Object.assign(defaultData(), raw);
  db.settings = Object.assign(defaultData().settings, (raw && raw.settings) || {});
}

const SELECT_DOC = `SELECT doc, (EXTRACT(EPOCH FROM updated_at)*1000)::bigint AS ts FROM helm_store WHERE id = 'main'`;
const parseRow = (row) => ({
  doc: typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc,
  ts: Number(row.ts) || 0,
});

// Merge two arrays of {id, ...} keeping whichever copy has the later tsField.
function mergeById(localArr, remoteArr, tsField) {
  const byId = new Map();
  for (const it of remoteArr || []) if (it && it.id) byId.set(it.id, it);
  for (const it of localArr || []) {
    if (!it || !it.id) continue;
    const r = byId.get(it.id);
    if (!r) { byId.set(it.id, it); continue; }
    const lt = Date.parse(it[tsField]) || 0;
    const rt = Date.parse(r[tsField]) || 0;
    byId.set(it.id, lt >= rt ? it : r);
  }
  return [...byId.values()];
}

// Entity-level merge of the remote cloud doc into our in-memory db.
function mergeRemote(remote) {
  if (!remote) return;
  db.projects = mergeById(db.projects, remote.projects, 'updatedAt');
  db.tasks = mergeById(db.tasks, remote.tasks, 'updatedAt');
  const act = new Map();
  for (const a of [...(remote.activity || []), ...(db.activity || [])]) if (a && a.id) act.set(a.id, a);
  db.activity = [...act.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 400);
  // Settings: this device's values win, but fill any gaps from the cloud copy.
  db.settings = Object.assign({}, remote.settings, db.settings);
  if (remote.pushTokens) db.pushTokens = remote.pushTokens; // managed server-side; cloud is source
}

async function neonLoad() {
  await neonQuery(`CREATE TABLE IF NOT EXISTS helm_store (
    id text PRIMARY KEY, doc jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await neonQuery(SELECT_DOC);
  if (rows && rows.length) {
    const { doc, ts } = parseRow(rows[0]);
    hydrate(doc);
    lastSyncedRev = ts;
  }
  lastNeonLoad = Date.now();
}

// In Neon mode, refresh from the cloud when idle so multiple devices stay in sync.
async function maybeRefreshFromNeon() {
  if (!useNeon || saveTimer || Date.now() - lastNeonLoad < 10000) return;
  try {
    const { rows } = await neonQuery(SELECT_DOC);
    if (rows && rows.length) {
      const { doc, ts } = parseRow(rows[0]);
      hydrate(doc);
      lastSyncedRev = ts;
    }
    lastNeonLoad = Date.now();
  } catch (err) {
    console.error('Neon refresh failed (serving local copy):', err.message);
  }
}

// Pull-before-save: merge any newer cloud changes, then write the merged doc.
async function neonSave() {
  try {
    const { rows } = await neonQuery(SELECT_DOC);
    if (rows && rows.length) {
      const { doc, ts } = parseRow(rows[0]);
      if (ts > lastSyncedRev) mergeRemote(doc); // another device wrote since we synced
    }
  } catch (err) {
    console.error('Neon pre-save read failed (writing local state anyway):', err.message);
  }
  const { rows } = await neonQuery(
    `INSERT INTO helm_store (id, doc, updated_at) VALUES ('main', $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()
     RETURNING (EXTRACT(EPOCH FROM updated_at)*1000)::bigint AS ts`,
    [JSON.stringify(db)]
  );
  lastSyncedRev = (rows && rows[0] && Number(rows[0].ts)) || Date.now();
  lastNeonLoad = Date.now();
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
      try { await neonSave(); }
      catch (err) { console.error('Neon save failed (local copy is safe):', err.message); }
    }
  }, 150);
}

// Flush any pending debounced write before exiting so the last edit reaches the
// cloud, not just the local file.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (saveTimer) clearTimeout(saveTimer);
  try { persistLocal(); } catch (_) {}
  if (useNeon) {
    try { await neonSave(); } catch (err) { console.error('Neon flush on shutdown failed:', err.message); }
  }
  process.exit(0);
}
process.on('exit', () => {
  if (saveTimer) { clearTimeout(saveTimer); try { persistLocal(); } catch (_) {} }
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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

// ---------------------------------------------------------------- auth helpers

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const sign = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeSession(sub) {
  const payload = b64url(JSON.stringify({ sub, exp: Date.now() + SESSION_TTL_MS }));
  return payload + '.' + sign(payload);
}
function verifySession(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  if (!sig || sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(b64urlDecode(payload));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (_) { return null; }
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const isSecureReq = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
function cookieHeader(name, value, maxAgeSec, req) {
  const bits = [`${name}=${value}`, 'HttpOnly', 'Path=/', `Max-Age=${maxAgeSec}`, 'SameSite=Lax'];
  if (isSecureReq(req)) bits.push('Secure');
  return bits.join('; ');
}
const setSessionCookie = (req, res, token) =>
  res.setHeader('Set-Cookie', cookieHeader(COOKIE, token, Math.floor(SESSION_TTL_MS / 1000), req));
const clearSessionCookie = (req, res) =>
  res.setHeader('Set-Cookie', cookieHeader(COOKIE, '', 0, req));
const isAuthed = (req) => !authEnabled || !!verifySession(parseCookies(req)[COOKIE]);
const hasCaptureToken = (req) => !!CAPTURE_TOKEN && req.headers['x-helm-token'] === CAPTURE_TOKEN;

// ---- login rate limiting (per IP)
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map(); // ip -> { count, first }
function clientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}
function rateState(ip) {
  const rec = attempts.get(ip);
  if (rec && Date.now() - rec.first > LOCK_MS) { attempts.delete(ip); return null; }
  return rec || null;
}

// ---- Google OAuth (zero-dep, via fetch)
function googleRedirectUri(req) {
  if (GOOGLE_REDIRECT_URI) return GOOGLE_REDIRECT_URI;
  const proto = isSecureReq(req) ? 'https' : 'http';
  return `${proto}://${req.headers.host || `localhost:${PORT}`}/api/auth/google`;
}
function handleGoogleStart(req, res) {
  if (!hasGoogle) { res.writeHead(404); return res.end('Google sign-in not configured'); }
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', cookieHeader('helm_oauth_state', state, 600, req));
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(req),
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  });
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  res.end();
}
async function handleGoogleCallback(req, res, url) {
  const fail = (e) => { res.writeHead(302, { Location: '/?error=' + e }); res.end(); };
  if (!hasGoogle) return fail('auth_failed');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = parseCookies(req).helm_oauth_state;
  if (!code || !state || !cookieState || state !== cookieState) return fail('auth_failed');
  try {
    const tok = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const data = await tok.json();
    if (!tok.ok || !data.id_token) return fail('auth_failed');
    const claims = JSON.parse(b64urlDecode(data.id_token.split('.')[1]));
    const email = str(claims.email).toLowerCase();
    if (!email || claims.email_verified === false) return fail('auth_failed');
    if (ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes(email)) return fail('not_allowed');
    setSessionCookie(req, res, makeSession('google:' + email));
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (e) {
    return fail('auth_failed');
  }
}

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

function localDateStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// My Day daily rollover: on a new day, unfinished items carry over (stay on My
// Day) while items completed on a previous day drop off, so the list stays
// trustworthy instead of accreting yesterday's checked-off tasks. Returns true
// if anything changed. (Uses server-local date; fine for a single user.)
function maybeRolloverMyDay() {
  const today = localDateStr();
  if (db.settings.lastRollover === today) return false;
  for (const t of db.tasks) {
    if (t.today && t.status === 'done') t.today = false;
  }
  db.settings.lastRollover = today;
  return true;
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

// ---------------------------------------------------------------- push notifications
/* Server-side reminder firing via the Expo Push API, so a task's ⏰ reminder
 * pings the phone even when the app is closed. Reminders are stored as local
 * wall-clock ("YYYY-MM-DDTHH:MM") with no offset, so we evaluate "now" in the
 * client-reported timezone (settings.tz). On-device local notifications in the
 * mobile app are the no-server fallback; this is the always-on path. */

function localNowInTz(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || undefined,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const g = (t) => parts.find((p) => p.type === t).value;
    let hh = g('hour'); if (hh === '24') hh = '00';
    return `${g('year')}-${g('month')}-${g('day')}T${hh}:${g('minute')}`;
  } catch (_) {
    return new Date().toISOString().slice(0, 16); // UTC fallback
  }
}

async function sendExpoPush(tokens, title, body, data) {
  const msgs = tokens
    .filter((t) => /^ExponentPushToken\[|^ExpoPushToken\[/.test(t))
    .map((to) => ({ to, title, body, sound: 'default', data: data || {} }));
  for (let i = 0; i < msgs.length; i += 100) {
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(msgs.slice(i, i + 100)),
      });
    } catch (err) { console.error('Expo push send failed:', err.message); }
  }
}

let reminderTimer = null;
async function fireDueReminders() {
  if (!db.pushTokens || !db.pushTokens.length) return;
  const nowLocal = localNowInTz(db.settings.tz);
  const due = db.tasks.filter((t) => t.status !== 'done' && t.remind && !t.remindedAt && t.remind <= nowLocal);
  if (!due.length) return;
  const tokens = db.pushTokens.map((p) => p.token);
  for (const t of due) {
    await sendExpoPush(tokens, '⏰ ' + t.title, t.due ? 'Due ' + t.due : 'Reminder', { taskId: t.id });
    t.remindedAt = now();
  }
  saveData();
}

// ---------------------------------------------------------------- API router

async function handleAPI(req, res, pathname, url) {
  const seg = pathname.split('/').filter(Boolean); // ['api', 'tasks', ':id', ...]
  const method = req.method;

  // ---- public auth endpoints (no session required)
  if (pathname === '/api/auth-info' && method === 'GET') {
    return sendJSON(res, 200, { hasPassword, hasGoogle });
  }
  if (pathname === '/api/login' && method === 'POST') {
    if (!hasPassword) return sendJSON(res, 400, { error: 'Password login is not enabled' });
    const ip = clientIP(req);
    const rec = rateState(ip);
    if (rec && rec.count >= MAX_ATTEMPTS) {
      const mins = Math.ceil((LOCK_MS - (Date.now() - rec.first)) / 60000);
      return sendJSON(res, 429, { error: `Too many attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` });
    }
    const body = await readBody(req);
    const a = Buffer.from(str(body.password));
    const b = Buffer.from(HELM_PASSWORD);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      const next = { count: (rec ? rec.count : 0) + 1, first: rec ? rec.first : Date.now() };
      attempts.set(ip, next);
      const remaining = Math.max(0, MAX_ATTEMPTS - next.count);
      return sendJSON(res, 403, {
        error: remaining > 0
          ? `Incorrect password — ${remaining} attempt${remaining > 1 ? 's' : ''} remaining`
          : 'Too many attempts. Try again later.',
      });
    }
    attempts.delete(ip);
    setSessionCookie(req, res, makeSession('pw'));
    return sendJSON(res, 200, { ok: true });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    clearSessionCookie(req, res);
    return sendJSON(res, 200, { ok: true });
  }
  if (pathname === '/api/auth/google' && method === 'GET') {
    return handleGoogleCallback(req, res, url);
  }

  // ---- quick-capture via standalone token (iOS Shortcuts etc.): create-only
  if (pathname === '/api/capture' && method === 'POST' && (isAuthed(req) || hasCaptureToken(req))) {
    const body = await readBody(req);
    const parsed = parseCapture(str(body.text), db.projects);
    if (!parsed.title) return sendJSON(res, 400, { error: 'Nothing to capture' });
    delete parsed._projName;
    const t = sanitizeTask(parsed);
    db.tasks.push(t);
    logActivity('task-created', `Added task "${t.title}"`, t.id);
    saveData();
    return sendJSON(res, 201, t);
  }

  // ---- everything past here requires a valid session
  if (!isAuthed(req)) return sendJSON(res, 401, { error: 'Authentication required' });

  // GET /api/state — everything the client needs
  if (pathname === '/api/state' && method === 'GET') {
    await maybeRefreshFromNeon();
    if (maybeRolloverMyDay()) saveData();
    const { openrouterKey, ...safeSettings } = db.settings;
    return sendJSON(res, 200, {
      projects: db.projects,
      tasks: db.tasks,
      activity: db.activity.slice(0, 100),
      settings: { ...safeSettings, hasKey: !!openrouterKey },
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
    if (body.tz !== undefined) s.tz = str(body.tz).slice(0, 64);
    saveData();
    const { openrouterKey, ...safe } = s;
    return sendJSON(res, 200, { ...safe, hasKey: !!openrouterKey });
  }

  // ---- push tokens (Expo) for server-fired reminders
  if (seg[1] === 'push' && method === 'POST') {
    const body = await readBody(req);
    const token = str(body.token).slice(0, 200);
    if (!token) return sendJSON(res, 400, { error: 'Missing push token' });
    db.pushTokens = db.pushTokens || [];
    if (seg[2] === 'register') {
      if (!db.pushTokens.some((p) => p.token === token)) {
        db.pushTokens.push({ token, platform: str(body.platform).slice(0, 20), addedAt: now() });
        saveData();
      }
      return sendJSON(res, 200, { ok: true });
    }
    if (seg[2] === 'unregister') {
      db.pushTokens = db.pushTokens.filter((p) => p.token !== token);
      saveData();
      return sendJSON(res, 200, { ok: true });
    }
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

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  // Liveness check for Railway/Render — must bypass auth (the probe has no session).
  if (pathname === '/api/health' && req.method === 'GET') return sendJSON(res, 200, { ok: true });
  try {
    if (pathname === '/auth/google') return handleGoogleStart(req, res);
    if (pathname.startsWith('/api/')) return await handleAPI(req, res, pathname, url);
    return serveStatic(req, res, pathname);
  } catch (err) {
    return sendJSON(res, 500, { error: err.message || 'Server error' });
  }
});

async function start() {
  loadDataLocal();

  // Fire due reminders as Expo push notifications every minute (no-op until a
  // device registers a push token).
  reminderTimer = setInterval(() => { fireDueReminders().catch(() => {}); }, 60000);
  setTimeout(() => { fireDueReminders().catch(() => {}); }, 5000);

  // Listen FIRST so the Railway/Render healthcheck passes immediately; connect to
  // Neon afterwards in the background. (If Neon was slow and we awaited it before
  // binding the port, the healthcheck would time out and the deploy would fail.)
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
      if (authEnabled) {
        const modes = [hasPassword && 'password', hasGoogle && 'Google'].filter(Boolean).join(' + ');
        console.log(`    Auth:     ON (${modes})`);
      } else {
        console.log('    Auth:     OFF — set HELM_PASSWORD (and/or GOOGLE_CLIENT_ID/SECRET) before exposing this server');
      }
      console.log(`    Local:    http://localhost:${PORT}`);
      lan.forEach((ip) => console.log(`    Network:  http://${ip}:${PORT}   ← open this on your iPhone (same Wi-Fi)`));
      console.log(`    Data:     ${DATA_FILE}${useNeon ? '  (+ Neon cloud sync — connecting…)' : ''}`);
      console.log('');
      resolve();
    });
  });

  if (useNeon) {
    try {
      await neonLoad();
      console.log('  ☁ Cloud sync: connected to Neon Postgres');
    } catch (err) {
      console.error('  ☁ Cloud sync FAILED, falling back to local file:', err.message);
    }
  }
}

if (require.main === module) start();

// Exposed for unit tests (node --test). Not part of the HTTP surface.
module.exports = {
  sanitizeTask, sanitizeProject, nextDue, maybeRolloverMyDay, localDateStr,
  makeSession, verifySession, mergeById, mergeRemote,
  _setDb: (d) => { db = d; },
  _getDb: () => db,
};
