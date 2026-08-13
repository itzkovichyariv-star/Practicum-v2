#!/usr/bin/env node
/**
 * students-dom-baseline.mjs — dumps the rendered students screen to a stable
 * string so a change elsewhere can be PROVEN not to have touched it.
 *
 * Run once on the baseline and once on the branch, then diff the two files:
 *
 *   git stash && npx astro build && node scripts/students-dom-baseline.mjs before
 *   git stash pop && npx astro build && node scripts/students-dom-baseline.mjs after
 *   diff scripts/.preview/students-before.html scripts/.preview/students-after.html
 *
 * Fixture-backed and fully offline, like preview-candidates.mjs — it never reads
 * or writes the live project.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const TAG = process.argv[2] || 'dump';
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'scripts', '.preview');
const PORT = 4320;

const FIXTURE = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז' }],
  academicYears: ['תשפ״ז'],
  candidates: [
    { id: 'c1', name: 'דנה כהן', phone: '052-1234567', email: 'dana@example.com',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: 'https://example.com/dana-cv.pdf',
      applicationUrl: 'https://example.com/dana-form.pdf', interviewConducted: true,
      interviewResult: 'passed', interviewSummary: 'מוטיבציה גבוהה.', evalScore: 88,
      convertedToStudentId: 's1' },
  ],
  students: [
    { id: 's1', name: 'דנה כהן', phone: '052-1234567', email: 'dana@example.com',
      courseId: 'hr', year: 'תשפ״ז', preparation: { passed: false }, fromCandidate: true,
      fromCandidateId: 'c1', cvUrl: 'https://example.com/dana-cv.pdf',
      formUrl: 'https://example.com/dana-form.pdf', notes: 'ציון ראיון: 88' },
    { id: 's2', name: 'אריאלה סינגר', phone: '053-9998888', email: 'ariela@example.com',
      courseId: 'hr', year: 'תשפ״ז', preparation: { passed: false } },
    { id: 's3', name: 'הדר עוזירי', phone: '050-1112233', email: 'hadar@example.com',
      courseId: 'hr', year: 'תשפ״ז', preparation: { passed: true },
      cvUpdatedUrl: 'https://example.com/hadar-cv2.pdf', acceptedOrg: 'מערך הדיגיטל הלאומי' },
  ],
  employers: [{ id: 'e1', name: 'מערך הדיגיטל הלאומי', courseId: 'hr', year: 'תשפ״ז',
    contactPhone: '03-1234567', contactEmail: 'hr@example.com', slots: [] }],
  dispatches: [], trainers: [], lectures: [], institutions: [],
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  try { const b = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(PORT, r));

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 } });
await ctx.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
  if (url.includes('practicum_data') && route.request().method() === 'GET') {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: FIXTURE, updated_at: '2026-01-01T00:00:00.000Z',
        last_editor_name: 'preview', last_editor_email: 'preview@local' }) });
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
await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await pg.waitForTimeout(2500);

// main only — the top bar carries a live clock and a sync badge that legitimately
// differ between two runs seconds apart, and would drown a real diff in noise.
const html = await pg.evaluate(() => {
  const main = document.querySelector('main') || document.body;
  return main.outerHTML
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, '<TIME>')
    .replace(/\d{1,2}\.\d{1,2}\.\d{4}/g, '<DATE>')
    .replace(/></g, '>\n<');
});
await writeFile(join(OUT, `students-${TAG}.html`), html, 'utf8');
console.log(`students-${TAG}.html  ${html.length} chars`);
await browser.close();
server.close();
