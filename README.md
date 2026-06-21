# ⎈ Helm

A beautiful, fast, ADHD-friendly project & task manager you run yourself.
**Zero dependencies** — if you have Node.js, you have Helm.

Built for an IT manager juggling many things: gorgeous dashboard, instant
capture, multi-project tasks, kanban board, reminders, AI summaries via
OpenRouter, and a one-click strategic report for meetings with your boss.

---

## Quick start (Mac & Windows)

1. Install [Node.js](https://nodejs.org) (v18 or newer) if you don't have it.
2. Clone or download this repo.
3. Run:

   ```sh
   node server.js
   ```

4. Open **http://localhost:4321**. That's it — no `npm install`, no build step.

Your data lives in `data/helm.json` next to the server (human-readable JSON,
trivially easy to back up).

### Use it from your iPhone

1. Start Helm on a computer that's on the same Wi-Fi.
2. The terminal prints a `Network:` URL (e.g. `http://192.168.1.20:4321`) — open it in Safari on your phone.
3. Tap **Share → Add to Home Screen**. Helm installs as a full-screen app with its own icon.

### Capture from anywhere on iPhone (Shortcut)

Set `HELM_CAPTURE_TOKEN` to any random string, then make a one-action iOS
Shortcut so you can capture a task from the share sheet, the Home Screen, or
"Hey Siri" — no need to open the app:

1. **Shortcuts app → +** → add **Get Contents of URL**.
2. URL: `https://<your-helm-host>/api/capture`
3. Method: **POST**; Headers: `Content-Type: application/json`,
   `X-Helm-Token: <your token>`.
4. Request Body: **JSON** → key `text`, value: the Shortcut input (e.g. "Ask
   for Input" or the Share Sheet text).
5. Name it "Capture to Helm". Done — it accepts the full smart syntax
   (`Pay rent @Home #bills !high ^fri`).

The token only allows creating tasks, never reading your data.

### Run it on login (optional)

- **Mac:** `crontab -e` → `@reboot cd /path/to/helm && /usr/local/bin/node server.js`, or make a LaunchAgent.
- **Windows:** create a shortcut to `node server.js` in `shell:startup`, or use Task Scheduler.

---

## ☁ Optional cloud sync (Neon Postgres)

By default Helm is local-first. If you want the same data on multiple
computers (or to host Helm on a small cloud box so your iPhone reaches it
from anywhere), point it at a free [Neon](https://neon.tech) Postgres database:

```sh
# Mac / Linux
DATABASE_URL='postgres://user:pass@ep-xxxx.us-east-2.aws.neon.tech/neondb' node server.js

# Windows (PowerShell)
$env:DATABASE_URL='postgres://user:pass@ep-xxxx.us-east-2.aws.neon.tech/neondb'; node server.js
```

Helm stores its document in a `helm_store` table via Neon's HTTP SQL API
(still zero npm dependencies), keeps the local JSON file as a backup, and
re-pulls from the cloud when idle — so you can close your Mac, open your
Windows machine, and continue where you left off.

> Note: the database syncs **data**, not access. Your iPhone still connects
> to whichever computer is running `node server.js`. For access from
> anywhere, run Helm on an always-on machine (a $4 VPS, a NAS, an old PC)
> or use a tunnel like Tailscale — Helm works great over Tailscale.

---

## What's inside

- **Dashboard** — greeting, at-a-glance stats (overdue / due today / in
  progress / waiting / done this week), My Day focus list, stale-task
  radar ("untouched 14+ days"), project health cards with progress bars,
  live activity feed.
- **Quick capture** (`N` anywhere, or the big ＋) with smart syntax:
  `Renew SSL certs @Infra #security !high ^fri`
  — `@project`, `#tag`, `!critical/!high/!low`, `^today ^tomorrow ^fri ^eom ^2026-07-01`.
  Live chip preview as you type; add several tasks in a row without leaving the box.
- **My Day** — a deliberately small daily list (☀ on any task adds it),
  plus suggestions from high-priority / due-soon items, and a "done today" feel-good list.
- **Projects** — color, area, priority, target date, pinning, notes that
  autosave, drill-down with per-status task groups and an inline quick-add.
- **Tasks across projects** — a task can belong to *multiple* projects;
  filter and group the full task list by project, due date, tag, priority.
- **Board** — kanban (To do / In progress / Waiting on / Done) with drag &
  drop, per-project or global.
- **Reminders & alerts** — per-task ⏰ reminders, a 🔔 bell with overdue /
  due-today / upcoming / stale buckets, optional desktop notifications and a
  morning digest. Recurring tasks (daily / weekdays / weekly / biweekly /
  monthly) roll forward automatically when you check them off.
- **Tasks that grow up** — one click turns a snowballing task into a real
  project; its checklist items become tasks.
- **⎙ Strategic report** — the boss-meeting export: at-a-glance numbers,
  per-project status with in-progress / waiting / up-next / recently-completed.
  Copy as Markdown, download `.md`, or Print → PDF (print stylesheet included).
- **✨ AI (OpenRouter)** — add your key in Settings and get: "How's my week
  looking?" briefings, per-project summaries, and an executive-summary
  rewrite of your report. The key stays on the server, never in the browser.
- **Everything else** — global search (`/`), keyboard shortcuts (`N` capture,
  `P` project, `1–6` views), dark/light themes, full JSON backup & restore,
  installable PWA with offline shell, undo on completion, confetti. 🎉

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `⌘/Ctrl + K` | Command palette (search + jump + act anywhere) |
| `N` or `Q` | Quick capture |
| `P` | New project |
| `/` | Search |
| `1–6` | Dashboard · My Day · Projects · Tasks · Board · Report |
| `Esc` | Close modal / clear search |
| `⌘/Ctrl + Enter` | Save in editors |

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `4321` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address (already LAN-accessible) |
| `DATABASE_URL` | – | Optional Neon Postgres cloud sync |
| `HELM_PASSWORD` | – | Enables password login (the "Unlock" screen) |
| `GOOGLE_CLIENT_ID` | – | Enables "Sign in with Google" (with the secret) |
| `GOOGLE_CLIENT_SECRET` | – | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | auto | Override the OAuth callback URL (defaults to `<origin>/api/auth/google`) |
| `HELM_ALLOWED_EMAILS` | – | Comma-separated allowlist for Google sign-in (empty = any verified Google account) |
| `SESSION_SECRET` | derived | HMAC key for session cookies. Set a stable value to keep sessions across restarts |
| `HELM_CAPTURE_TOKEN` | – | Standalone token that authorizes quick-capture only (for iOS Shortcuts / automations) |

## A note on security

Helm supports **password and/or Google sign-in** (see the env vars above):

- **Neither set → the server runs OPEN.** That's fine for localhost or a trusted
  LAN, but don't expose an open instance to the internet. Put it behind
  Tailscale/WireGuard, or set a password.
- **`HELM_PASSWORD` set →** every API call requires a session; visitors get an
  "Unlock" screen. Sessions are stateless signed cookies (HMAC, HttpOnly,
  SameSite=Lax, Secure over HTTPS) valid for 30 days. Failed logins are
  rate-limited (5 attempts, then a 15-minute lockout per IP).
- **`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` set →** a "Sign in with Google"
  button appears. Register `https://<your-host>/api/auth/google` as an authorized
  redirect URI in the Google Cloud console, and (recommended) restrict access
  with `HELM_ALLOWED_EMAILS`.

> The hosted instance on Railway runs with auth enabled — this repo's `server.js`
> reproduces that behavior. The mobile app authenticates against the same
> password/session flow.
