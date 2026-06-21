/* ============================================================ Helm app */
'use strict';

// ------------------------------------------------------------ state & api

let S = { projects: [], tasks: [], activity: [], settings: {} };
let route = { name: 'dashboard', param: null };
let searchQuery = '';
let taskFilters = { status: 'open', project: 'all', tag: 'all', priority: 'all', group: 'project' };
let boardProject = 'all';

async function api(path, method = 'GET', body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 401) {
    requireReauth();
    const e = new Error('Session expired — please log in');
    e.isAuthError = true;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadState() {
  S = await api('/api/state');
  applyTheme();
  // Report our timezone so the server fires reminders at the right wall-clock.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && S.settings.tz !== tz) S.settings = await api('/api/settings', 'PATCH', { tz });
  } catch (_) { /* non-fatal */ }
}

// ------------------------------------------------------------ utilities

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const PRIO_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIO_LABEL = { critical: '🔴 Critical', high: '🟠 High', medium: '🔵 Medium', low: '⚪ Low' };
const STATUS_LABEL = { todo: 'To do', doing: 'In progress', waiting: 'Waiting on', done: 'Done' };
const PSTATUS_LABEL = { active: 'Active', planning: 'Planning', 'on-hold': 'On hold', done: 'Done', archived: 'Archived' };
const COLORS = ['#6d6ffb', '#9b6dfb', '#f06292', '#ef5350', '#ffa726', '#ffd54f', '#66bb6a', '#26c6da', '#42a5f5', '#8d6e63'];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, n) {
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const a = new Date(todayStr() + 'T12:00:00'), b = new Date(dateStr + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}
function fmtDue(dateStr) {
  const n = daysUntil(dateStr);
  if (n === null) return '';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < 0) return `${-n}d overdue`;
  if (n < 7) return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function dueClass(dateStr, done) {
  if (done) return '';
  const n = daysUntil(dateStr);
  if (n === null) return '';
  if (n < 0) return 'due-overdue';
  if (n === 0) return 'due-today';
  if (n <= 3) return 'due-soon';
  return '';
}
function relTime(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function projById(id) { return S.projects.find((p) => p.id === id); }
function openTasks(filterFn) {
  return S.tasks.filter((t) => t.status !== 'done' && (!filterFn || filterFn(t)));
}
function projectTasks(pid) { return S.tasks.filter((t) => t.projectIds.includes(pid)); }
function projectProgress(pid) {
  const ts = projectTasks(pid);
  if (!ts.length) return null;
  return Math.round((ts.filter((t) => t.status === 'done').length / ts.length) * 100);
}
function taskSort(a, b) {
  const so = { doing: 0, todo: 1, waiting: 2, done: 3 };
  if (so[a.status] !== so[b.status]) return so[a.status] - so[b.status];
  const ad = a.due || '9999', bd = b.due || '9999';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority];
}

// ------------------------------------------------------------ toasts

function toast(msg, kind = '', undoFn) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (undoFn) {
    const b = document.createElement('button');
    b.textContent = 'Undo';
    b.onclick = () => { undoFn(); el.remove(); };
    el.appendChild(b);
  }
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; setTimeout(() => el.remove(), 400); }, undoFn ? 5200 : 2600);
}

// ------------------------------------------------------------ modal scaffolding

function openModal(html, { wide = false } = {}) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-overlay"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`;
  const overlay = $('.modal-overlay', root);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
  const first = $('input, textarea, select', root);
  if (first) setTimeout(() => first.focus(), 30);
  return $('.modal', root);
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function confirmModal(title, body, action, danger = true) {
  const m = openModal(`
    <div class="modal-head"><h2>${esc(title)}</h2></div>
    <div class="modal-body"><p style="color:var(--text-dim)">${esc(body)}</p></div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-x="cancel">Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="ok">${danger ? 'Delete' : 'Confirm'}</button>
    </div>`);
  $('[data-x=cancel]', m).onclick = closeModal;
  $('[data-x=ok]', m).onclick = async () => { closeModal(); await action(); };
}

// ------------------------------------------------------------ quick capture parsing
// Syntax:  Fix the VPN @Infra #network !high ^fri  *also supports ^today ^tomorrow ^2026-07-01

// Parsing lives in the shared, unit-tested HelmCapture module (js/capture.js).
function parseCapture(text) {
  return HelmCapture.parseCapture(text, S.projects);
}

function captureChips(p) {
  const chips = [];
  if (p._projName) chips.push(`<span class="chip" style="color:var(--accent)">▣ ${esc(p._projName)}</span>`);
  p.tags.forEach((t) => chips.push(`<span class="chip">#${esc(t)}</span>`));
  if (p.priority !== 'medium') chips.push(`<span class="chip badge-prio-${p.priority}">${PRIO_LABEL[p.priority]}</span>`);
  if (p.due) chips.push(`<span class="chip ${dueClass(p.due)}">📅 ${fmtDue(p.due)}</span>`);
  if (p.today) chips.push(`<span class="chip" style="color:var(--amber)">☀ My Day</span>`);
  return chips.join('');
}

function captureModal(defaults = {}) {
  const m = openModal(`
    <div class="modal-head"><h2>Quick capture</h2></div>
    <div class="modal-body">
      <input class="capture-input" id="cap-in" placeholder="What needs doing?  e.g.  Renew SSL certs @Infra #security !high ^fri" autocomplete="off">
      <div class="capture-preview" id="cap-prev"></div>
      <p class="hint"><b>@</b>project &nbsp; <b>#</b>tag &nbsp; <b>!</b>high/critical/low &nbsp; <b>^</b>today / tomorrow / fri / 2026-07-01 / eom — then press <kbd>Enter</kbd>. Add several in a row; <kbd>Esc</kbd> closes.</p>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-x="close">Done</button>
      <button class="btn btn-primary" data-x="add">Add task</button>
    </div>`);
  const input = $('#cap-in', m);
  const prev = $('#cap-prev', m);
  input.addEventListener('input', () => { prev.innerHTML = captureChips(parseCapture(input.value)); });
  async function add() {
    const p = parseCapture(input.value.trim());
    if (!p.title) return;
    if (defaults.projectIds) p.projectIds = [...new Set([...p.projectIds, ...defaults.projectIds])];
    if (defaults.today) p.today = true;
    const t = await api('/api/tasks', 'POST', p);
    S.tasks.push(t);
    input.value = ''; prev.innerHTML = '';
    toast(`Added “${t.title}”`, 'ok');
    render();
    input.focus();
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  $('[data-x=add]', m).onclick = add;
  $('[data-x=close]', m).onclick = closeModal;
}

// ------------------------------------------------------------ task mutations

async function patchTask(id, patch) {
  const t = await api(`/api/tasks/${id}`, 'PATCH', patch);
  const i = S.tasks.findIndex((x) => x.id === id);
  if (i >= 0) S.tasks[i] = t;
  return t;
}

function confettiAt(x, y) {
  const colors = ['#6d6ffb', '#9b6dfb', '#34d399', '#fbbf24', '#f06292', '#60a5fa'];
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('span');
    p.className = 'confetti';
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.background = colors[i % colors.length];
    const ang = Math.random() * Math.PI * 2, dist = 40 + Math.random() * 70;
    p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(ang) * dist - 30 + 'px');
    p.style.setProperty('--rot', (Math.random() * 540 - 270) + 'deg');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }
}

async function toggleTask(id, sourceEl) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return;
  const wasDone = t.status === 'done';
  const prevStatus = t.status;
  let burst = null;
  if (!wasDone && sourceEl) {
    const r = sourceEl.getBoundingClientRect();
    burst = [r.left + r.width / 2, r.top + r.height / 2];
  }
  const updated = await patchTask(id, { status: wasDone ? 'todo' : 'done' });
  render();
  if (burst) confettiAt(burst[0], burst[1]);
  if (!wasDone) {
    if (updated.status === 'done') {
      toast(`✓ Completed “${updated.title}”`, 'ok', async () => { await patchTask(id, { status: prevStatus }); render(); });
    } else {
      toast(`✓ Done — repeats, next due ${fmtDue(updated.due)}`, 'ok');
    }
  }
}

async function deleteTask(id) {
  const t = S.tasks.find((x) => x.id === id);
  confirmModal('Delete task?', `“${t.title}” will be permanently deleted.`, async () => {
    await api(`/api/tasks/${id}`, 'DELETE');
    S.tasks = S.tasks.filter((x) => x.id !== id);
    render();
    toast('Task deleted');
  });
}

// ------------------------------------------------------------ task row component

function taskRowHTML(t, { showProject = true, draggable = false } = {}) {
  const projects = t.projectIds.map(projById).filter(Boolean);
  const subDone = t.subtasks.filter((s) => s.done).length;
  const meta = [];
  if (showProject && projects.length) {
    meta.push(projects.map((p) => `<span class="t-proj" style="--pc:${esc(p.color)}" data-goto-proj="${p.id}">▣ ${esc(p.name)}</span>`).join(' '));
  }
  if (t.status === 'doing') meta.push(`<span class="chip badge-status-doing">In progress</span>`);
  if (t.status === 'waiting') meta.push(`<span class="chip badge-status-waiting">Waiting</span>`);
  if (t.due) meta.push(`<span class="${dueClass(t.due, t.status === 'done')}">📅 ${fmtDue(t.due)}</span>`);
  if (t.priority !== 'medium') meta.push(`<span class="chip badge-prio-${t.priority}">${PRIO_LABEL[t.priority]}</span>`);
  if (t.repeat && t.repeat !== 'none') meta.push(`<span>↻ ${t.repeat}</span>`);
  if (t.remind && t.status !== 'done') meta.push(`<span title="Reminder set">⏰ ${new Date(t.remind).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>`);
  if (t.subtasks.length) meta.push(`<span class="t-sub-pill">☑ ${subDone}/${t.subtasks.length}</span>`);
  t.tags.forEach((tag) => meta.push(`<span class="chip" data-goto-tag="${esc(tag)}">#${esc(tag)}</span>`));
  if (t.notes) meta.push(`<span title="Has notes">≡</span>`);

  return `
  <div class="task-row ${t.status === 'done' ? 'done' : ''}" data-task="${t.id}" ${draggable ? 'draggable="true"' : ''}>
    <button class="t-check ${t.status === 'done' ? 'checked' : ''}" data-toggle="${t.id}" title="Mark ${t.status === 'done' ? 'not done' : 'done'}">✓</button>
    <div class="t-body">
      <div class="t-title">${esc(t.title)}</div>
      ${meta.length ? `<div class="t-meta">${meta.join('')}</div>` : ''}
    </div>
    <div class="t-actions">
      <button class="t-act" data-today="${t.id}" title="${t.today ? 'Remove from My Day' : 'Add to My Day'}" style="${t.today ? 'color:var(--amber)' : ''}">☀</button>
      <button class="t-act" data-edit="${t.id}" title="Edit">✎</button>
      <button class="t-act" data-del="${t.id}" title="Delete">🗑</button>
    </div>
  </div>`;
}

function bindTaskRows(container) {
  $$('[data-toggle]', container).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); toggleTask(b.dataset.toggle, b); }; });
  $$('[data-edit]', container).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); taskModal(b.dataset.edit); }; });
  $$('[data-del]', container).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); deleteTask(b.dataset.del); }; });
  $$('[data-today]', container).forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const t = S.tasks.find((x) => x.id === b.dataset.today);
      await patchTask(t.id, { today: !t.today });
      toast(t.today ? '☀ Added to My Day' : 'Removed from My Day');
      render();
    };
  });
  $$('[data-goto-proj]', container).forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); location.hash = `#/project/${el.dataset.gotoProj}`; };
  });
  $$('[data-goto-tag]', container).forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); taskFilters.tag = el.dataset.gotoTag; location.hash = '#/tasks'; render(); };
  });
  $$('.task-row', container).forEach((row) => {
    row.addEventListener('click', () => taskModal(row.dataset.task));
  });
}

// ------------------------------------------------------------ task editor modal

function taskModal(taskId, defaults = {}) {
  const t = taskId ? S.tasks.find((x) => x.id === taskId) : null;
  const d = t || {
    title: '', notes: '', status: 'todo', priority: 'medium', due: defaults.due || null, remind: null,
    projectIds: defaults.projectIds || [], tags: [], subtasks: [], repeat: 'none', today: !!defaults.today,
  };
  let subtasks = d.subtasks.map((s) => ({ ...s }));
  let projectIds = [...d.projectIds];

  const projOpts = S.projects.filter((p) => p.status !== 'archived' || projectIds.includes(p.id));
  const m = openModal(`
    <div class="modal-head"><h2>${t ? 'Edit task' : 'New task'}</h2></div>
    <div class="modal-body">
      <div class="field"><input id="tm-title" placeholder="Task title" value="${esc(d.title)}"></div>
      <div class="field-row-3">
        <div class="field"><label>Status</label>
          <select id="tm-status">${['todo', 'doing', 'waiting', 'done'].map((s) => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Priority</label>
          <select id="tm-prio">${['critical', 'high', 'medium', 'low'].map((p) => `<option value="${p}" ${d.priority === p ? 'selected' : ''}>${PRIO_LABEL[p]}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Due date</label><input type="date" id="tm-due" value="${d.due || ''}"></div>
      </div>
      <div class="field-row-3">
        <div class="field"><label>Repeat</label>
          <select id="tm-repeat">${['none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly'].map((r) => `<option value="${r}" ${d.repeat === r ? 'selected' : ''}>${r === 'none' ? 'Does not repeat' : r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>⏰ Remind me</label><input type="datetime-local" id="tm-remind" value="${d.remind || ''}"></div>
        <div class="field"><label>Tags (comma separated)</label><input id="tm-tags" value="${esc(d.tags.join(', '))}" placeholder="security, q3…"></div>
      </div>
      <div class="field"><label>Projects ${projectIds.length > 1 ? '<span class="hint">(multi-project task)</span>' : ''}</label>
        <div class="multi-select" id="tm-projs">
          ${projOpts.map((p) => `<button type="button" class="ms-opt ${projectIds.includes(p.id) ? 'on' : ''}" data-pid="${p.id}" style="--pc:${esc(p.color)}">${esc(p.name)}</button>`).join('') || '<span class="hint">No projects yet — create one from the Projects page.</span>'}
        </div>
      </div>
      <div class="field"><label>Checklist</label>
        <div class="subtask-list" id="tm-subs"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="tm-addsub" style="align-self:flex-start">＋ Add checklist item</button>
      </div>
      <div class="field"><label>Notes</label><textarea id="tm-notes" rows="3" placeholder="Context, links, next steps…">${esc(d.notes)}</textarea></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--text-dim);cursor:pointer">
        <input type="checkbox" id="tm-today" ${d.today ? 'checked' : ''}> ☀ Put on My Day
      </label>
    </div>
    <div class="modal-foot">
      ${t ? '<button class="btn btn-ghost btn-danger left" data-x="del">Delete</button>' : ''}
      ${t ? '<button class="btn btn-ghost" data-x="promote" title="This task grew up? Turn it into a project — checklist items become tasks.">⇪ Make project</button>' : ''}
      <button class="btn btn-ghost" data-x="cancel">Cancel</button>
      <button class="btn btn-primary" data-x="save">${t ? 'Save changes' : 'Add task'}</button>
    </div>`, { wide: true });

  function renderSubs() {
    $('#tm-subs', m).innerHTML = subtasks.map((s, i) => `
      <div class="subtask-row">
        <button type="button" class="t-check ${s.done ? 'checked' : ''}" data-si="${i}">✓</button>
        <input type="text" value="${esc(s.title)}" data-st="${i}" placeholder="Checklist item">
        <button type="button" class="t-act" data-sx="${i}">✕</button>
      </div>`).join('');
    $$('[data-si]', m).forEach((b) => { b.onclick = () => { subtasks[b.dataset.si].done = !subtasks[b.dataset.si].done; renderSubs(); }; });
    $$('[data-st]', m).forEach((inp) => { inp.oninput = () => { subtasks[inp.dataset.st].title = inp.value; }; });
    $$('[data-sx]', m).forEach((b) => { b.onclick = () => { subtasks.splice(b.dataset.sx, 1); renderSubs(); }; });
  }
  renderSubs();
  $('#tm-addsub', m).onclick = () => {
    subtasks.push({ id: '', title: '', done: false });
    renderSubs();
    const inputs = $$('[data-st]', m); inputs[inputs.length - 1].focus();
  };
  $$('#tm-projs .ms-opt', m).forEach((b) => {
    b.onclick = () => {
      const pid = b.dataset.pid;
      if (projectIds.includes(pid)) projectIds = projectIds.filter((x) => x !== pid);
      else projectIds.push(pid);
      b.classList.toggle('on');
    };
  });

  async function save() {
    const payload = {
      title: $('#tm-title', m).value.trim(),
      status: $('#tm-status', m).value,
      priority: $('#tm-prio', m).value,
      due: $('#tm-due', m).value || null,
      remind: $('#tm-remind', m).value || null,
      repeat: $('#tm-repeat', m).value,
      tags: $('#tm-tags', m).value.split(',').map((x) => x.trim()).filter(Boolean),
      projectIds,
      subtasks: subtasks.filter((s) => s.title.trim()),
      notes: $('#tm-notes', m).value,
      today: $('#tm-today', m).checked,
    };
    if (!payload.title) { $('#tm-title', m).focus(); return; }
    if (t) {
      await patchTask(t.id, payload);
      toast('Task updated', 'ok');
    } else {
      const created = await api('/api/tasks', 'POST', payload);
      S.tasks.push(created);
      toast(`Added “${created.title}”`, 'ok');
    }
    closeModal();
    render();
  }
  $('[data-x=save]', m).onclick = save;
  $('[data-x=cancel]', m).onclick = closeModal;
  if (t) $('[data-x=del]', m).onclick = () => { closeModal(); deleteTask(t.id); };
  if (t) $('[data-x=promote]', m).onclick = () => {
    closeModal();
    confirmModal('Turn this task into a project?',
      `“${t.title}” becomes a project, its ${t.subtasks.length ? `${t.subtasks.length} checklist item${t.subtasks.length > 1 ? 's' : ''} become real tasks` : 'notes carry over'}, and the original task is removed.`,
      async () => {
        const proj = await api(`/api/tasks/${t.id}/promote`, 'POST', {});
        S.projects.push(proj);
        S.tasks = S.tasks.filter((x) => x.id !== t.id);
        await loadState(); // pick up the newly created child tasks
        toast(`⇪ “${proj.name}” is now a project`, 'ok');
        location.hash = `#/project/${proj.id}`;
        render();
      }, false);
  };
  m.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
  });
}

// ------------------------------------------------------------ project editor modal

function projectModal(projectId) {
  const p = projectId ? projById(projectId) : null;
  let color = p ? p.color : COLORS[S.projects.length % COLORS.length];
  const m = openModal(`
    <div class="modal-head"><h2>${p ? 'Edit project' : 'New project'}</h2></div>
    <div class="modal-body">
      <div class="field"><input id="pm-name" placeholder="Project name" value="${esc(p ? p.name : '')}"></div>
      <div class="field"><label>Description</label><textarea id="pm-desc" rows="2" placeholder="What is this project about? (shows on cards & reports)">${esc(p ? p.description : '')}</textarea></div>
      <div class="field-row-3">
        <div class="field"><label>Status</label>
          <select id="pm-status">${['active', 'planning', 'on-hold', 'done', 'archived'].map((s) => `<option value="${s}" ${(p ? p.status : 'active') === s ? 'selected' : ''}>${PSTATUS_LABEL[s]}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Priority</label>
          <select id="pm-prio">${['critical', 'high', 'medium', 'low'].map((x) => `<option value="${x}" ${(p ? p.priority : 'medium') === x ? 'selected' : ''}>${PRIO_LABEL[x]}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Target date</label><input type="date" id="pm-due" value="${p && p.due ? p.due : ''}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Area / category</label><input id="pm-area" value="${esc(p ? p.area : '')}" placeholder="Infrastructure, Security, Helpdesk…"></div>
        <div class="field"><label>Color</label>
          <div class="color-swatches" id="pm-colors">
            ${COLORS.map((c) => `<button type="button" class="swatch ${c === color ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}
          </div>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--text-dim);cursor:pointer">
        <input type="checkbox" id="pm-pin" ${p && p.pinned ? 'checked' : ''}> 📌 Pin to top of dashboard
      </label>
    </div>
    <div class="modal-foot">
      ${p ? '<button class="btn btn-ghost btn-danger left" data-x="del">Delete</button>' : ''}
      <button class="btn btn-ghost" data-x="cancel">Cancel</button>
      <button class="btn btn-primary" data-x="save">${p ? 'Save changes' : 'Create project'}</button>
    </div>`);

  $$('#pm-colors .swatch', m).forEach((b) => {
    b.onclick = () => { color = b.dataset.c; $$('#pm-colors .swatch', m).forEach((x) => x.classList.toggle('on', x === b)); };
  });
  async function save() {
    const payload = {
      name: $('#pm-name', m).value.trim(),
      description: $('#pm-desc', m).value,
      status: $('#pm-status', m).value,
      priority: $('#pm-prio', m).value,
      due: $('#pm-due', m).value || null,
      area: $('#pm-area', m).value.trim(),
      color,
      pinned: $('#pm-pin', m).checked,
    };
    if (!payload.name) { $('#pm-name', m).focus(); return; }
    if (p) {
      const upd = await api(`/api/projects/${p.id}`, 'PATCH', payload);
      Object.assign(p, upd);
      toast('Project updated', 'ok');
    } else {
      const created = await api('/api/projects', 'POST', payload);
      S.projects.push(created);
      toast(`Project “${created.name}” created`, 'ok');
      closeModal(); render();
      location.hash = `#/project/${created.id}`;
      return;
    }
    closeModal(); render();
  }
  $('[data-x=save]', m).onclick = save;
  $('[data-x=cancel]', m).onclick = closeModal;
  if (p) {
    $('[data-x=del]', m).onclick = () => {
      closeModal();
      confirmModal('Delete project?', `“${p.name}” will be deleted. Its tasks are kept (they just lose this project label).`, async () => {
        await api(`/api/projects/${p.id}`, 'DELETE');
        S.projects = S.projects.filter((x) => x.id !== p.id);
        S.tasks.forEach((t) => { t.projectIds = t.projectIds.filter((id) => id !== p.id); });
        location.hash = '#/projects';
        render();
        toast('Project deleted');
      });
    };
  }
  m.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); });
}

// ------------------------------------------------------------ AI helpers

async function aiModal(title, prompt, system) {
  const m = openModal(`
    <div class="modal-head"><h2>✨ ${esc(title)}</h2></div>
    <div class="modal-body">
      <div class="ai-loading" id="ai-load"><div class="spinner"></div> Thinking…</div>
      <div class="ai-out" id="ai-out" style="display:none"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-x="close">Close</button>
      <button class="btn" data-x="copy" disabled>Copy</button>
    </div>`, { wide: true });
  $('[data-x=close]', m).onclick = closeModal;
  try {
    const { text } = await api('/api/ai', 'POST', { prompt, system });
    if (!$('#ai-out')) return; // modal was closed
    $('#ai-load').style.display = 'none';
    const out = $('#ai-out');
    out.style.display = 'block';
    out.textContent = text;
    const copyBtn = $('[data-x=copy]', m);
    copyBtn.disabled = false;
    copyBtn.onclick = () => { navigator.clipboard.writeText(text); toast('Copied to clipboard', 'ok'); };
  } catch (err) {
    if (!$('#ai-load')) return;
    $('#ai-load').innerHTML = `<span style="color:var(--red)">⚠ ${esc(err.message)}</span>`;
  }
}

function taskLine(t) {
  const bits = [t.title];
  if (t.status === 'doing') bits.push('(in progress)');
  if (t.status === 'waiting') bits.push('(waiting/blocked)');
  if (t.due) bits.push(`due ${t.due}${daysUntil(t.due) < 0 ? ' OVERDUE' : ''}`);
  if (t.priority !== 'medium') bits.push(`priority: ${t.priority}`);
  if (t.subtasks.length) bits.push(`checklist ${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`);
  return bits.join(' — ');
}

function workloadContext({ projectId = null, includeDone = true } = {}) {
  const lines = [`Today's date: ${todayStr()}`, ''];
  const projs = projectId ? [projById(projectId)] : S.projects.filter((p) => !['archived'].includes(p.status));
  for (const p of projs) {
    if (!p) continue;
    const ts = projectTasks(p.id);
    const pct = projectProgress(p.id);
    lines.push(`PROJECT: ${p.name} [status: ${PSTATUS_LABEL[p.status]}, priority: ${p.priority}${p.due ? `, target date: ${p.due}` : ''}${pct !== null ? `, ${pct}% of tasks complete` : ''}]`);
    if (p.description) lines.push(`  About: ${p.description}`);
    if (p.notes) lines.push(`  Notes: ${p.notes.slice(0, 600)}`);
    const open = ts.filter((t) => t.status !== 'done').sort(taskSort);
    const done = ts.filter((t) => t.status === 'done' && t.completedAt && daysUntil(t.completedAt.slice(0, 10)) >= -14);
    open.forEach((t) => lines.push(`  - OPEN: ${taskLine(t)}`));
    if (includeDone) done.forEach((t) => lines.push(`  - RECENTLY DONE: ${t.title}`));
    if (!ts.length) lines.push('  (no tasks yet)');
    lines.push('');
  }
  const loose = S.tasks.filter((t) => !t.projectIds.length && t.status !== 'done');
  if (!projectId && loose.length) {
    lines.push('UNASSIGNED TASKS (no project):');
    loose.forEach((t) => lines.push(`  - ${taskLine(t)}`));
  }
  return lines.join('\n');
}

// ------------------------------------------------------------ views

function setView(html) {
  const v = $('#view');
  v.innerHTML = html;
  // Re-trigger the CSS entry animation on each view change.
  v.style.animation = 'none';
  v.offsetHeight; // force reflow
  v.style.animation = '';
  // Scroll back to top on every navigation.
  v.scrollTo ? v.scrollTo(0, 0) : (v.scrollTop = 0);
}

function navHighlight() {
  $$('#nav a, #mobilenav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route.name || (route.name === 'project' && a.dataset.route === 'projects'));
  });
  $('#count-today').textContent = myDayTasks().filter((t) => t.status !== 'done').length || '';
  $('#count-projects').textContent = S.projects.filter((p) => ['active', 'planning'].includes(p.status)).length || '';
  $('#count-tasks').textContent = S.tasks.filter((t) => t.status !== 'done').length || '';
  updateBell();
}

function myDayTasks() {
  return S.tasks.filter((t) => t.today || (t.status !== 'done' && t.due && daysUntil(t.due) <= 0));
}

// ---- dashboard

function viewDashboard() {
  const open = S.tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due && daysUntil(t.due) < 0);
  const dueToday = open.filter((t) => t.due && daysUntil(t.due) === 0);
  const doing = open.filter((t) => t.status === 'doing');
  const waiting = open.filter((t) => t.status === 'waiting');
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const doneWeek = S.tasks.filter((t) => t.status === 'done' && t.completedAt && t.completedAt > weekAgo);
  const stale = open.filter((t) => (Date.now() - new Date(t.updatedAt)) / 86400000 > 14);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = S.settings.userName ? `, ${S.settings.userName.split(' ')[0]}` : '';
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const focus = myDayTasks().filter((t) => t.status !== 'done').sort(taskSort).slice(0, 8);
  const projs = S.projects
    .filter((p) => ['active', 'planning', 'on-hold'].includes(p.status))
    .sort((a, b) => (b.pinned - a.pinned) || PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] || a.name.localeCompare(b.name));

  setView(`
    <div class="greeting">
      <h1>${greet}${esc(name)} 👋</h1>
      <p>${dateStr} — ${overdue.length ? `<b style="color:var(--red)">${overdue.length} overdue</b>, ` : ''}${dueToday.length} due today, ${doing.length} in progress.</p>
    </div>
    <div class="stat-grid">
      <div class="stat ${overdue.length ? 'warn' : ''}" data-go="#/tasks" data-f="overdue"><div class="num">${overdue.length}</div><div class="lbl">Overdue</div></div>
      <div class="stat amber" data-go="#/today"><div class="num">${dueToday.length}</div><div class="lbl">Due today</div></div>
      <div class="stat info" data-go="#/tasks" data-f="doing"><div class="num">${doing.length}</div><div class="lbl">In progress</div></div>
      <div class="stat" data-go="#/tasks" data-f="waiting"><div class="num">${waiting.length}</div><div class="lbl">Waiting on</div></div>
      <div class="stat ok" data-go="#/tasks" data-f="done"><div class="num">${doneWeek.length}</div><div class="lbl">Done this week</div></div>
    </div>

    <div class="dash-cols" style="margin-top:20px">
      <div>
        <div class="section-title">☀ My Day ${focus.length ? `<a href="#/today" style="font-weight:600;text-transform:none;letter-spacing:0">view all →</a>` : ''}</div>
        <div class="task-list" id="dash-focus">
          ${focus.map((t) => taskRowHTML(t)).join('') || `<div class="empty"><span class="big">☀</span>Nothing on your day yet. Tap the ☀ on any task, or hit <b>Quick capture</b>.</div>`}
        </div>

        ${stale.length ? `
        <div class="section-title" style="color:var(--amber)">⚠ Needs attention <span class="hint" style="text-transform:none;letter-spacing:0">untouched for 14+ days</span></div>
        <div class="task-list" id="dash-stale">${stale.sort(taskSort).slice(0, 5).map((t) => taskRowHTML(t)).join('')}</div>` : ''}

        <div class="section-title">▣ Projects <button class="btn btn-ghost btn-sm" id="dash-newproj" style="text-transform:none;letter-spacing:0">＋ New</button></div>
        <div class="project-grid">
          ${projs.map(projectCardHTML).join('') || `<div class="empty" style="grid-column:1/-1"><span class="big">▣</span>No projects yet. Create your first one!</div>`}
        </div>
      </div>
      <div>
        <div class="section-title">Recent activity</div>
        <div class="card" style="padding:8px 16px">
          ${S.activity.slice(0, 14).map((a) => `
            <div class="activity-item"><span class="when">${relTime(a.ts)}</span><span class="what">${esc(a.text)}</span></div>
          `).join('') || '<div class="hint" style="padding:12px 0">Activity will show up here.</div>'}
        </div>
        ${S.settings.hasKey ? `<button class="btn btn-block" id="dash-ai" style="margin-top:14px">✨ AI: How's my week looking?</button>` : ''}
      </div>
    </div>
  `);

  $$('.stat', $('#view')).forEach((s) => {
    s.onclick = () => {
      if (s.dataset.f) taskFilters.status = s.dataset.f;
      location.hash = s.dataset.go;
    };
  });
  bindTaskRows($('#view'));
  bindProjectCards($('#view'));
  $('#dash-newproj').onclick = () => projectModal();
  const aiBtn = $('#dash-ai');
  if (aiBtn) aiBtn.onclick = () => aiModal(
    "How's my week looking?",
    `Here is my current workload as an IT manager:\n\n${workloadContext()}\n\nGive me a short, energizing briefing: 1) the 3 things that most need my attention today and why, 2) anything overdue or at risk, 3) anything that's been sitting stale, 4) one suggestion to lighten the load (delegate / defer / delete). Be concise and practical. I have ADHD, so keep it scannable with short bullets.`,
    'You are a sharp, friendly chief-of-staff for an IT manager. Be brief, concrete and kind.'
  );
}

function projectCardHTML(p) {
  const ts = projectTasks(p.id);
  const open = ts.filter((t) => t.status !== 'done');
  const pct = projectProgress(p.id);
  const next = open.sort(taskSort)[0];
  return `
  <div class="project-card" data-proj="${p.id}" style="--pc:${esc(p.color)}">
    <h3>${p.pinned ? '<span class="pin">📌</span>' : ''}${esc(p.name)}</h3>
    ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ''}
    <div class="meta">
      <span class="chip badge-status-${p.status}">${PSTATUS_LABEL[p.status]}</span>
      ${p.priority !== 'medium' ? `<span class="chip badge-prio-${p.priority}">${PRIO_LABEL[p.priority]}</span>` : ''}
      ${p.area ? `<span class="chip">${esc(p.area)}</span>` : ''}
      ${p.due ? `<span class="chip ${dueClass(p.due, p.status === 'done')}">🎯 ${fmtDue(p.due)}</span>` : ''}
      <span class="chip">${open.length} open</span>
    </div>
    ${next ? `<div class="hint" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Next: ${esc(next.title)}</div>` : ''}
    ${pct !== null ? `<div class="prog-row"><div class="progress"><i style="width:${pct}%"></i></div><span class="pct">${pct}%</span></div>` : ''}
  </div>`;
}
function bindProjectCards(container) {
  $$('[data-proj]', container).forEach((c) => { c.onclick = () => { location.hash = `#/project/${c.dataset.proj}`; }; });
}

// ---- my day

function viewToday() {
  const items = myDayTasks().sort(taskSort);
  const open = items.filter((t) => t.status !== 'done');
  const doneToday = S.tasks.filter((t) => t.status === 'done' && t.completedAt && t.completedAt.slice(0, 10) === todayStr());
  const suggestions = openTasks((t) => !items.includes(t))
    .filter((t) => PRIO_ORDER[t.priority] <= 1 || (t.due && daysUntil(t.due) <= 3))
    .sort(taskSort).slice(0, 5);

  setView(`
    <div class="page-head">
      <div><h1>☀ My Day</h1><p class="page-sub">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${open.length} to go · ${doneToday.length} done</p></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="td-add">＋ Add to My Day</button>
    </div>
    <div class="task-list">${open.map((t) => taskRowHTML(t)).join('') || `<div class="empty"><span class="big">🎉</span>Clear runway. Add something with ＋, or enjoy the calm.</div>`}</div>
    ${suggestions.length ? `
      <div class="section-title">Suggested (high priority / due soon)</div>
      <div class="task-list">${suggestions.map((t) => taskRowHTML(t)).join('')}</div>` : ''}
    ${doneToday.length ? `
      <div class="section-title" style="color:var(--green)">✓ Done today</div>
      <div class="task-list">${doneToday.map((t) => taskRowHTML(t)).join('')}</div>` : ''}
  `);
  bindTaskRows($('#view'));
  $('#td-add').onclick = () => captureModal({ today: true });
}

// ---- projects list

function viewProjects() {
  const groups = [
    ['Pinned & active', S.projects.filter((p) => ['active', 'planning'].includes(p.status))],
    ['On hold', S.projects.filter((p) => p.status === 'on-hold')],
    ['Done', S.projects.filter((p) => p.status === 'done')],
    ['Archived', S.projects.filter((p) => p.status === 'archived')],
  ];
  groups[0][1].sort((a, b) => (b.pinned - a.pinned) || PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] || a.name.localeCompare(b.name));
  setView(`
    <div class="page-head">
      <div><h1>Projects</h1><p class="page-sub">${groups[0][1].length} in flight</p></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="pj-new">＋ New project</button>
    </div>
    ${groups.map(([label, list]) => list.length ? `
      <div class="section-title">${label} <span class="cnt">${list.length}</span></div>
      <div class="project-grid">${list.map(projectCardHTML).join('')}</div>` : '').join('')}
    ${!S.projects.length ? `<div class="empty"><span class="big">▣</span>No projects yet.<br><br><button class="btn btn-primary" id="pj-new2">Create your first project</button></div>` : ''}
  `);
  bindProjectCards($('#view'));
  $('#pj-new').onclick = () => projectModal();
  const n2 = $('#pj-new2'); if (n2) n2.onclick = () => projectModal();
}

// ---- project detail

let notesTimer = null;
function viewProject(pid) {
  const p = projById(pid);
  if (!p) { location.hash = '#/projects'; return; }
  const ts = projectTasks(pid).sort(taskSort);
  const pct = projectProgress(pid);
  const open = ts.filter((t) => t.status !== 'done');
  const byStatus = ['doing', 'todo', 'waiting', 'done'].map((s) => [s, ts.filter((t) => t.status === s)]);

  setView(`
    <div class="proj-hero" style="--pc:${esc(p.color)}">
      <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h1>${p.pinned ? '📌 ' : ''}${esc(p.name)}</h1>
          ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ''}
          <div class="meta">
            <span class="chip badge-status-${p.status}">${PSTATUS_LABEL[p.status]}</span>
            <span class="chip badge-prio-${p.priority}">${PRIO_LABEL[p.priority]}</span>
            ${p.area ? `<span class="chip">${esc(p.area)}</span>` : ''}
            ${p.due ? `<span class="chip ${dueClass(p.due, p.status === 'done')}">🎯 Target: ${fmtDue(p.due)}</span>` : ''}
            <span class="chip">${open.length} open · ${ts.length - open.length} done</span>
          </div>
          ${pct !== null ? `<div class="prog-row"><div class="progress"><i style="width:${pct}%"></i></div><span class="pct" style="font-weight:700">${pct}%</span></div>` : ''}
        </div>
      </div>
      <div class="actions no-print">
        <button class="btn" id="pd-edit">✎ Edit</button>
        ${S.settings.hasKey ? `<button class="btn" id="pd-ai">✨ AI summary</button>` : ''}
        <button class="btn" id="pd-report">⎙ Status snippet</button>
        <button class="btn btn-ghost" onclick="location.hash='#/projects'">← All projects</button>
      </div>
    </div>

    <div class="quickadd no-print">
      <input id="pd-quick" placeholder="Add a task to ${esc(p.name)}…  (#tag !high ^fri also work here)" autocomplete="off">
      <button class="btn btn-primary" id="pd-quickbtn">Add</button>
    </div>

    ${byStatus.map(([s, list]) => list.length ? `
      <div class="group-head"><span class="chip badge-status-${s}">${STATUS_LABEL[s]}</span><span class="cnt">${list.length}</span></div>
      <div class="task-list">${list.map((t) => taskRowHTML(t, { showProject: false })).join('')}</div>` : '').join('')}
    ${!ts.length ? `<div class="empty"><span class="big">☑</span>No tasks yet — add the first one above.</div>` : ''}

    <div class="section-title">Project notes <span class="hint" style="text-transform:none;letter-spacing:0">(autosaves)</span></div>
    <textarea class="notes-box" id="pd-notes" placeholder="Decisions, vendor contacts, links, scope notes…">${esc(p.notes)}</textarea>
  `);

  bindTaskRows($('#view'));
  $('#pd-edit').onclick = () => projectModal(pid);
  const quick = $('#pd-quick');
  async function quickAdd() {
    const parsed = parseCapture(quick.value.trim());
    if (!parsed.title) return;
    parsed.projectIds = [...new Set([...parsed.projectIds, pid])];
    const t = await api('/api/tasks', 'POST', parsed);
    S.tasks.push(t);
    quick.value = '';
    render();
    setTimeout(() => { const q = $('#pd-quick'); if (q) q.focus(); }, 0);
  }
  quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickAdd(); });
  $('#pd-quickbtn').onclick = quickAdd;

  $('#pd-notes').addEventListener('input', (e) => {
    p.notes = e.target.value;
    if (notesTimer) clearTimeout(notesTimer);
    notesTimer = setTimeout(async () => {
      await api(`/api/projects/${pid}`, 'PATCH', { notes: p.notes });
    }, 700);
  });

  const ai = $('#pd-ai');
  if (ai) ai.onclick = () => aiModal(
    `Summary: ${p.name}`,
    `Summarize the current state of this project for me (the IT manager running it):\n\n${workloadContext({ projectId: pid })}\n\nCover: overall health in one line, what's done recently, what's in flight, what's blocked/waiting, risks (overdue or stale items), and the 2–3 most sensible next actions. Short bullets.`,
    'You are a concise project management assistant.'
  );
  $('#pd-report').onclick = () => {
    const md = projectReportMD(p);
    navigator.clipboard.writeText(md);
    toast('Status snippet copied as Markdown', 'ok');
  };
}

// ---- all tasks

function viewTasks() {
  const allTags = [...new Set(S.tasks.flatMap((t) => t.tags))].sort();
  let list = [...S.tasks];

  if (taskFilters.status === 'open') list = list.filter((t) => t.status !== 'done');
  else if (taskFilters.status === 'overdue') list = list.filter((t) => t.status !== 'done' && t.due && daysUntil(t.due) < 0);
  else if (taskFilters.status !== 'all') list = list.filter((t) => t.status === taskFilters.status);
  if (taskFilters.project === 'none') list = list.filter((t) => !t.projectIds.length);
  else if (taskFilters.project !== 'all') list = list.filter((t) => t.projectIds.includes(taskFilters.project));
  if (taskFilters.tag !== 'all') list = list.filter((t) => t.tags.includes(taskFilters.tag));
  if (taskFilters.priority !== 'all') list = list.filter((t) => t.priority === taskFilters.priority);
  list.sort(taskSort);

  // grouping
  let groupsHTML = '';
  if (taskFilters.group === 'project') {
    const seen = new Set();
    const groups = [];
    for (const p of S.projects) {
      const g = list.filter((t) => t.projectIds.includes(p.id));
      if (g.length) { groups.push([p.name, g, p.color]); g.forEach((t) => seen.add(t.id)); }
    }
    const loose = list.filter((t) => !seen.has(t.id));
    if (loose.length) groups.push(['No project', loose, null]);
    groupsHTML = groups.map(([name, g, color]) => `
      <div class="group-head">${color ? `<span style="width:9px;height:9px;border-radius:50%;background:${color}"></span>` : ''}${esc(name)} <span class="cnt">${g.length}</span></div>
      <div class="task-list">${g.map((t) => taskRowHTML(t, { showProject: false })).join('')}</div>`).join('');
  } else if (taskFilters.group === 'due') {
    const buckets = [['Overdue', (t) => t.due && daysUntil(t.due) < 0], ['Today', (t) => t.due && daysUntil(t.due) === 0],
      ['This week', (t) => t.due && daysUntil(t.due) > 0 && daysUntil(t.due) <= 7], ['Later', (t) => t.due && daysUntil(t.due) > 7], ['No date', (t) => !t.due]];
    groupsHTML = buckets.map(([name, fn]) => {
      const g = list.filter(fn);
      return g.length ? `<div class="group-head">${name} <span class="cnt">${g.length}</span></div><div class="task-list">${g.map((t) => taskRowHTML(t)).join('')}</div>` : '';
    }).join('');
  } else {
    groupsHTML = `<div class="task-list">${list.map((t) => taskRowHTML(t)).join('')}</div>`;
  }

  setView(`
    <div class="page-head">
      <div><h1>Tasks</h1><p class="page-sub">${list.length} shown</p></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="tk-new">＋ New task</button>
    </div>
    <div class="filterbar">
      <div class="seg" id="tk-status">
        ${[['open', 'Open'], ['doing', 'Doing'], ['waiting', 'Waiting'], ['overdue', 'Overdue'], ['done', 'Done'], ['all', 'All']].map(([v, l]) =>
          `<button data-v="${v}" class="${taskFilters.status === v ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <select id="tk-proj">
        <option value="all">All projects</option>
        <option value="none" ${taskFilters.project === 'none' ? 'selected' : ''}>No project</option>
        ${S.projects.map((p) => `<option value="${p.id}" ${taskFilters.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      ${allTags.length ? `<select id="tk-tag"><option value="all">All tags</option>${allTags.map((t) => `<option ${taskFilters.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
      <select id="tk-prio">
        <option value="all">Any priority</option>
        ${['critical', 'high', 'medium', 'low'].map((x) => `<option value="${x}" ${taskFilters.priority === x ? 'selected' : ''}>${PRIO_LABEL[x]}</option>`).join('')}
      </select>
      <div class="seg" id="tk-group">
        ${[['project', 'By project'], ['due', 'By due'], ['flat', 'Flat']].map(([v, l]) => `<button data-v="${v}" class="${taskFilters.group === v ? 'on' : ''}">${l}</button>`).join('')}
      </div>
    </div>
    ${groupsHTML || `<div class="empty"><span class="big">☑</span>Nothing matches these filters.</div>`}
  `);

  bindTaskRows($('#view'));
  $('#tk-new').onclick = () => taskModal(null);
  $$('#tk-status button').forEach((b) => { b.onclick = () => { taskFilters.status = b.dataset.v; render(); }; });
  $$('#tk-group button').forEach((b) => { b.onclick = () => { taskFilters.group = b.dataset.v; render(); }; });
  $('#tk-proj').onchange = (e) => { taskFilters.project = e.target.value; render(); };
  const tagSel = $('#tk-tag'); if (tagSel) tagSel.onchange = (e) => { taskFilters.tag = e.target.value; render(); };
  $('#tk-prio').onchange = (e) => { taskFilters.priority = e.target.value; render(); };
}

// ---- calendar / agenda

let calRange = 7; // days shown in the agenda

function viewCalendar() {
  const open = S.tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due && daysUntil(t.due) < 0).sort(taskSort);

  // Items land on a day if they're due that day OR have a reminder that day.
  const onDay = (t, d) => t.due === d || (t.remind && t.remind.slice(0, 10) === d);

  const days = [];
  for (let i = 0; i < calRange; i++) {
    const d = addDays(todayStr(), i);
    const items = open.filter((t) => onDay(t, d)).sort(taskSort);
    days.push([d, items]);
  }
  const scheduled = new Set(days.flatMap(([, items]) => items.map((t) => t.id)));
  const totalScheduled = scheduled.size;

  const dayBlock = ([d, items]) => {
    const n = daysUntil(d);
    const dt = new Date(d + 'T12:00:00');
    const rel = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : dt.toLocaleDateString(undefined, { weekday: 'long' });
    const sub = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    return `
      <div class="cal-day ${n === 0 ? 'is-today' : ''} ${isWeekend ? 'is-weekend' : ''}">
        <div class="cal-dayhead">
          <div class="cal-daylabel"><span class="cal-rel">${rel}</span><span class="cal-date">${sub}</span></div>
          <button class="t-act cal-add" data-add-due="${d}" title="Add a task on ${sub}">＋</button>
        </div>
        ${items.length
          ? `<div class="task-list">${items.map((t) => taskRowHTML(t)).join('')}</div>`
          : `<div class="cal-empty">—</div>`}
      </div>`;
  };

  setView(`
    <div class="page-head">
      <div><h1>🗓 Calendar</h1><p class="page-sub">${totalScheduled} scheduled · ${overdue.length} overdue</p></div>
      <div class="spacer"></div>
      <div class="seg" id="cal-range">
        ${[[7, 'Week'], [14, '2 weeks'], [30, 'Month']].map(([v, l]) => `<button data-v="${v}" class="${calRange === v ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <button class="btn btn-primary" id="cal-new">＋ New task</button>
    </div>

    ${overdue.length ? `
      <div class="cal-day is-overdue">
        <div class="cal-dayhead"><div class="cal-daylabel"><span class="cal-rel" style="color:var(--red)">⚠ Overdue</span><span class="cal-date">${overdue.length}</span></div></div>
        <div class="task-list">${overdue.map((t) => taskRowHTML(t)).join('')}</div>
      </div>` : ''}

    <div class="cal-grid">${days.map(dayBlock).join('')}</div>
  `);

  bindTaskRows($('#view'));
  $('#cal-new').onclick = () => taskModal(null);
  $$('#cal-range button').forEach((b) => { b.onclick = () => { calRange = Number(b.dataset.v); render(); }; });
  $$('[data-add-due]', $('#view')).forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); taskModal(null, { due: b.dataset.addDue }); };
  });
}

// ---- board (kanban)

function viewBoard() {
  let list = boardProject === 'all' ? [...S.tasks] : S.tasks.filter((t) => t.projectIds.includes(boardProject));
  const cols = [
    ['todo', 'To do', 'var(--blue)'],
    ['doing', 'In progress', 'var(--green)'],
    ['waiting', 'Waiting on', 'var(--amber)'],
    ['done', 'Done', 'var(--text-faint)'],
  ];
  setView(`
    <div class="page-head">
      <div><h1>Board</h1></div>
      <div class="spacer"></div>
      <select id="bd-proj" class="filterbar" style="padding:7px 11px;background:var(--card);border:1px solid var(--border);border-radius:9px">
        <option value="all">All projects</option>
        ${S.projects.filter((p) => p.status !== 'archived').map((p) => `<option value="${p.id}" ${boardProject === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <button class="btn btn-primary" id="bd-new">＋ Task</button>
    </div>
    <div class="board">
      ${cols.map(([s, label, color]) => {
        let g = list.filter((t) => t.status === s).sort(taskSort);
        if (s === 'done') g = g.slice(0, 15);
        return `
        <div class="bcol" data-col="${s}">
          <div class="bcol-head"><span class="dot" style="background:${color}"></span>${label}<span class="cnt">${g.length}</span></div>
          <div class="task-list">${g.map((t) => taskRowHTML(t, { draggable: true })).join('')}</div>
        </div>`;
      }).join('')}
    </div>
    <p class="hint" style="margin-top:12px">Drag cards between columns, or tap a card to edit its status.</p>
  `);
  bindTaskRows($('#view'));
  $('#bd-proj').onchange = (e) => { boardProject = e.target.value; render(); };
  $('#bd-new').onclick = () => taskModal(null, boardProject !== 'all' ? { projectIds: [boardProject] } : {});

  // drag & drop
  let dragId = null;
  $$('.task-row[draggable]', $('#view')).forEach((row) => {
    row.addEventListener('dragstart', (e) => { dragId = row.dataset.task; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); });
  });
  $$('.bcol', $('#view')).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', () => col.classList.remove('dragover'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('dragover');
      if (!dragId) return;
      await patchTask(dragId, { status: col.dataset.col });
      dragId = null;
      render();
    });
  });
}

// ---- report (boss meeting export)

let reportOpts = { doneDays: 14, includeOnHold: true, includeNoProject: true };

function projectReportMD(p) {
  const ts = projectTasks(p.id);
  const pct = projectProgress(p.id);
  const lines = [`### ${p.name}`];
  const meta = [`Status: ${PSTATUS_LABEL[p.status]}`, `Priority: ${p.priority}`];
  if (p.due) meta.push(`Target: ${p.due}`);
  if (pct !== null) meta.push(`${pct}% complete`);
  lines.push(`*${meta.join(' · ')}*`);
  if (p.description) lines.push(`\n${p.description}`);
  const doing = ts.filter((t) => t.status === 'doing');
  const waiting = ts.filter((t) => t.status === 'waiting');
  const todo = ts.filter((t) => t.status === 'todo').sort(taskSort);
  const cutoff = new Date(Date.now() - reportOpts.doneDays * 86400000).toISOString();
  const done = ts.filter((t) => t.status === 'done' && t.completedAt && t.completedAt > cutoff);
  if (doing.length) { lines.push('', '**In progress:**'); doing.forEach((t) => lines.push(`- ${t.title}${t.due ? ` _(due ${t.due})_` : ''}`)); }
  if (waiting.length) { lines.push('', '**Waiting on:**'); waiting.forEach((t) => lines.push(`- ${t.title}${t.notes ? ` — ${t.notes.split('\n')[0].slice(0, 100)}` : ''}`)); }
  if (todo.length) { lines.push('', '**Up next:**'); todo.slice(0, 8).forEach((t) => lines.push(`- ${t.title}${t.due ? ` _(due ${t.due})_` : ''}`)); }
  if (done.length) { lines.push('', `**Completed (last ${reportOpts.doneDays} days):**`); done.forEach((t) => lines.push(`- ✓ ${t.title}`)); }
  return lines.join('\n');
}

function buildReportMD() {
  const name = S.settings.userName || '';
  const lines = [
    `# Status Report — ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`,
    name ? `*Prepared by ${name}*` : '',
    '',
  ];
  const open = S.tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due && daysUntil(t.due) < 0);
  const cutoff = new Date(Date.now() - reportOpts.doneDays * 86400000).toISOString();
  const doneRecent = S.tasks.filter((t) => t.status === 'done' && t.completedAt && t.completedAt > cutoff);
  const statuses = ['active', 'planning']; if (reportOpts.includeOnHold) statuses.push('on-hold');
  const projs = S.projects.filter((p) => statuses.includes(p.status))
    .sort((a, b) => PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] || a.name.localeCompare(b.name));

  lines.push('## At a glance', '');
  lines.push(`- **${projs.length}** projects in flight, **${open.length}** open tasks`);
  lines.push(`- **${doneRecent.length}** tasks completed in the last ${reportOpts.doneDays} days`);
  if (overdue.length) lines.push(`- ⚠ **${overdue.length}** overdue item${overdue.length > 1 ? 's' : ''} needing attention`);
  lines.push('', '## Projects', '');
  projs.forEach((p) => { lines.push(projectReportMD(p), ''); });

  if (reportOpts.includeNoProject) {
    const loose = open.filter((t) => !t.projectIds.length).sort(taskSort);
    if (loose.length) {
      lines.push('## Other open items', '');
      loose.forEach((t) => lines.push(`- ${t.title}${t.status === 'doing' ? ' _(in progress)_' : ''}${t.due ? ` _(due ${t.due})_` : ''}`));
      lines.push('');
    }
  }
  return lines.filter((l) => l !== null).join('\n');
}

function mdToHTML(md) {
  // Tiny renderer for our own generated markdown only.
  return md.split('\n').map((line) => {
    let l = esc(line);
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>').replace(/\*(.+?)\*/g, '<i>$1</i>');
    if (l.startsWith('# ')) return `<h1>${l.slice(2)}</h1>`;
    if (l.startsWith('## ')) return `<h2>${l.slice(3)}</h2>`;
    if (l.startsWith('### ')) return `<h3>${l.slice(4)}</h3>`;
    if (l.startsWith('- ')) return `<li>${l.slice(2)}</li>`;
    if (!l.trim()) return '';
    return `<p>${l}</p>`;
  }).join('\n').replace(/(<li>[\s\S]*?<\/li>)(?!\n<li>)/g, '$1').replace(/(?:<li>)/g, '<li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
}

function viewReport() {
  const md = buildReportMD();
  setView(`
    <div class="page-head">
      <div><h1>⎙ Strategic report</h1><p class="page-sub">Everything your boss wants to see — current as of right now.</p></div>
      <div class="spacer"></div>
    </div>
    <div class="filterbar no-print">
      <select id="rp-days">
        ${[7, 14, 30, 60].map((d) => `<option value="${d}" ${reportOpts.doneDays === d ? 'selected' : ''}>Done in last ${d} days</option>`).join('')}
      </select>
      <label class="chip clickable" style="padding:6px 12px"><input type="checkbox" id="rp-hold" ${reportOpts.includeOnHold ? 'checked' : ''}> include on-hold</label>
      <label class="chip clickable" style="padding:6px 12px"><input type="checkbox" id="rp-loose" ${reportOpts.includeNoProject ? 'checked' : ''}> include unassigned tasks</label>
      <div class="spacer" style="flex:1"></div>
      <button class="btn" id="rp-copy">⧉ Copy Markdown</button>
      <button class="btn" id="rp-dl">↓ Download .md</button>
      <button class="btn" id="rp-print">⎙ Print / PDF</button>
      ${S.settings.hasKey ? `<button class="btn btn-primary" id="rp-ai">✨ AI executive summary</button>` : ''}
    </div>
    <div class="report-paper" id="rp-paper">${mdToHTML(md)}</div>
  `);
  $('#rp-days').onchange = (e) => { reportOpts.doneDays = Number(e.target.value); render(); };
  $('#rp-hold').onchange = (e) => { reportOpts.includeOnHold = e.target.checked; render(); };
  $('#rp-loose').onchange = (e) => { reportOpts.includeNoProject = e.target.checked; render(); };
  $('#rp-copy').onclick = () => { navigator.clipboard.writeText(buildReportMD()); toast('Report copied as Markdown', 'ok'); };
  $('#rp-dl').onclick = () => {
    const blob = new Blob([buildReportMD()], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `status-report-${todayStr()}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#rp-print').onclick = () => window.print();
  const ai = $('#rp-ai');
  if (ai) ai.onclick = () => aiModal(
    'Executive summary',
    `Turn this raw status report into a crisp executive summary for my boss (a senior leader, short on time). Lead with wins, flag risks honestly, keep each project to 1–2 lines, end with "asks/decisions needed" if any are implied. Keep my voice professional but human.\n\n${buildReportMD()}`,
    'You are an expert at writing succinct, well-structured status updates for senior leadership.'
  );
}

// ---- search results

function viewSearch() {
  const q = searchQuery.toLowerCase();
  const tasks = S.tasks.filter((t) =>
    t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) ||
    t.tags.some((x) => x.includes(q)) || t.subtasks.some((s) => s.title.toLowerCase().includes(q)));
  const projects = S.projects.filter((p) =>
    p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || (p.area || '').toLowerCase().includes(q));
  setView(`
    <div class="page-head"><div><h1>Search: “${esc(searchQuery)}”</h1><p class="page-sub">${projects.length} projects · ${tasks.length} tasks</p></div></div>
    ${projects.length ? `<div class="section-title">Projects</div><div class="project-grid">${projects.map(projectCardHTML).join('')}</div>` : ''}
    ${tasks.length ? `<div class="section-title">Tasks</div><div class="task-list">${tasks.sort(taskSort).map((t) => taskRowHTML(t)).join('')}</div>` : ''}
    ${!projects.length && !tasks.length ? `<div class="empty"><span class="big">⌕</span>No matches.</div>` : ''}
  `);
  bindTaskRows($('#view'));
  bindProjectCards($('#view'));
}

// ---- settings

function viewSettings() {
  setView(`
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <div style="display:flex;flex-direction:column;gap:18px;max-width:640px">
      <div class="card">
        <div class="section-title">You</div>
        <div class="field-row">
          <div class="field"><label>Your name (used in reports & greeting)</label><input id="st-name" value="${esc(S.settings.userName || '')}" placeholder="e.g. Ben"></div>
          <div class="field"><label>Theme</label>
            <select id="st-theme"><option value="dark" ${S.settings.theme === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${S.settings.theme === 'light' ? 'selected' : ''}>Light</option></select>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">✨ AI (OpenRouter)</div>
        <p class="hint" style="margin-bottom:12px">Powers project summaries, weekly briefings and executive report polish. Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. The key is stored only on this server (in your data file) and never sent to the browser.</p>
        <div class="field" style="margin-bottom:12px">
          <label>API key ${S.settings.hasKey ? '<span style="color:var(--green)">● connected</span>' : '<span style="color:var(--text-faint)">○ not set</span>'}</label>
          <input id="st-key" type="password" placeholder="${S.settings.hasKey ? '•••••••• (leave blank to keep current key)' : 'sk-or-v1-…'}" autocomplete="off">
        </div>
        <div class="field">
          <label>Model</label>
          <input id="st-model" value="${esc(S.settings.openrouterModel || '')}" list="st-models" placeholder="anthropic/claude-sonnet-4.5">
          <datalist id="st-models">
            <option value="anthropic/claude-sonnet-4.5"><option value="anthropic/claude-opus-4.1"><option value="anthropic/claude-3.5-haiku">
            <option value="openai/gpt-4o"><option value="google/gemini-2.5-pro"><option value="meta-llama/llama-3.3-70b-instruct">
          </datalist>
        </div>
        ${S.settings.hasKey ? `<button class="btn btn-sm" id="st-test" style="margin-top:12px">Test connection</button>` : ''}
      </div>

      <div class="card">
        <div class="section-title">🔔 Notifications</div>
        <p class="hint" style="margin-bottom:12px">Reminders always appear in-app (the bell up top). Turn this on to also get desktop pop-ups on this device when a task's ⏰ reminder fires, plus a morning digest.</p>
        <label style="display:flex;align-items:center;gap:9px;cursor:pointer">
          <input type="checkbox" id="st-notify" ${localStorage.getItem('helm-notify') === '1' ? 'checked' : ''}>
          Desktop notifications on this device
          ${'Notification' in window ? (Notification.permission === 'denied' ? '<span class="hint" style="color:var(--red)">(blocked in browser settings)</span>' : '') : '<span class="hint">(not supported in this browser)</span>'}
        </label>
      </div>

      <div class="card">
        <div class="section-title">Data</div>
        <p class="hint" style="margin-bottom:12px">Your data lives in <code>data/helm.json</code> next to the server. Back it up any time.</p>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <a class="btn" href="/api/backup" download>↓ Download backup</a>
          <button class="btn" id="st-restore">↑ Restore from backup</button>
          <input type="file" id="st-file" accept="application/json" style="display:none">
        </div>
      </div>

      <button class="btn btn-primary" id="st-save" style="align-self:flex-start">Save settings</button>
      ${S.authEnabled ? `<div class="card" style="border-color:var(--red-soft)">
        <div class="section-title" style="color:var(--red)">Sign out</div>
        <p class="hint" style="margin-bottom:12px">Signs out of this device. You'll need to sign in again to access Helm.</p>
        <button class="btn" id="st-logout" style="border-color:var(--red);color:var(--red)">Sign out of Helm</button>
      </div>` : ''}
      <p class="hint">Helm v1 · keyboard: <kbd>N</kbd> capture · <kbd>P</kbd> new project · <kbd>/</kbd> search · <kbd>1–6</kbd> switch views</p>
    </div>
  `);
  $('#st-save').onclick = async () => {
    const body = {
      userName: $('#st-name').value.trim(),
      theme: $('#st-theme').value,
      openrouterModel: $('#st-model').value.trim(),
    };
    const key = $('#st-key').value.trim();
    if (key) body.openrouterKey = key;
    const s = await api('/api/settings', 'PATCH', body);
    S.settings = s;
    applyTheme();
    toast('Settings saved', 'ok');
    render();
  };
  $('#st-notify').onchange = async (e) => {
    if (e.target.checked) {
      if (!('Notification' in window)) { toast('Notifications not supported here', 'err'); e.target.checked = false; return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Permission not granted — in-app alerts still work', 'err'); e.target.checked = false; return; }
      localStorage.setItem('helm-notify', '1');
      fireNotification('⎈ Helm', 'Notifications are on. You’ll get pinged when reminders fire.');
    } else {
      localStorage.removeItem('helm-notify');
    }
  };
  const test = $('#st-test');
  if (test) test.onclick = () => aiModal('Connection test', 'Reply with a one-line confirmation that you are reachable, plus a fun fact about lighthouses.', 'Be brief.');
  const logoutBtn = $('#st-logout');
  if (logoutBtn) logoutBtn.onclick = async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    showLoginScreen();
  };
  $('#st-restore').onclick = () => $('#st-file').click();
  $('#st-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    confirmModal('Restore backup?', 'This replaces ALL current data with the backup file. This cannot be undone.', async () => {
      try {
        const json = JSON.parse(await file.text());
        await api('/api/restore', 'POST', json);
        await loadState();
        render();
        toast('Backup restored', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    });
  };
}

// ------------------------------------------------------------ theming

function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme || 'dark';
  const meta = $('meta[name=theme-color]');
  if (meta) meta.content = S.settings.theme === 'light' ? '#f3f4f8' : '#0d1017';
}

// ------------------------------------------------------------ router

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, param] = h.split('/');
  return { name: name || 'dashboard', param: param || null };
}

function render() {
  route = parseHash();
  if (searchQuery) { viewSearch(); navHighlight(); return; }
  switch (route.name) {
    case 'today': viewToday(); break;
    case 'projects': viewProjects(); break;
    case 'project': viewProject(route.param); break;
    case 'tasks': viewTasks(); break;
    case 'calendar': viewCalendar(); break;
    case 'board': viewBoard(); break;
    case 'report': viewReport(); break;
    case 'settings': viewSettings(); break;
    default: viewDashboard();
  }
  navHighlight();
  closeSidebar();
}

window.addEventListener('hashchange', () => {
  const search = $('#search');
  if (searchQuery && search) { searchQuery = ''; search.value = ''; }
  render();
});

// ------------------------------------------------------------ mobile sidebar

function closeSidebar() {
  $('#sidebar').classList.remove('open');
  const sc = $('#scrim'); if (sc) sc.remove();
}
$('#btn-menu').onclick = () => {
  const sb = $('#sidebar');
  sb.classList.add('open');
  const sc = document.createElement('div');
  sc.id = 'scrim';
  sc.onclick = closeSidebar;
  document.body.appendChild(sc);
};

// ------------------------------------------------------------ global handlers

$('#btn-capture').onclick = () => { closeSidebar(); captureModal(); };
$('#btn-capture-top').onclick = () => captureModal();
$('#mob-capture').onclick = (e) => { e.preventDefault(); captureModal(); };
$('#btn-theme').onclick = async () => {
  S.settings.theme = S.settings.theme === 'light' ? 'dark' : 'light';
  applyTheme();
  await api('/api/settings', 'PATCH', { theme: S.settings.theme });
};

let searchTimer = null;
$('#search').addEventListener('input', (e) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = e.target.value.trim();
    render();
  }, 160);
});
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { searchQuery = ''; e.target.value = ''; e.target.blur(); render(); }
});

// ------------------------------------------------------------ command palette (⌘/Ctrl-K)

function fuzzyScore(q, text) {
  if (!q) return 0;
  text = (text || '').toLowerCase();
  const idx = text.indexOf(q);
  if (idx >= 0) return 1000 - idx - Math.max(0, text.length - q.length) * 0.05; // substring wins
  let ti = 0, gaps = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = text.indexOf(q[qi], ti);
    if (found < 0) return -1;
    if (qi > 0 && found > ti) gaps++;
    ti = found + 1;
  }
  return 200 - gaps * 5;
}

function paletteItems() {
  const items = [];
  const go = (hash) => () => { closeModal(); location.hash = hash; };
  // Commands / navigation — always available.
  items.push(
    { type: 'cmd', icon: '＋', label: 'New task', hint: 'Quick capture', keys: 'N', run: () => { closeModal(); captureModal(); } },
    { type: 'cmd', icon: '▣', label: 'New project', keys: 'P', run: () => { closeModal(); projectModal(); } },
    { type: 'cmd', icon: '◈', label: 'Go to Dashboard', keys: '1', run: go('#/dashboard') },
    { type: 'cmd', icon: '☀', label: 'Go to My Day', keys: '2', run: go('#/today') },
    { type: 'cmd', icon: '▣', label: 'Go to Projects', keys: '3', run: go('#/projects') },
    { type: 'cmd', icon: '☑', label: 'Go to Tasks', keys: '4', run: go('#/tasks') },
    { type: 'cmd', icon: '🗓', label: 'Go to Calendar', keys: 'C', run: go('#/calendar') },
    { type: 'cmd', icon: '⫿', label: 'Go to Board', keys: '5', run: go('#/board') },
    { type: 'cmd', icon: '⎙', label: 'Go to Report', keys: '6', run: go('#/report') },
    { type: 'cmd', icon: '⚙', label: 'Go to Settings', run: go('#/settings') },
    { type: 'cmd', icon: '🔔', label: 'Show alerts & reminders', run: () => { closeModal(); alertsPanel(); } },
    { type: 'cmd', icon: '◐', label: 'Toggle light / dark theme', run: async () => { closeModal(); $('#btn-theme').click(); } },
  );
  // Projects.
  for (const p of S.projects) {
    if (p.status === 'archived') continue;
    items.push({
      type: 'project', icon: '▣', color: p.color,
      label: p.name, hint: PSTATUS_LABEL[p.status],
      haystack: `${p.name} ${p.area || ''} ${p.description || ''}`,
      run: () => { closeModal(); location.hash = `#/project/${p.id}`; },
    });
  }
  // Tasks (open first, then a few done).
  const open = S.tasks.filter((t) => t.status !== 'done');
  const done = S.tasks.filter((t) => t.status === 'done');
  for (const t of [...open, ...done]) {
    const projs = t.projectIds.map(projById).filter(Boolean).map((p) => p.name).join(', ');
    const hintBits = [];
    if (projs) hintBits.push('▣ ' + projs);
    if (t.due) hintBits.push('📅 ' + fmtDue(t.due));
    if (t.status === 'done') hintBits.push('done');
    items.push({
      type: 'task', icon: t.status === 'done' ? '☑' : '☐',
      label: t.title, hint: hintBits.join(' · '),
      haystack: `${t.title} ${t.tags.map((x) => '#' + x).join(' ')} ${t.notes}`,
      rank: t.status === 'done' ? -50 : 0,
      run: () => { closeModal(); taskModal(t.id); },
      actions: [
        { icon: '✓', title: 'Complete', run: () => { toggleTask(t.id); } },
        { icon: '☀', title: t.today ? 'Remove from My Day' : 'Add to My Day',
          run: async () => { await patchTask(t.id, { today: !t.today }); toast(t.today ? '☀ On My Day' : 'Off My Day'); render(); } },
      ],
    });
  }
  return items;
}

function commandPalette() {
  if ($('.cmdk')) return;
  const all = paletteItems();
  const m = openModal(`
    <div class="cmdk">
      <input id="cmdk-in" class="cmdk-input" placeholder="Search tasks, projects, commands…  (try a tag, a name, or “new task”)" autocomplete="off" spellcheck="false">
      <div class="cmdk-list" id="cmdk-list"></div>
      <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
    </div>`);
  m.classList.add('cmdk-modal');
  const input = $('#cmdk-in', m);
  const list = $('#cmdk-list', m);
  let results = [];
  let sel = 0;

  function compute(q) {
    q = q.trim().toLowerCase();
    if (!q) return all.filter((i) => i.type === 'cmd').concat(all.filter((i) => i.type !== 'cmd').slice(0, 6));
    return all
      .map((i) => ({ i, s: fuzzyScore(q, i.haystack || i.label) + (i.rank || 0) }))
      .filter((x) => x.s > -1)
      .sort((a, b) => b.s - a.s)
      .slice(0, 14)
      .map((x) => x.i);
  }
  function draw() {
    list.innerHTML = results.map((it, n) => `
      <div class="cmdk-row ${n === sel ? 'sel' : ''}" data-n="${n}">
        <span class="cmdk-ic" ${it.color ? `style="color:${esc(it.color)}"` : ''}>${it.icon}</span>
        <span class="cmdk-label">${esc(it.label)}${it.hint ? `<span class="cmdk-hint">${esc(it.hint)}</span>` : ''}</span>
        ${it.keys ? `<kbd class="cmdk-key">${it.keys}</kbd>` : ''}
        ${(it.actions || []).map((a, ai) => `<button class="cmdk-act" data-n="${n}" data-ai="${ai}" title="${esc(a.title)}">${a.icon}</button>`).join('')}
      </div>`).join('') || `<div class="cmdk-empty">No matches</div>`;
    const selEl = $('.cmdk-row.sel', list);
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }
  function refresh() { results = compute(input.value); sel = 0; draw(); }
  function activate(n) { const it = results[n]; if (it) it.run(); }

  list.addEventListener('click', (e) => {
    const actBtn = e.target.closest('.cmdk-act');
    if (actBtn) { e.stopPropagation(); results[+actBtn.dataset.n].actions[+actBtn.dataset.ai].run(); return; }
    const row = e.target.closest('.cmdk-row');
    if (row) activate(+row.dataset.n);
  });
  list.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.cmdk-row');
    if (row && +row.dataset.n !== sel) { sel = +row.dataset.n; draw(); }
  });
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, results.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(sel); }
  });
  refresh();
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault(); commandPalette(); return;
  }
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (e.key === 'Escape' && $('#modal-root').innerHTML) { closeModal(); return; }
  if (inField || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'n' || k === 'q') { e.preventDefault(); captureModal(); }
  else if (k === 'p') { e.preventDefault(); projectModal(); }
  else if (k === '/') { e.preventDefault(); $('#search').focus(); }
  else if (k === '1') location.hash = '#/dashboard';
  else if (k === '2') location.hash = '#/today';
  else if (k === '3') location.hash = '#/projects';
  else if (k === '4') location.hash = '#/tasks';
  else if (k === '5') location.hash = '#/board';
  else if (k === '6') location.hash = '#/report';
  else if (k === 'c') location.hash = '#/calendar';
});

// ------------------------------------------------------------ alerts & reminders

const NOTIFY_KEY = 'helm-notify';
function notifyEnabled() {
  return localStorage.getItem(NOTIFY_KEY) === '1' && 'Notification' in window && Notification.permission === 'granted';
}
function localDT() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function alertBuckets() {
  const open = S.tasks.filter((t) => t.status !== 'done');
  return {
    overdue: open.filter((t) => t.due && daysUntil(t.due) < 0).sort(taskSort),
    today: open.filter((t) => t.due && daysUntil(t.due) === 0).sort(taskSort),
    reminders: open.filter((t) => t.remind && t.remind > localDT()).sort((a, b) => (a.remind < b.remind ? -1 : 1)),
    stale: open.filter((t) => (Date.now() - new Date(t.updatedAt)) / 86400000 > 14).sort(taskSort),
  };
}

function updateBell() {
  const b = alertBuckets();
  const n = b.overdue.length + b.today.length;
  const badge = $('#bell-badge');
  badge.hidden = n === 0;
  badge.textContent = n > 99 ? '99+' : n;
}

function alertsPanel() {
  const b = alertBuckets();
  const section = (title, list, color) => list.length ? `
    <div class="alert-section">
      <div class="section-title" style="${color ? `color:${color}` : ''}">${title} <span class="cnt">${list.length}</span></div>
      <div class="task-list">${list.slice(0, 10).map((t) => taskRowHTML(t)).join('')}</div>
    </div>` : '';
  const m = openModal(`
    <div class="modal-head"><h2>🔔 Alerts & reminders</h2></div>
    <div class="modal-body" style="max-height:65vh;overflow-y:auto">
      ${section('⚠ Overdue', b.overdue, 'var(--red)')}
      ${section('Due today', b.today, 'var(--amber)')}
      ${section('⏰ Upcoming reminders', b.reminders)}
      ${section('Gone stale (14+ days untouched)', b.stale)}
      ${!b.overdue.length && !b.today.length && !b.reminders.length && !b.stale.length
        ? '<div class="empty"><span class="big">🧘</span>All clear. Nothing is on fire.</div>' : ''}
      ${!notifyEnabled() && 'Notification' in window ? `<p class="hint">Tip: enable desktop notifications in <a href="#/settings" onclick="document.getElementById('modal-root').innerHTML=''">Settings</a> to get reminder pop-ups even when you're in another window.</p>` : ''}
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-x="close">Close</button></div>`, { wide: true });
  bindTaskRows(m);
  $('[data-x=close]', m).onclick = closeModal;
}

function fireNotification(title, body, taskId) {
  toast(`${title} — ${body}`, '');
  if (!notifyEnabled()) return;
  try {
    const n = new Notification(title, { body, icon: '/icons/icon-180.png', tag: taskId || title });
    n.onclick = () => { window.focus(); if (taskId) taskModal(taskId); n.close(); };
  } catch (_) { /* iOS Safari w/o push: in-app toast already shown */ }
}

let remindersBusy = false;
async function checkReminders() {
  if (remindersBusy) return;
  remindersBusy = true;
  try {
    const cutoff = localDT();
    const due = S.tasks.filter((t) => t.status !== 'done' && t.remind && !t.remindedAt && t.remind <= cutoff);
    for (const t of due) {
      fireNotification('⏰ ' + t.title, t.due ? `Due ${fmtDue(t.due)}` : 'Reminder', t.id);
      await patchTask(t.id, { remindedAt: new Date().toISOString() });
    }
    if (due.length) { updateBell(); render(); }
  } catch (_) { /* offline: try again next tick */ }
  remindersBusy = false;
}

function dailyDigest() {
  const key = 'helm-digest';
  if (localStorage.getItem(key) === todayStr()) return;
  const b = alertBuckets();
  if (!b.overdue.length && !b.today.length) return;
  localStorage.setItem(key, todayStr());
  fireNotification('⎈ Your day at a glance',
    `${b.today.length} due today · ${b.overdue.length} overdue${b.stale.length ? ` · ${b.stale.length} stale` : ''}`);
}

$('#btn-bell').onclick = alertsPanel;

// ------------------------------------------------------------ auth / login screen

let _reauthing = false;
function requireReauth() {
  if (_reauthing || document.querySelector('.login-screen')) return;
  _reauthing = true;
  showLoginScreen().finally(() => { _reauthing = false; });
}

async function showLoginScreen() {
  const info = await fetch('/api/auth-info').then((r) => r.json()).catch(() => ({ hasPassword: true, hasGoogle: false }));
  const errParam = new URLSearchParams(location.search).get('error');
  const errMsg = errParam === 'not_allowed' ? 'That Google account is not authorized to access Helm.'
    : errParam ? 'Sign-in failed. Please try again.' : '';

  const googleBtn = info.hasGoogle
    ? `<a href="/auth/google" class="btn-google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Sign in with Google</a>`
    : '';

  const passForm = info.hasPassword
    ? `<form id="login-form">${info.hasGoogle ? '<div class="login-divider">or use password</div>' : ''}
      <input id="login-pass" type="password" class="login-input" placeholder="Password" autocomplete="current-password">
      <button type="submit" class="btn btn-primary btn-block">Unlock ⎈</button>
    </form>
    <p id="login-err" class="login-err" hidden></p>` : '';

  document.getElementById('view').innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-mark">⎈</div>
        <h1 class="login-title">Helm</h1>
        <p class="login-sub">Sign in to continue</p>
        ${errMsg ? `<p class="login-err" style="display:block;margin-bottom:16px">${esc(errMsg)}</p>` : ''}
        ${googleBtn}
        ${passForm}
      </div>
    </div>`;

  const form = document.getElementById('login-form');
  if (form) {
    const passEl = document.getElementById('login-pass');
    const errEl = document.getElementById('login-err');
    setTimeout(() => passEl?.focus(), 100);
    form.onsubmit = async (e) => {
      e.preventDefault();
      errEl.hidden = true;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: passEl.value }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          passEl.value = '';
          await loadState();
          render();
          updateBell();
        } else {
          errEl.textContent = data.error || 'Incorrect password';
          errEl.hidden = false;
          passEl.value = '';
          passEl.focus();
          btn.disabled = false;
          btn.textContent = 'Unlock ⎈';
        }
      } catch (err) {
        errEl.textContent = 'Could not reach server — try again';
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Unlock ⎈';
      }
    };
  }
}

// ------------------------------------------------------------ boot

(async function boot() {
  try {
    await loadState();
  } catch (err) {
    if (err.isAuthError) return; // showLoginScreen already called via requireReauth()
    setView(`<div class="empty"><span class="big">⚠</span>Could not reach the Helm server.<br>${esc(err.message)}</div>`);
    return;
  }
  render();
  updateBell();
  dailyDigest();
  setInterval(checkReminders, 30000);
  checkReminders();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
