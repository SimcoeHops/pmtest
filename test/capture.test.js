'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCapture, dueReminders } = require('../public/js/capture.js');

// A fixed reference date so relative-date assertions are deterministic.
// 2026-06-17 is a Wednesday.
const WED = new Date(2026, 5, 17, 12, 0, 0);
const projects = [
  { id: 'p1', name: 'Infra', status: 'active' },
  { id: 'p2', name: 'Budget Narrative', status: 'active' },
  { id: 'p3', name: 'Old Thing', status: 'archived' },
];

test('plain text becomes the title', () => {
  const r = parseCapture('Call the vendor back', projects, WED);
  assert.equal(r.title, 'Call the vendor back');
  assert.equal(r.priority, 'medium');
  assert.deepEqual(r.tags, []);
  assert.deepEqual(r.projectIds, []);
  assert.equal(r.due, null);
  assert.equal(r.today, false);
});

test('tags, priority, project and date are extracted and stripped from title', () => {
  const r = parseCapture('Renew SSL certs @Infra #security !high ^fri', projects, WED);
  assert.equal(r.title, 'Renew SSL certs');
  assert.deepEqual(r.tags, ['security']);
  assert.equal(r.priority, 'high');
  assert.deepEqual(r.projectIds, ['p1']);
  assert.equal(r._projName, 'Infra');
  assert.equal(r.due, '2026-06-19'); // Friday after Wed the 17th
});

test('priority aliases map correctly', () => {
  assert.equal(parseCapture('x !crit', [], WED).priority, 'critical');
  assert.equal(parseCapture('x !1', [], WED).priority, 'critical');
  assert.equal(parseCapture('x !hi', [], WED).priority, 'high');
  assert.equal(parseCapture('x !low', [], WED).priority, 'low');
  assert.equal(parseCapture('x !bogus', [], WED).priority, 'medium'); // unknown -> default, kept in title
  assert.equal(parseCapture('x !bogus', [], WED).title, 'x !bogus');
});

test('^today sets due AND the My Day flag', () => {
  const r = parseCapture('Standup ^today', [], WED);
  assert.equal(r.due, '2026-06-17');
  assert.equal(r.today, true);
});

test('^tomorrow / ^eom / ISO dates', () => {
  assert.equal(parseCapture('x ^tomorrow', [], WED).due, '2026-06-18');
  assert.equal(parseCapture('x ^tom', [], WED).due, '2026-06-18');
  assert.equal(parseCapture('x ^eom', [], WED).due, '2026-06-30');
  assert.equal(parseCapture('x ^2026-07-01', [], WED).due, '2026-07-01');
});

test('a weekday that is today rolls forward a full week (never today)', () => {
  // WED is Wednesday; ^wed should be next Wednesday, not today.
  assert.equal(parseCapture('x ^wed', [], WED).due, '2026-06-24');
});

test('@project prefers a name-prefix match, ignores archived for prefix', () => {
  const r = parseCapture('x @budget', projects, WED);
  assert.deepEqual(r.projectIds, ['p2']);
});

test('unknown @mention is left in the title', () => {
  const r = parseCapture('Ping @nobody about it', projects, WED);
  assert.deepEqual(r.projectIds, []);
  assert.equal(r.title, 'Ping @nobody about it');
});

test('empty / nullish input is safe', () => {
  assert.equal(parseCapture('', [], WED).title, '');
  assert.equal(parseCapture(null, [], WED).title, '');
  assert.equal(parseCapture(undefined, [], WED).title, '');
});

test('dueReminders selects only fired-due, not-yet-notified, open tasks', () => {
  const cutoff = '2026-06-17T09:00';
  const tasks = [
    { id: 'a', status: 'todo', remind: '2026-06-17T08:00', remindedAt: null },   // due, unfired -> yes
    { id: 'b', status: 'todo', remind: '2026-06-17T10:00', remindedAt: null },   // future -> no
    { id: 'c', status: 'todo', remind: '2026-06-17T08:00', remindedAt: 'x' },    // already fired -> no
    { id: 'd', status: 'done', remind: '2026-06-17T08:00', remindedAt: null },   // done -> no
    { id: 'e', status: 'todo', remind: null, remindedAt: null },                 // no reminder -> no
  ];
  assert.deepEqual(dueReminders(tasks, cutoff).map((t) => t.id), ['a']);
});
