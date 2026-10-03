#!/usr/bin/env node
/**
 * simulations-2026-10-03.mjs — put every simulation of תשפ״ז on the books, as Yariv set them.
 *
 * Yariv 2026-10-03:
 *   סמסטר א׳ (מיומנויות א׳) — back to the evening, on Zoom; ALL "טעון אישור" until מרכז
 *   הסימולציות confirms:
 *     8.12 שחקנית · 15.12 שחקן — the planned ones (were 15:00 with a class swap);
 *     24.11 שחקנית · 1.12 שחקן — tentative; "כנראה לא אנצל אבל חשוב שיהיו בלו״ז כדי שאדע לבטל".
 *   סמסטר ב׳ (מיומנויות ב׳) — 15:00, ALL approved; he cancels near the date if unneeded:
 *     9.3 שחקן · 16.3 שחקנית · 23.3 שחקן.
 *
 * For each date: the simulation lecture already there (lecturer/topic says סימולצי…) is
 * updated in place; a missing one is created from that semester's existing simulation
 * (same course, lecturer, contacts). Nothing else is touched.
 *
 *   node scripts/simulations-2026-10-03.mjs           # DRY RUN — prints what it would do
 *   node scripts/simulations-2026-10-03.mjs --apply   # snapshot first, then one guarded write
 *
 * Then: app → לוח שנה → ↻ סנכרן לגוגל.
 * Rollback: ניהול → גרסאות → "לפני עדכון סימולציות 3.10".
 */

const SB = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const KEY = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const APPLY = process.argv.includes('--apply');

const PENDING = 'ממתין לאישור';
const APPROVED = 'מאושר';
const SEM_A = { start: '19:00', end: '20:30', status: PENDING, location: 'זום' };
const SEM_B = { start: '15:00', end: '16:30', status: APPROVED };

const PLAN = [
  { date: '2026-11-24', sem: 'A', who: 'שחקנית', note: 'טנטטיבי — כנראה לא ננצל; לבטל מול מרכז הסימולציות אם לא' },
  { date: '2026-12-01', sem: 'A', who: 'שחקן', note: 'טנטטיבי — כנראה לא ננצל; לבטל מול מרכז הסימולציות אם לא' },
  { date: '2026-12-08', sem: 'A', who: 'שחקנית', note: 'הוחזר לערב, בזום — טעון אישור מרכז הסימולציות' },
  { date: '2026-12-15', sem: 'A', who: 'שחקן', note: 'הוחזר לערב, בזום — טעון אישור מרכז הסימולציות' },
  { date: '2027-03-09', sem: 'B', who: 'שחקן', note: 'מאושר; לבטל לקראת המועד אם לא נדרש' },
  { date: '2027-03-16', sem: 'B', who: 'שחקנית', note: 'מאושר; לבטל לקראת המועד אם לא נדרש' },
  { date: '2027-03-23', sem: 'B', who: 'שחקן', note: 'מאושר; לבטל לקראת המועד אם לא נדרש' },
];

const isSim = (l) => /סימולצי/.test(`${l.lecturer || ''} ${l.topic || ''} ${l.title || ''}`);
const live = (l) => (l.status || '').trim() !== 'בוטל';
const randomId = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
const show = (l) => `${l.date} ${l.startTime || '?'}–${l.endTime || '?'} · ${l.status || '—'} · ${l.topic || l.title || ''} — ${l.lecturer || ''}${l.location ? ` · ${l.location}` : ''}${l.notes ? `\n              הערות: ${l.notes}` : ''}`;

const r = await fetch(`${SB}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: H });
if (!r.ok) { console.log(`read failed: HTTP ${r.status} ${await r.text()}`); process.exit(1); }
const [row] = await r.json();
const data = row.data || {};
const version = row.version;
const lectures = [...(data.lectures || [])];

const sims = lectures.filter((l) => isSim(l) && live(l));
const template = (sem) => {
  const pool = sims.filter((l) => (sem === 'A' ? l.date < '2027-02-01' : l.date >= '2027-02-01'));
  return pool.sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
};
const tplA = template('A'), tplB = template('B');
console.log(`MODE: ${APPLY ? '*** APPLY ***' : 'DRY RUN (nothing is written)'} · data version ${version}`);
console.log(`simulations on the books now: ${sims.length}`);
if (!tplA || !tplB) {
  console.log(`ABORT: need one existing simulation per semester to copy course/contacts from (A: ${!!tplA}, B: ${!!tplB}).`);
  process.exit(1);
}
console.log(`template A: ${show(tplA)}\ntemplate B: ${show(tplB)}\n`);

let changes = 0;
for (const p of PLAN) {
  const want = p.sem === 'A' ? SEM_A : SEM_B;
  const tpl = p.sem === 'A' ? tplA : tplB;
  const here = sims.filter((l) => l.date === p.date);
  const noteLine = `${p.who} · ${p.note} (3.10.2026)`;
  if (here.length > 1) { console.log(`✗ ${p.date}: ${here.length} simulations on this date — fix by hand, skipped`); continue; }
  if (here.length === 1) {
    const l = here[0];
    const next = {
      ...l, startTime: want.start, endTime: want.end, status: want.status,
      ...(want.location ? { location: want.location } : {}),
      notes: (l.notes || '').includes(noteLine) ? l.notes : [l.notes, noteLine].filter(Boolean).join(' | '),
    };
    const same = ['startTime', 'endTime', 'status', 'location', 'notes'].every((k) => (l[k] || '') === (next[k] || ''));
    if (same) { console.log(`= ${p.date}: already as asked`); continue; }
    console.log(`~ ${p.date}\n    before: ${show(l)}\n    after : ${show(next)}`);
    lectures[lectures.indexOf(l)] = next;
    changes++;
  } else {
    const { graphEventId, ...base } = tpl;
    const created = {
      ...base, id: randomId('lec'), date: p.date, startTime: want.start, endTime: want.end, status: want.status,
      ...(want.location ? { location: want.location } : {}), notes: noteLine,
    };
    console.log(`+ ${p.date}: ${show(created)}`);
    lectures.push(created);
    changes++;
  }
}

if (!changes) { console.log('\nNothing to change.'); process.exit(0); }
if (!APPLY) { console.log(`\nDRY RUN: ${changes} change(s). Re-run with --apply to write exactly these.`); process.exit(0); }

const snap = await fetch(`${SB}/rest/v1/practicum_snapshots`, {
  method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
  body: JSON.stringify({ editor_name: 'יריב', action: 'לפני עדכון סימולציות 3.10', entity: 'הרצאות',
    target: `${changes} סימולציות`, version, data }),
});
if (!snap.ok) { console.log(`ABORT: snapshot failed (HTTP ${snap.status}) — nothing written.`); process.exit(1); }
const upd = await fetch(`${SB}/rest/v1/practicum_data?org_id=eq.default&version=eq.${version}`, {
  method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ data: { ...data, lectures }, updated_at: new Date().toISOString(), last_editor_name: 'יריב', version: version + 1 }),
});
const rows = await upd.json();
if (!Array.isArray(rows) || rows.length === 0) { console.log('ABORT: someone saved meanwhile (version changed). Nothing written — re-run.'); process.exit(1); }
console.log(`\nDone: ${changes} change(s) → version ${version + 1}. Now: app → לוח שנה → ↻ סנכרן לגוגל.`);
