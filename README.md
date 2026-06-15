# ⎈ Helm

A beautiful, fast project & task manager you run yourself.
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

## A note on security

Helm has no authentication — it's designed for your own machines on your
own network. Don't expose the port to the open internet; if you want remote
access, put it behind Tailscale/WireGuard or a reverse proxy with auth.
