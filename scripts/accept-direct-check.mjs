#!/usr/bin/env node
/**
 * accept-direct-check.mjs — a student the organization already took can be marked placed.
 *
 * Yariv 2026-10-04: "אי אפשר לאשר סטודנט שהתקבל לפרקטיקום את המקום — הכפתור לא לחיץ".
 * A ranked org that no CV was sent to through the app offered exactly one action, "שלח
 * קו״ח", and with no updated CV on file it is greyed out. The only "approve" — "כבר
 * במגעים — אשר שיבוץ" — existed for orgs the student suggested herself. So a student
 * the org had ALREADY accepted could not be marked נקלט from the card at all; he got
 * there only by editing fields and saving.
 *
 * This opens the real students screen, offline, on exactly that student: no updated
 * CV, one tentative org with a free place. It asserts the send stays blocked (that rule
 * is right), the new "✓ התקבל/ה — אשר שיבוץ" is there and clickable, and the write it
 * makes marks the student placed and takes the place.
 *
 *   npx astro build && node scripts/accept-direct-check.mjs
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4331;
const ORG = 'מרכז רפואי שמיר';

const FIXTURE = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }],
  academicYears: ['תשפ״ז'],
  candidates: [],
  students: [
    { id: 'st1', name: 'נועה ברק', email: 'noa@example.com', courseId: 'hr', year: 'תשפ״ז',
      /* no cvUpdatedUrl — the case on his screen */
      preferences: [{ rank: 1, orgName: ORG, employerId: 'e1', status: 'tentative' }] },
  ],
  employers: [
    { id: 'e1', name: ORG, courseId: 'hr', courseIds: ['hr'], year: 'תשפ״ז', approvalStatus: 'approved',
      contactPhone: '0501112222', contactEmail: 'hr@shamir.example',
      vacancySlots: [{ id: 'e1-s1', courseId: 'hr', status: 'available', studentId: null }],
      positionsTotal: 1, positions: 1, filledPositions: 0 },
  ],
  dispatches: [], trainers: [], lectures: [], institutions: [],
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const b = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(PORT, r));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
             '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });

let current = FIXTURE, version = 1;
const writes = [];
await ctx.route('**/*', async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
  if (url.includes('practicum_data')) {
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: current, version, updated_at: '2026-01-01T00:00:00.000Z',
          last_editor_name: 'check', last_editor_email: 'check@local' }) });
    }
    if (req.method() === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      writes.push(body);
      if (body.data) { current = body.data; version = body.version || version + 1; }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ version }]) });
    }
  }
  if (url.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await ctx.addInitScript(() => {
  localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr', year: 'תשפ״ז' }));
  localStorage.setItem('practicum_v2_page', 'students');
  localStorage.setItem('practicum_theme', 'light');
});
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(String(e.message || e)));
pg.on('dialog', (d) => d.accept());

console.log('\naccept-direct-check — offline, real students screen\n');
await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await pg.waitForSelector('[data-student-row="st1"]', { timeout: 15000 }).catch(() => {});
await pg.locator('[data-student-row="st1"] button[title="ערוך"]').first().click().catch(() => {});
await pg.waitForSelector('[data-send-cv]', { timeout: 10000 }).catch(() => {});

const send = await pg.evaluate(() => {
  const b = document.querySelector('[data-send-cv]');
  return b ? { disabled: b.disabled } : null;
});
check('the card shows the ranked org', !!send, send ? 'send-CV control present' : 'card did not open');
check('sending a CV is still blocked without an updated CV (that rule stands)', !!send && send.disabled, send ? `disabled=${send.disabled}` : '');

const accept = pg.locator('[data-accept-direct]');
const n = await accept.count();
check('THE FIX — "✓ התקבל/ה — אשר שיבוץ" is offered for that org', n === 1, `${n} button(s)`);
const enabled = n === 1 && await accept.isEnabled();
check('and it can be pressed', enabled, enabled ? 'enabled' : 'disabled or missing');

if (enabled) {
  await accept.click();
  const confirm = pg.locator('[data-confirm-action="place_direct"]');
  await confirm.waitFor({ timeout: 5000 }).catch(() => {});
  check('it asks first, naming the org', await confirm.count() === 1
    && (await pg.locator('text=' + ORG).count()) > 0, 'confirm dialog');
  await confirm.click().catch(() => {});
  await pg.waitForTimeout(1500);
}

const last = writes.at(-1)?.data;
const st = last?.students?.find((s) => s.id === 'st1');
const emp = last?.employers?.find((e) => e.id === 'e1');
check('a write was made', !!last, `${writes.length} write(s)`);
check('the student is now placed, at that org', st?.submissionStatus === 'placed' && st?.acceptedOrg === ORG,
  st ? `status=${st.submissionStatus} acceptedOrg=${st.acceptedOrg}` : 'student missing');
check('and the place is taken for her', emp?.vacancySlots?.[0]?.status === 'placed' && emp?.vacancySlots?.[0]?.studentId === 'st1',
  emp ? JSON.stringify(emp.vacancySlots?.[0]) : 'employer missing');
check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));

await browser.close();
server.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`\n❌ ${failed.length} failed: ${failed.map((f) => f.name).join(' · ')}`); process.exit(1); }
console.log('✅ accept-direct-check passed');
