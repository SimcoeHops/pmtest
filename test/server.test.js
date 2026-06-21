'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const srv = require('../server.js');

// ---------------------------------------------------------------- nextDue
test('nextDue advances by the right interval', () => {
  assert.equal(srv.nextDue('2026-06-17', 'daily'), '2026-06-18');
  assert.equal(srv.nextDue('2026-06-17', 'weekly'), '2026-06-24');
  assert.equal(srv.nextDue('2026-06-17', 'biweekly'), '2026-07-01');
  assert.equal(srv.nextDue('2026-06-17', 'monthly'), '2026-07-17');
});

test('nextDue weekdays skips the weekend', () => {
  // 2026-06-19 is a Friday -> next weekday is Monday the 22nd.
  assert.equal(srv.nextDue('2026-06-19', 'weekdays'), '2026-06-22');
});

test('nextDue none/unknown returns the date unchanged', () => {
  assert.equal(srv.nextDue('2026-06-17', 'none'), '2026-06-17');
  assert.equal(srv.nextDue('2026-06-17', 'whatever'), '2026-06-17');
});

// ---------------------------------------------------------------- sanitizeTask
test('sanitizeTask applies defaults and validates enums', () => {
  const t = srv.sanitizeTask({ title: 'Hi', status: 'bogus', priority: 'nope' });
  assert.equal(t.status, 'todo');
  assert.equal(t.priority, 'medium');
  assert.equal(t.repeat, 'none');
  assert.deepEqual(t.tags, []);
  assert.deepEqual(t.subtasks, []);
  assert.ok(t.id && t.createdAt && t.updatedAt);
});

test('sanitizeTask clamps long titles and normalizes tags', () => {
  const t = srv.sanitizeTask({ title: 'x'.repeat(1000), tags: [' Security ', 'OPS', ''] });
  assert.equal(t.title.length, 300);
  assert.deepEqual(t.tags, ['security', 'ops']);
});

test('sanitizeTask drops empty subtasks and keeps titled ones', () => {
  const t = srv.sanitizeTask({ title: 'x', subtasks: [{ title: '' }, { title: 'real', done: true }] });
  assert.equal(t.subtasks.length, 1);
  assert.equal(t.subtasks[0].title, 'real');
  assert.equal(t.subtasks[0].done, true);
  assert.ok(t.subtasks[0].id);
});

test('sanitizeTask re-arms remindedAt when the reminder time changes', () => {
  const existing = srv.sanitizeTask({ title: 'x', remind: '2026-06-17T08:00' });
  existing.remindedAt = '2026-06-17T08:00:01.000Z';
  // same remind -> remindedAt preserved
  srv.sanitizeTask({ remind: '2026-06-17T08:00' }, existing);
  assert.equal(existing.remindedAt, '2026-06-17T08:00:01.000Z');
  // changed remind -> remindedAt cleared (so it can fire again)
  srv.sanitizeTask({ remind: '2026-06-18T09:30' }, existing);
  assert.equal(existing.remindedAt, null);
  assert.equal(existing.remind, '2026-06-18T09:30');
});

test('sanitizeTask rejects malformed reminder strings', () => {
  const t = srv.sanitizeTask({ title: 'x', remind: 'not-a-date' });
  assert.equal(t.remind, null);
});

// ---------------------------------------------------------------- sanitizeProject
test('sanitizeProject applies defaults and validates enums', () => {
  const p = srv.sanitizeProject({ name: '', status: 'bogus', priority: 'x' });
  assert.equal(p.name, 'Untitled project');
  assert.equal(p.status, 'active');
  assert.equal(p.priority, 'medium');
  assert.equal(p.color, '#6366f1');
  assert.ok(p.id && p.createdAt);
});

// ---------------------------------------------------------------- My Day rollover
test('maybeRolloverMyDay carries over unfinished items, drops completed ones', () => {
  const today = srv.localDateStr();
  srv._setDb({
    tasks: [
      { id: 'a', today: true, status: 'todo' },   // unfinished -> stays
      { id: 'b', today: true, status: 'done' },    // completed  -> dropped from My Day
      { id: 'c', today: false, status: 'todo' },   // not on My Day -> untouched
    ],
    settings: { lastRollover: '2000-01-01' },
  });
  assert.equal(srv.maybeRolloverMyDay(), true);          // a new day -> changed
  const db = srv._getDb();
  assert.equal(db.tasks[0].today, true);                 // unfinished carried over
  assert.equal(db.tasks[1].today, false);                // completed cleared
  assert.equal(db.tasks[2].today, false);
  assert.equal(db.settings.lastRollover, today);
  assert.equal(srv.maybeRolloverMyDay(), false);         // same day -> no-op
});

// ---------------------------------------------------------------- mergeById
test('mergeById keeps the newer copy per id and unions both sides', () => {
  const local = [
    { id: 'a', updatedAt: '2026-06-17T10:00:00Z', v: 'local-new' },
    { id: 'b', updatedAt: '2026-06-17T09:00:00Z', v: 'local-old' },
    { id: 'c', updatedAt: '2026-06-17T08:00:00Z', v: 'local-only' },
  ];
  const remote = [
    { id: 'a', updatedAt: '2026-06-17T09:00:00Z', v: 'remote-old' },
    { id: 'b', updatedAt: '2026-06-17T11:00:00Z', v: 'remote-new' },
    { id: 'd', updatedAt: '2026-06-17T08:00:00Z', v: 'remote-only' },
  ];
  const merged = srv.mergeById(local, remote, 'updatedAt');
  const byId = Object.fromEntries(merged.map((x) => [x.id, x.v]));
  assert.equal(byId.a, 'local-new');   // local newer wins
  assert.equal(byId.b, 'remote-new');  // remote newer wins
  assert.equal(byId.c, 'local-only');  // local-only kept
  assert.equal(byId.d, 'remote-only'); // remote-only kept
  assert.equal(merged.length, 4);
});
