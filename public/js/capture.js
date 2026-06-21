/* ============================================================ Helm capture
 * Pure quick-capture parsing + reminder selection, shared by the browser app
 * (loaded as a <script>, attaches window.HelmCapture) and the test suite
 * (require()'d in Node). No DOM, no globals — everything is passed in, so it's
 * trivially unit-testable. Syntax:
 *   Renew SSL certs @Infra #security !high ^fri
 *   @project  #tag  !critical/!high/!medium/!low  ^today ^tomorrow ^fri ^eom ^2026-07-01
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HelmCapture = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var PRIO_MAP = {
    critical: 'critical', crit: 'critical', '1': 'critical',
    high: 'high', hi: 'high', '2': 'high',
    med: 'medium', medium: 'medium', '3': 'medium',
    low: 'low', '4': 'low',
  };

  function ymd(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function addDays(base, n) {
    var d = new Date(base.getTime());
    d.setDate(d.getDate() + n);
    return ymd(d);
  }

  // parseCapture(text, projects, now)
  //   projects: array of {id, name, status} for @mentions (optional)
  //   now: Date to evaluate relative dates against (optional; defaults to today)
  function parseCapture(text, projects, now) {
    projects = projects || [];
    now = now || new Date();
    var out = { title: '', tags: [], projectIds: [], priority: 'medium', due: null, today: false };
    var leftovers = [];
    var toks = String(text == null ? '' : text).split(/\s+/);
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (!tok) continue;
      if (tok[0] === '#' && tok.length > 1) { out.tags.push(tok.slice(1).toLowerCase()); continue; }
      if (tok[0] === '!' && tok.length > 1) {
        var pv = tok.slice(1).toLowerCase();
        if (PRIO_MAP[pv]) { out.priority = PRIO_MAP[pv]; continue; }
      }
      if (tok[0] === '@' && tok.length > 1) {
        var q = tok.slice(1).toLowerCase();
        var p = null;
        for (var a = 0; a < projects.length; a++) {
          var pr = projects[a];
          if (pr.status !== 'archived' && pr.name.toLowerCase().replace(/\s+/g, '').indexOf(q) === 0) { p = pr; break; }
        }
        if (!p) {
          for (var b = 0; b < projects.length; b++) {
            if (projects[b].name.toLowerCase().indexOf(q) >= 0) { p = projects[b]; break; }
          }
        }
        if (p) { out.projectIds.push(p.id); out._projName = p.name; continue; }
      }
      if (tok[0] === '^' && tok.length > 1) {
        var v = tok.slice(1).toLowerCase();
        if (v === 'today') { out.due = ymd(now); out.today = true; continue; }
        if (v === 'tomorrow' || v === 'tom') { out.due = addDays(now, 1); continue; }
        if (v === 'nextweek' || v === 'week') { out.due = addDays(now, 7); continue; }
        if (v === 'eom') { out.due = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)); continue; }
        var wd = -1;
        for (var w = 0; w < WEEKDAYS.length; w++) { if (v.indexOf(WEEKDAYS[w]) === 0) { wd = w; break; } }
        if (wd >= 0) {
          var n = (wd - now.getDay() + 7) % 7; if (n === 0) n = 7;
          out.due = addDays(now, n); continue;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { out.due = v; continue; }
      }
      leftovers.push(tok);
    }
    out.title = leftovers.join(' ');
    return out;
  }

  // Tasks whose reminder has come due and hasn't fired yet.
  //   cutoff: local "YYYY-MM-DDTHH:MM" string (compare lexicographically)
  function dueReminders(tasks, cutoff) {
    return (tasks || []).filter(function (t) {
      return t.status !== 'done' && t.remind && !t.remindedAt && t.remind <= cutoff;
    });
  }

  return { parseCapture: parseCapture, dueReminders: dueReminders, WEEKDAYS: WEEKDAYS };
});
