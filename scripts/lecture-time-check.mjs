#!/usr/bin/env node
/**
 * lecture-time-check.mjs — is a typed time saved as it was typed?
 *
 * Yariv, 2026-09-22: "מנגנון השעה לא מגיב טוב למספרים ומסובב לי את השעה". Production
 * held 23:18–00:20 for a lecture he entered as 17:00–20:00, and 00:19–00:21, 23:17–23:20:
 * clock times from around midnight — Chrome's native time picker writes the CURRENT time
 * on Enter — and an end that "wrapped" past midnight. The fields are now text boxes read
 * by one parser (src/lib/timeInput.ts); this drives the real screens and reads what each
 * SAVE actually carried, not what a field happened to display.
 *
 * Every page here runs with the clock frozen at 23:18 on the night in question, so a
 * saved value can only be the typed one.
 *
 *   LECTURES   typed like Yariv ("1700", "20"), Enter without leaving the field, 25:00
 *              refused, an end before its start refused with the evening reading
 *              offered, the damaged record itself, and no end suggested past midnight
 *   STUDENTS   the placement-interview time: "1030" saved as 10:30, "25:00" refused
 *   SLOTS      the interview-slot planner ("9" … "1030", 30 min → 3 slots) and the
 *              single-slot edit — the rows the public registration form offers
 *
 * Offline: dist/ served locally; every HTTP call off this origin is answered here and
 * every WebSocket is held in a mock, so nothing reaches the live project.
 *
 *   npx astro build && node scripts/lecture-time-check.mjs
 *   node scripts/lecture-time-check.mjs --webkit     # Safari's engine (WEBKIT_EXECUTABLE= to pick a build)
 */
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4331;
const ENGINE = process.argv.includes('--webkit') ? 'webkit' : 'chromium';

/** The minute the first damaged lecture was written. Every page runs at it. */
const THE_NIGHT = new Date('2026-09-21T23:18:00+03:00');

const COURSE = { id: 'prac', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' };
const lecture = (id, topic, date, startTime, endTime) => ({
  id, topic, date, startTime, endTime, courseId: COURSE.id, courseName: COURSE.name, year: COURSE.year,
  semester: 'א׳', type: 'הרצאה', status: 'מאושר', institution: 'אוניברסיטת אריאל',
  lecturer: 'מרצה בדיקה', lecturerPhone: '050-0000000', lecturerEmail: 'lecturer@example.com',
});

const FIXTURE = {
  courses: [COURSE],
  academicYears: [COURSE.year],
  lectures: [
    // The course's habit is three hours; the end suggestion has to learn it from these…
    lecture('lec-a', 'מפגש פתיחה', '2026-10-25', '17:00', '20:00'),
    lecture('lec-b', 'מפגש שני', '2026-11-01', '17:00', '20:00'),
    // …and learn nothing from the three damaged records, copied from production.
    lecture('lec-damaged', 'רשומה פגומה', '2026-11-08', '23:18', '00:20'),
    lecture('lec-clock1', 'שעון ראשון', '2026-11-15', '00:19', '00:21'),
    lecture('lec-clock2', 'שעון שני', '2026-11-22', '23:17', '23:20'),
  ],
  students: [{ id: 'st-iv', name: 'נועה בדיקה', email: 'noa@example.com', phone: '050-1111111',
    courseId: COURSE.id, year: COURSE.year }],
  candidates: [], employers: [], trainers: [], dispatches: [], institutions: [],
};

// As the table can hand it back — with seconds.
const SLOT_ROWS = [{ id: 'sl-1', date: '2026-10-12', start_time: '10:00:00', end_time: '10:45:00',
  capacity: 1, booked_count: 0, booked_by: null, note: null, course_name: null }];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  try { const b = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b);
  } catch {
    try { const b = await readFile(join(DIST, p, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(b);
    } catch { res.writeHead(404); res.end('nf'); }
  }
});
await new Promise(r => server.listen(PORT, r));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* Everything the app tried to write, per scenario. */
const writes = { data: [], slotPost: [], slotPatch: [], other: [] };
const everOther = [];   // writes to anything unexpected, across ALL scenarios
const sockets = [];
const resetWrites = () => { writes.data.length = 0; writes.slotPost.length = 0; writes.slotPatch.length = 0; writes.other.length = 0; };
const savedData = () => writes.data.map(b => { try { return JSON.parse(b)?.data || null; } catch { return null; } }).filter(Boolean);

const exe = ENGINE === 'chromium'
  ? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync)
  : process.env.WEBKIT_EXECUTABLE;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch(exe ? { executablePath: exe } : {});

async function open(pageKey) {
  resetWrites();
  // serviceWorkers: 'block' — the app's sw.js is not what is under test, and WebKit
  // reports its registration against a plain-http origin as a page error.
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 }, locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem', serviceWorkers: 'block' });
  await ctx.clock.setFixedTime(THE_NIGHT);
  // WebKit enforces CORS on fulfilled responses (Chromium does not), so the fixtures
  // answer as a real cross-origin API would, preflight included.
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': '*' };
  await ctx.route('**/*', route => {
    const req = route.request();
    const url = req.url(), method = req.method();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('fonts.g')) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/css', body: '' });
    if (url.includes('/rest/v1/practicum_data')) {
      if (method === 'GET') {
        const one = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
        const row = { data: FIXTURE, version: 7, updated_at: '2026-01-01T00:00:00.000Z',
          last_editor_name: 'check', last_editor_email: 'check@local' };
        return json(one ? row : [row]);
      }
      if (method === 'PATCH') { writes.data.push(req.postData() || ''); return json([{ version: 8 }]); }
    }
    if (url.includes('/rest/v1/public_interview_slots')) {
      if (method === 'GET') return json(SLOT_ROWS);
      if (method === 'POST') { writes.slotPost.push(req.postData() || ''); return json([]); }
      if (method === 'PATCH') { writes.slotPatch.push({ url, body: req.postData() || '' }); return json([]); }
    }
    // The snapshot copy every save writes is expected; anything else is not.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !url.includes('/rest/v1/practicum_snapshots')) {
      writes.other.push(`${method} ${url.split('?')[0]}`);
      everOther.push(`${method} ${url.split('?')[0]}`);
    }
    return json([]);
  });
  // Never connectToServer(): the page gets a mock socket and the live project is never dialled.
  await ctx.routeWebSocket(/.*/, ws => { sockets.push(ws.url().split('?')[0]); });
  await ctx.addInitScript((key) => {
    localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'prac', year: 'תשפ״ז' }));
    localStorage.setItem('practicum_v2_page', key);
    localStorage.setItem('practicum_theme', 'light');
  }, pageKey);
  const pg = await ctx.newPage();
  const errs = [];
  const dialogs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  pg.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });
  await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  return { ctx, pg, errs, dialogs };
}

/** Poll the captured writes until `pick` finds something, or give up. */
async function waitFor(pick, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    const hit = pick();
    if (hit) return hit;
    if (Date.now() - t0 > ms) return null;
    await new Promise(r => setTimeout(r, 100));
  }
}
const lectureSavedAs = (pred) => () => {
  for (const d of savedData()) { const l = (d.lectures || []).find(pred); if (l) return l; }
  return null;
};
const editorSaveOf = (target) => () => savedData().find(d => d.history?.[0]?.entity === 'הרצאה' && d.history?.[0]?.target === target) || null;

async function type(pg, selector, text, { replace = false } = {}) {
  const f = pg.locator(selector).first();
  await f.click();
  if (replace) await f.selectText();
  await pg.keyboard.type(text, { delay: 25 });
}

async function newLecture(pg, topic) {
  const add = pg.getByRole('button', { name: /הרצאה חדשה/ });
  const up = await add.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  if (!up) throw new Error('the lectures screen never rendered — the harness is broken, not the feature');
  await add.click();
  await pg.locator('[data-time-input="lecture-start"]').waitFor({ timeout: 10000 });
  await pg.locator('input[placeholder="למשל: בניית תכנית התערבות"]').fill(topic);
  await pg.locator('input[placeholder="שם מלא"]').fill('מרצה בדיקה');
  await pg.locator('input[placeholder="05X-XXXXXXX"]').fill('050-0000000');
  await pg.locator('input[placeholder="name@example.com"]').fill('lecturer@example.com');
}
// The open editor's own save — the modal is the fixed overlay, so a form elsewhere on the page can't be hit.
const submitEditor = (pg) => pg.locator('.fixed.inset-0 form button[type="submit"]').first().click();
const val = (pg, name) => pg.locator(`[data-time-input="${name}"]`).first().inputValue();
const textOf = async (pg, sel) => (await pg.locator(sel).first().isVisible().catch(() => false))
  ? (await pg.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim() : '';

console.log(`\nlecture-time-check — offline, ${ENGINE}, clock frozen at 23:18 on 21.9.2026\n`);

/* ── LECTURES ─────────────────────────────────────────────────────────────── */
console.log('LECTURES: typed as Yariv types — "1700", then "20"');
{
  const { ctx, pg, errs } = await open('lectures');
  await newLecture(pg, 'A · מ‑17 עד 20');
  await type(pg, '[data-time-input="lecture-start"]', '1700');
  await pg.keyboard.press('Tab');
  check('"1700" reads back as 17:00 once the field is left', await val(pg, 'lecture-start') === '17:00', await val(pg, 'lecture-start'));
  const offer = await textOf(pg, '[data-end-suggestion]');
  check('with only a start, an end is OFFERED: 20:00, the course\'s usual 3 hours', offer.includes('20:00') && offer.includes('3 שעות'), offer || '(no suggestion)');
  check('…and the two- and three-minute damaged records taught it nothing', !offer.includes('דק׳'), offer);
  check('…and nothing was filled in on its own', await val(pg, 'lecture-end') === '', `end="${await val(pg, 'lecture-end')}"`);
  await type(pg, '[data-time-input="lecture-end"]', '20');
  await pg.keyboard.press('Tab');
  check('"20" in the end reads back as 20:00 — never 00:20', await val(pg, 'lecture-end') === '20:00', await val(pg, 'lecture-end'));
  await submitEditor(pg);
  const saved = await waitFor(lectureSavedAs(l => l.topic === 'A · מ‑17 עד 20'));
  check('SAVED 17:00–20:00, exactly as typed', saved?.startTime === '17:00' && saved?.endTime === '20:00',
    saved ? `${saved.startTime}–${saved.endTime}` : '(no save)');
  check('the clock (23:18) is nowhere in what was saved', !!saved && !JSON.stringify(saved).includes('23:18'));
  check('no page errors (typed)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

console.log('\nLECTURES: Enter inside the field saves before any blur — still read, still normalised');
{
  const { ctx, pg, errs } = await open('lectures');
  await newLecture(pg, 'D · Enter');
  await type(pg, '[data-time-input="lecture-start"]', '930');
  await pg.keyboard.press('Enter');
  const saved = await waitFor(lectureSavedAs(l => l.topic === 'D · Enter'));
  check('"930" + Enter is saved as 09:30', saved?.startTime === '09:30', saved ? `start=${saved.startTime}` : '(no save)');
  check('and the untouched end stays empty, not invented', saved?.endTime === '', saved ? `end="${saved.endTime}"` : '');
  check('no page errors (Enter)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

console.log('\nLECTURES: 25:00 is refused in words, and nothing is saved');
{
  const { ctx, pg, errs } = await open('lectures');
  await newLecture(pg, 'B · 25:00');
  await type(pg, '[data-time-input="lecture-start"]', '25:00');
  await pg.keyboard.press('Tab');
  const msg = await textOf(pg, '[data-time-error="lecture-start"]');
  check('leaving the field shows why, under it', msg.includes('25') && msg.includes('23'), msg || '(no message)');
  await submitEditor(pg);
  const saved = await waitFor(lectureSavedAs(l => l.topic === 'B · 25:00'), 1500);
  check('NOTHING SAVED', !saved, saved ? `saved start=${saved.startTime}` : 'no lecture write');
  check('what was typed is still there, not replaced', await val(pg, 'lecture-start') === '25:00', await val(pg, 'lecture-start'));
  const focused = await pg.evaluate(() => document.activeElement?.id || '');
  check('the refused save puts the caret back in the bad field', focused === 'lecture-start-time', focused || '(nothing focused)');
  check('no page errors (25:00)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

console.log('\nLECTURES: an end before its start — refused; the evening reading is offered, not applied');
{
  const { ctx, pg, errs } = await open('lectures');
  await newLecture(pg, 'C · 8 בערב');
  await type(pg, '[data-time-input="lecture-start"]', '17');
  await pg.keyboard.press('Tab');
  await type(pg, '[data-time-input="lecture-end"]', '8');
  await pg.keyboard.press('Tab');
  const warn = await textOf(pg, '[data-time-range-error]');
  check('17:00 → 08:00 is called out', warn.includes('08:00') && warn.includes('17:00'), warn || '(no warning)');
  check('and 20:00 is offered', warn.includes('20:00'), warn);
  check('but NOT applied', await val(pg, 'lecture-end') === '08:00', await val(pg, 'lecture-end'));
  await submitEditor(pg);
  const early = await waitFor(lectureSavedAs(l => l.topic === 'C · 8 בערב'), 1500);
  check('NOTHING SAVED while the end is before the start', !early, early ? `${early.startTime}–${early.endTime}` : 'no lecture write');
  await pg.locator('[data-time-range-error] button').first().click();
  check('one click on the offer makes it 20:00', await val(pg, 'lecture-end') === '20:00', await val(pg, 'lecture-end'));
  await submitEditor(pg);
  const saved = await waitFor(lectureSavedAs(l => l.topic === 'C · 8 בערב'));
  check('then it saves 17:00–20:00', saved?.startTime === '17:00' && saved?.endTime === '20:00', saved ? `${saved.startTime}–${saved.endTime}` : '(no save)');
  check('no page errors (range)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

console.log('\nLECTURES: the damaged record from production, 23:18–00:20');
{
  const { ctx, pg, errs } = await open('lectures');
  const row = pg.locator('li', { hasText: 'רשומה פגומה' }).first();
  const up = await row.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  if (!up) throw new Error('the lectures list never rendered — the harness is broken, not the feature');
  await row.locator('button[title="ערוך"]').first().click();
  await pg.locator('[data-time-input="lecture-start"]').waitFor({ timeout: 10000 });
  const warn = await textOf(pg, '[data-time-range-error]');
  check('opening it says what is wrong, before anything is touched', warn.includes('00:20') && warn.includes('23:18'), warn || '(no warning)');
  await submitEditor(pg);
  const blocked = await waitFor(editorSaveOf('רשומה פגומה'), 1500);
  check('it cannot be saved again as it is', !blocked, blocked ? 'it was saved' : 'no write');
  await type(pg, '[data-time-input="lecture-start"]', '17', { replace: true });
  await pg.keyboard.press('Tab');
  await type(pg, '[data-time-input="lecture-end"]', '20', { replace: true });
  await pg.keyboard.press('Tab');
  await submitEditor(pg);
  const saved = await waitFor(editorSaveOf('רשומה פגומה'));
  const fixed = saved?.lectures?.find(l => l.id === 'lec-damaged');
  check('corrected by typing "17" and "20", it saves 17:00–20:00', fixed?.startTime === '17:00' && fixed?.endTime === '20:00',
    fixed ? `${fixed.startTime}–${fixed.endTime}` : '(no save)');
  const others = (saved?.lectures || []).filter(l => l.id !== 'lec-damaged')
    .map(l => `${l.id}:${l.startTime}–${l.endTime}`).join(' ');
  check('and no other lecture was touched by it', others === 'lec-a:17:00–20:00 lec-b:17:00–20:00 lec-clock1:00:19–00:21 lec-clock2:23:17–23:20', others);
  check('no page errors (damaged)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

console.log('\nLECTURES: no end is suggested past midnight');
{
  const { ctx, pg, errs } = await open('lectures');
  await newLecture(pg, 'F · 23');
  await type(pg, '[data-time-input="lecture-start"]', '23');
  await pg.keyboard.press('Tab');
  const note = await textOf(pg, '[data-end-suggestion]');
  check('it says the course length would run past midnight', note.includes('חצות'), note || '(nothing shown)');
  check('and offers no button to fill an end in', await pg.locator('[data-end-suggestion] button').count() === 0);
  check('no page errors (midnight)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ── STUDENTS — the placement-interview time ─────────────────────────────── */
async function openStudentInterview(pg) {
  const row = pg.locator('li[data-student-row="st-iv"]').first();
  const up = await row.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  if (!up) throw new Error('the students list never rendered — the harness is broken, not the feature');
  await row.locator('button[title="ערוך"]').first().click();
  await pg.locator('button[data-accordion="ראיון שיבוץ (רחל)"]').click();
  await pg.locator('[data-time-input="placement-interview-time"]').waitFor({ timeout: 10000 });
}
const studentSaved = (pred) => () => {
  for (const d of savedData()) { const s = (d.students || []).find(x => x.id === 'st-iv'); if (s && pred(s)) return s; }
  return null;
};

console.log('\nSTUDENTS: the placement-interview time');
{
  const { ctx, pg, errs } = await open('students');
  await openStudentInterview(pg);
  await type(pg, '[data-time-input="placement-interview-time"]', '1030');
  await pg.keyboard.press('Tab');
  check('"1030" reads back as 10:30', await val(pg, 'placement-interview-time') === '10:30', await val(pg, 'placement-interview-time'));
  await submitEditor(pg);
  const saved = await waitFor(studentSaved(s => !!s.placementInterviewTime));
  check('SAVED as 10:30', saved?.placementInterviewTime === '10:30', saved ? saved.placementInterviewTime : '(no save)');
  check('no page errors (interview time)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}
{
  const { ctx, pg, errs, dialogs } = await open('students');
  await openStudentInterview(pg);
  await type(pg, '[data-time-input="placement-interview-time"]', '25:00');
  await pg.keyboard.press('Tab');
  const msg = await textOf(pg, '[data-time-error="placement-interview-time"]');
  check('"25:00" is explained under the field', msg.includes('25'), msg || '(no message)');
  await submitEditor(pg);
  await pg.waitForTimeout(800);
  check('the save says why it stopped', dialogs.some(m => m.includes('שעת ראיון השיבוץ לא נשמרה')), dialogs.join(' | ') || '(no dialog)');
  const saved = await waitFor(studentSaved(s => !!s.placementInterviewTime), 1200);
  check('NOTHING SAVED for the interview time', !saved, saved ? `saved ${saved.placementInterviewTime}` : 'no write');
  check('no page errors (interview 25:00)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ── SLOTS — what the public registration form will offer ─────────────────── */
const slotRows = () => writes.slotPost.flatMap(b => { try { const j = JSON.parse(b); return Array.isArray(j) ? j : [j]; } catch { return []; } });

console.log('\nSLOTS: the planner — "9" to "1030", 30 minutes each');
{
  const { ctx, pg, errs } = await open('management');
  const plan = pg.getByRole('button', { name: /תכנן מועדי ראיון/ });
  const up = await plan.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  if (!up) throw new Error('the management screen never rendered — the harness is broken, not the feature');
  await plan.click();
  await type(pg, '[data-time-input="slot-day-start"]', '9', { replace: true });
  await pg.keyboard.press('Tab');
  await type(pg, '[data-time-input="slot-day-end"]', '0830', { replace: true });
  await pg.keyboard.press('Tab');
  const warn = await textOf(pg, '[data-time-range-error]');
  check('an end before the start is called out on the day', warn.includes('08:30') && warn.includes('09:00'), warn || '(no warning)');
  await pg.getByRole('button', { name: /צור .*מועדים/ }).click();
  await pg.waitForTimeout(800);
  check('and creates nothing', writes.slotPost.length === 0, `${writes.slotPost.length} insert(s)`);
  await type(pg, '[data-time-input="slot-day-end"]', '1030', { replace: true });
  await pg.keyboard.press('Tab');
  check('"9" and "1030" read back as 09:00 and 10:30',
    await val(pg, 'slot-day-start') === '09:00' && await val(pg, 'slot-day-end') === '10:30',
    `${await val(pg, 'slot-day-start')}–${await val(pg, 'slot-day-end')}`);
  await pg.locator('input[type="number"][min="5"]').first().fill('30');
  const create = pg.getByRole('button', { name: /צור 3 מועדים/ });
  check('the preview counts 3 slots', await create.count() === 1, await pg.getByRole('button', { name: /צור .*מועדים/ }).innerText().catch(() => ''));
  await create.click();
  await waitFor(() => slotRows().length >= 3);
  const got = slotRows().map(r => `${r.start_time}–${r.end_time}`).join(' ');
  check('INSERTED 09:00–09:30, 09:30–10:00, 10:00–10:30', got === '09:00–09:30 09:30–10:00 10:00–10:30', got || '(no insert)');
  check('no page errors (planner)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

console.log('\nSLOTS: editing one slot');
{
  const { ctx, pg, errs } = await open('management');
  const pencil = pg.getByRole('button', { name: '✎' }).first();
  const up = await pencil.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  if (!up) throw new Error('the slot list never rendered — the harness is broken, not the feature');
  await pencil.click();
  check('"10:00:00" from the table is shown as 10:00', await val(pg, 'slot-edit-start') === '10:00', await val(pg, 'slot-edit-start'));
  const saveBtn = pg.locator('[data-time-input="slot-edit-start"]').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
    .getByRole('button', { name: 'שמור', exact: true });
  await type(pg, '[data-time-input="slot-edit-start"]', '1100', { replace: true });
  await pg.keyboard.press('Tab');
  await type(pg, '[data-time-input="slot-edit-end"]', '0930', { replace: true });
  await pg.keyboard.press('Tab');
  await saveBtn.click();
  await pg.waitForTimeout(800);
  const warn = await textOf(pg, '[data-time-range-error]');
  check('11:00 → 09:30 is refused on the row', warn.includes('09:30') && warn.includes('11:00'), warn || '(no warning)');
  check('and the slot is NOT written', writes.slotPatch.length === 0, `${writes.slotPatch.length} update(s)`);
  await type(pg, '[data-time-input="slot-edit-end"]', '1145', { replace: true });
  await pg.keyboard.press('Tab');
  await saveBtn.click();
  const patch = await waitFor(() => writes.slotPatch[0] || null);
  let body = {};
  try { body = JSON.parse(patch?.body || '{}'); } catch {}
  check('UPDATED to 11:00–11:45', body.start_time === '11:00' && body.end_time === '11:45', patch?.body || '(no update)');
  check('…on that slot only', (patch?.url || '').includes('id=eq.sl-1'), (patch?.url || '').split('?')[1] || '');
  check('no page errors (slot edit)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

console.log('\nOFFLINE');
check('no write went anywhere unexpected, in any scenario', everOther.length === 0, everOther.slice(0, 3).join(' | ') || 'none');
console.log(`  · ${sockets.length} WebSocket(s) the app opened were held in a mock${sockets.length ? ` (${[...new Set(sockets)].join(', ')})` : ''}`);

await browser.close();
server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(`FAILED: ${failed.map(f => f.name).join(', ')}\n`); process.exit(1); }
console.log('');
