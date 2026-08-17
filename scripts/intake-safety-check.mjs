#!/usr/bin/env node
/**
 * intake-safety-check.mjs — can a person be marked "taken in" without being taken in?
 *
 * The failure this guards against: acceptSelected awaited the intake, ignored what
 * it returned (nothing), and stamped the submission processed:true regardless. A
 * save that failed therefore produced a submission badged נקלט with no candidate
 * behind it — and because accept only ever ran on UNstamped rows, there was no way
 * back from the screen. The person was filed as handled and did not exist.
 *
 * Three things are asserted here, and the middle one is the whole release:
 *   ORPHAN-FLAGGED   a stamped submission with no candidate is surfaced, by name
 *   FAILED-NO-STAMP  when the save fails, NO stamp is written — provable by the
 *                    absence of a PATCH to candidate_submissions
 *   OK-STAMPS        when the save succeeds, the stamp IS written
 *
 * Offline: dist/ is served locally and every off-origin call is answered here, so
 * the "failed save" is simulated by refusing the write rather than by breaking
 * anything real. No live data is touched.
 *
 *   npx astro build && node scripts/intake-safety-check.mjs
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4328;

/* Two submissions, chosen so every assertion has a positive and a negative case:
   רות = never taken in (the one we try to accept)
   עדי = stamped נקלט, but no candidate carries her email or name — the orphan */
const SUBMISSIONS = [
  { id: 'sub-new', name: 'רות אלון', phone: '052-1112222', email: 'ruth@example.com',
    city: 'תל אביב', course_name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
    cv_file_path: 'ruth/cv.pdf', application_file_path: null,
    notes: 'בחר מועד ראיון: 2026-08-24 10:00–10:45', questionnaire: { gpa: '88' },
    submitted_at: '2026-08-14T09:00:00.000Z', processed: false },
  { id: 'sub-orphan', name: 'עדי חסידי', phone: '052-4500469', email: 'adi@example.com',
    city: 'רמת גן', course_name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
    cv_file_path: 'adi/cv.pdf', application_file_path: null,
    notes: 'בחר מועד ראיון: 2026-08-17 16:30–17:00', questionnaire: { gpa: '86' },
    submitted_at: '2026-08-10T09:00:00.000Z', processed: true },
];

const FIXTURE = {
  courses: [{ id: 'practicum-hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }],
  academicYears: ['תשפ״ז'],
  candidates: [
    { id: 'c1', name: 'מאיה בר', email: 'maya@example.com', courseId: 'practicum-hr', year: 'תשפ״ז', interviewResult: 'pending' },
    { id: 'c2', name: 'רון שגב', email: 'ron@example.com', courseId: 'practicum-hr', year: 'תשפ״ז', interviewResult: 'pending' },
  ],
  students: [], employers: [], trainers: [], lectures: [], dispatches: [], institutions: [],
};

/* Flipped between phases: does the practicum_data write succeed? */
let allowSave = false;
/* Every stamp attempt the app makes, so "it did not stamp" is provable. */
const stampCalls = [];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const b = await readFile(join(DIST, p));
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

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 } });

await ctx.route('**/*', route => {
  const req = route.request();
  const url = req.url();
  const method = req.method();
  if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
  const json = (body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (url.includes('candidate_submissions')) {
    if (method === 'GET') return json(SUBMISSIONS);
    if (method === 'PATCH') {                    // ← the stamp
      stampCalls.push({ url, body: req.postData() || '' });
      return json([{ id: 'x' }]);
    }
    return json([]);
  }
  if (url.includes('practicum_data')) {
    if (method === 'GET') {
      const one = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
      const row = { data: FIXTURE, version: 7, updated_at: '2026-01-01T00:00:00.000Z',
        last_editor_name: 'check', last_editor_email: 'check@local' };
      return json(one ? row : [row]);
    }
    if (method === 'PATCH') {
      // The simulated outage. Refusing the write is what a dropped connection or a
      // rejected policy looks like from the app's side.
      return allowSave ? json([{ version: 8 }]) : json({ message: 'simulated write failure' }, 500);
    }
  }
  if (url.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  return json([]);
});

await ctx.addInitScript(() => {
  localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'practicum-hr', year: 'תשפ״ז' }));
  localStorage.setItem('practicum_v2_page', 'candidates');
  localStorage.setItem('practicum_theme', 'light');
});

const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(String(e)));
pg.on('dialog', d => d.accept());

console.log('\nintake-safety-check — offline, real candidates screen\n');

await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await pg.waitForSelector('[data-inbox-cb]', { timeout: 15000 }).catch(() => {});
await pg.waitForTimeout(1200);

/* ── ORPHAN-FLAGGED ──────────────────────────────────────────────────────── */
console.log('ORPHAN-FLAGGED: someone stamped נקלט with no candidate card is surfaced');
{
  const notice = await pg.$('[data-inbox-orphans]');
  check('the inbox raises the orphan notice', !!notice);
  if (notice) {
    const text = (await notice.textContent() || '').replace(/\s+/g, ' ').trim();
    check('it counts exactly one', (await notice.getAttribute('data-inbox-orphans')) === '1',
      `data-inbox-orphans=${await notice.getAttribute('data-inbox-orphans')}`);
    check('it names her', text.includes('עדי חסידי'), text.slice(0, 90));
    check('it does not accuse — it offers both explanations',
      text.includes('נמחק') && text.includes('לא הושלמה'));
  }
  // The already-taken-in candidates must NOT be flagged.
  check('nobody else is flagged', !(await pg.$eval('[data-inbox-orphans]',
    el => el.textContent.includes('מאיה') || el.textContent.includes('רון')).catch(() => false)));
}

/* ── FAILED-NO-STAMP — the release ───────────────────────────────────────── */
console.log('\nFAILED-NO-STAMP: a save that fails must leave the submission untouched');
{
  allowSave = false;
  stampCalls.length = 0;
  // Select רות (the unprocessed one) and take her in.
  const boxes = await pg.$$('[data-inbox-cb]');
  check('there are submissions to select', boxes.length > 0, `${boxes.length} rows`);
  await boxes[0].check();
  await pg.waitForTimeout(200);
  const acceptBtn = await pg.$('button:has-text("קלוט למערכת")');
  check('the accept button is offered', !!acceptBtn);
  if (acceptBtn) {
    await acceptBtn.click();
    await pg.waitForTimeout(2500);
    check('NO stamp was written', stampCalls.length === 0,
      stampCalls.length ? `${stampCalls.length} PATCH(es) to candidate_submissions` : 'zero PATCHes');
    const msg = await pg.$eval('[data-inbox-accept-msg]', el => el.textContent.trim()).catch(() => '');
    check('the failure is reported on screen', msg.includes('נעצר') || msg.includes('נכשל'), msg.slice(0, 80) || '(no message)');
    check('and it says it can be retried', msg.includes('לנסות שוב'), msg.slice(0, 80));
  }
}

/* ── OK-STAMPS ───────────────────────────────────────────────────────────── */
console.log('\nOK-STAMPS: when the save succeeds, the stamp is written');
{
  allowSave = true;
  stampCalls.length = 0;
  const boxes = await pg.$$('[data-inbox-cb]');
  const checked = await pg.$$eval('[data-inbox-cb]', els => els.filter(e => e.checked).length);
  if (checked === 0 && boxes.length) await boxes[0].check();   // selection is kept on failure, but be explicit
  await pg.waitForTimeout(200);
  const acceptBtn = await pg.$('button:has-text("קלוט למערכת")');
  if (acceptBtn) {
    await acceptBtn.click();
    await pg.waitForTimeout(2500);
    check('the stamp WAS written', stampCalls.length > 0, `${stampCalls.length} PATCH(es)`);
    check('and it marks it processed', stampCalls.some(c => (c.body || '').includes('processed')),
      (stampCalls[0]?.body || '').slice(0, 60));
  }
}

check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

await browser.close();
server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(`FAILED: ${failed.map(f => f.name).join(', ')}\n`); process.exit(1); }
console.log('');
