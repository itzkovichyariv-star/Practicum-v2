#!/usr/bin/env node
/**
 * interview-cancel-check.mjs — when a candidate withdraws, does their time
 * actually go back on sale?
 *
 * Booking adds one to booked_count and writes the name on the slot. Nothing in
 * the system ever subtracted, so a withdrawal left the time held by someone who
 * was not coming and the only way to reopen it was to delete the slot in ניהול
 * and rebuild it by hand.
 *
 * Three phases, and the last two matter more than the first:
 *   RELEASE      the slot is released, the submission marked cancelled, the
 *                candidate removed — in that order
 *   CONTENTION   if the guarded release matches nothing (someone booked in the
 *                same moment), NOTHING else happens: no cancelled marker, and
 *                above all the candidate is not deleted
 *   AMBIGUOUS    two slots fit the same day and time, so it refuses to guess —
 *                releasing the wrong one would let two people book one interview
 *
 * Offline: dist/ served locally, every off-origin call answered here. No live
 * data is touched and no message is sent to anyone.
 *
 *   npx astro build && node scripts/interview-cancel-check.mjs
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4329;

const DAY = '2026-08-24';
const CAND = { id: 'c1', name: 'מאיה בר', phone: '052-1234567', email: 'maya@example.com',
  courseId: 'practicum-hr', year: 'תשפ״ז', interviewDate: DAY, interviewTime: '10:00–10:45',
  interviewResult: 'pending', cvUrl: 'https://example.com/cv.pdf',
  // Present so App's questionnaire backfill has nothing to do. Without it that
  // effect saves the whole snapshot on load, and a test that COUNTS writes would
  // be reading someone else's write as a deletion.
  questionnaire: { gpa: '90' } };

const FIXTURE = {
  courses: [{ id: 'practicum-hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }],
  academicYears: ['תשפ״ז'],
  candidates: [CAND,
    { id: 'c2', name: 'רון שגב', email: 'ron@example.com', courseId: 'practicum-hr', year: 'תשפ״ז', interviewResult: 'pending' }],
  students: [], employers: [], trainers: [], lectures: [], dispatches: [], institutions: [],
};

const SUBMISSION = { id: 'sub-maya', name: 'מאיה בר', phone: '052-1234567', email: 'maya@example.com',
  city: 'חיפה', course_name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
  cv_file_path: 'maya/cv.pdf', application_file_path: null,
  notes: `בחר מועד ראיון: ${DAY} 10:00–10:45`, questionnaire: { gpa: '90' },
  submitted_at: '2026-08-10T09:00:00.000Z', processed: true };

/* Per-phase switches */
let mode = 'release';                 // 'release' | 'contention' | 'ambiguous'
const patches = { slots: [], subs: [], data: [] };

const slotRows = () => mode === 'ambiguous'
  // Two slots, same day AND same start time, neither carrying her name — nothing
  // in the data says which one is hers.
  ? [{ id: 'sl-a', date: DAY, start_time: '10:00', end_time: '10:45', capacity: 1, booked_count: 1, booked_by: null },
     { id: 'sl-b', date: DAY, start_time: '10:00', end_time: '10:45', capacity: 1, booked_count: 1, booked_by: null }]
  : [{ id: 'sl-a', date: DAY, start_time: '10:00', end_time: '10:45', capacity: 1, booked_count: 1, booked_by: 'מאיה בר' },
     { id: 'sl-b', date: DAY, start_time: '11:00', end_time: '11:45', capacity: 2, booked_count: 0, booked_by: null }];

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

/**
 * Did any snapshot write actually drop her from the candidates array?
 *
 * Asked of the CONTENT, not of the number of writes: the app saves for its own
 * reasons (a questionnaire backfill, for one), and her name also appears in the
 * history entry of the very write that removes her. Only the array answers it.
 */
const candidateWasRemoved = () => patches.data.some(p => {
  try {
    const cs = JSON.parse(p.body)?.data?.candidates;
    return Array.isArray(cs) && !cs.some(c => c?.name === CAND.name);
  } catch { return false; }
});

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
  const url = req.url(), method = req.method();
  if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
  const json = (body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (url.includes('public_interview_slots')) {
    if (method === 'GET') return json(slotRows());
    if (method === 'PATCH') {
      patches.slots.push({ url, body: req.postData() || '' });
      // CONTENTION: the guard matches nothing, exactly as it would if someone
      // booked the same slot a moment earlier.
      return json(mode === 'contention' ? [] : [{ id: 'sl-a' }]);
    }
    return json([]);
  }
  if (url.includes('candidate_submissions')) {
    if (method === 'GET') return json([SUBMISSION]);
    if (method === 'PATCH') { patches.subs.push({ url, body: req.postData() || '' }); return json([{ id: 'x' }]); }
    return json([]);
  }
  if (url.includes('practicum_data')) {
    if (method === 'GET') {
      const one = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
      const row = { data: FIXTURE, version: 7, updated_at: '2026-01-01T00:00:00.000Z',
        last_editor_name: 'check', last_editor_email: 'check@local' };
      return json(one ? row : [row]);
    }
    if (method === 'PATCH') { patches.data.push({ body: req.postData() || '' }); return json([{ version: 8 }]); }
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

let dialogMsg = '';
async function runCancel(accept = true) {
  patches.slots.length = 0; patches.subs.length = 0; patches.data.length = 0;
  dialogMsg = '';
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  pg.on('dialog', d => { dialogMsg = d.message(); accept ? d.accept() : d.dismiss(); });
  await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  // Wait for the island to hydrate and paint the list. `networkidle` returns before
  // React has mounted, and a silent catch here used to let every assertion below
  // "fail" for the sole reason that nothing had rendered yet.
  const rowsUp = await pg.waitForSelector('li[data-info-row]', { timeout: 30000 }).then(() => true).catch(() => false);
  if (!rowsUp) throw new Error('candidate rows never rendered — the harness is broken, not the feature');
  const btn = await pg.waitForSelector('[data-cancel-interview]', { timeout: 10000 }).catch(() => null);
  if (btn) { await btn.click({ force: true }); await pg.waitForTimeout(2500); }
  return { pg, errs, had: !!btn };
}

console.log('\ninterview-cancel-check — offline, real candidates screen\n');

/* ── RELEASE ─────────────────────────────────────────────────────────────── */
console.log('RELEASE: the slot goes back on sale, in the right order');
{
  mode = 'release';
  const { pg, errs, had } = await runCancel();
  check('the cancel action is offered on a candidate with an interview', had);
  check('it says which slot will be freed', dialogMsg.includes('10:00') && dialogMsg.includes('תשוחרר'),
    dialogMsg.split('\n').find(l => l.includes('משבצת')) || '(none)');
  check('it warns the card will be deleted', dialogMsg.includes('יימחק'));

  check('the slot was released', patches.slots.length === 1, `${patches.slots.length} PATCH(es)`);
  const body = patches.slots[0]?.body || '';
  check('booked_count went down to 0', body.includes('"booked_count":0'), body.slice(0, 60));
  check('and the name was cleared', body.includes('"booked_by":null'), body.slice(0, 60));
  check('the write was guarded on the count it had read',
    (patches.slots[0]?.url || '').includes('booked_count=eq.1'),
    (patches.slots[0]?.url || '').split('?')[1] || '');

  check('the submission was marked cancelled', patches.subs.some(p => p.body.includes('בוטל')),
    (patches.subs[0]?.body || '').slice(0, 60) || '(no submission PATCH)');
  check('the candidate was removed', candidateWasRemoved(), `${patches.data.length} data write(s)`);
  check('no page errors (release)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await pg.close();
}

/* ── CONTENTION — the one that must not half-happen ──────────────────────── */
console.log('\nCONTENTION: if the slot moved under us, nothing else happens');
{
  mode = 'contention';
  const { pg, errs } = await runCancel();
  check('it still tried to release', patches.slots.length === 1, `${patches.slots.length} PATCH(es)`);
  check('the submission was NOT marked cancelled', patches.subs.length === 0,
    `${patches.subs.length} submission PATCH(es)`);
  check('THE CANDIDATE WAS NOT DELETED', !candidateWasRemoved(),
    candidateWasRemoved() ? 'a write dropped her from the list anyway' : 'she is still in every write');
  const toast = await pg.$eval('body', b => b.innerText).catch(() => '');
  check('it says the cancellation was stopped', toast.includes('הופסק') || toast.includes('נסה'),
    toast.split('\n').find(l => l.includes('הופסק') || l.includes('נסה'))?.slice(0, 70) || '(no message)');
  check('no page errors (contention)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await pg.close();
}

/* ── AMBIGUOUS — never guess which slot is theirs ────────────────────────── */
console.log('\nAMBIGUOUS: two slots fit — refuse rather than free the wrong one');
{
  mode = 'ambiguous';
  const { pg, errs } = await runCancel();
  check('the warning says it cannot tell them apart', dialogMsg.includes('לא ניתן לזהות'),
    dialogMsg.split('\n').find(l => l.includes('משבצות'))?.slice(0, 90) || '(none)');
  check('it points at the manual way out', dialogMsg.includes('מועדי ראיון'));
  check('NO slot was released', patches.slots.length === 0,
    patches.slots.length ? 'a slot was freed on a guess' : 'none');
  // The cancellation itself still goes through: the coordinator was told in plain
  // words that no slot would be freed and confirmed anyway. Refusing outright
  // would leave them unable to cancel at all.
  check('the cancellation still completes, having been confirmed', candidateWasRemoved());
  check('no page errors (ambiguous)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await pg.close();
}

await browser.close();
server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(`FAILED: ${failed.map(f => f.name).join(', ')}\n`); process.exit(1); }
console.log('');
