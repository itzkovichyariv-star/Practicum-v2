#!/usr/bin/env node
/**
 * preview-candidates.mjs — renders the candidates and students screens from the
 * LOCAL build against FIXTURE data, and never touches the live Supabase project.
 *
 * Every request to *.supabase.co is intercepted and answered from the fixture
 * below, so this can be run freely while Yariv is working — no read, no write,
 * no session. Use it to look at a change before it ships; the audit gate in
 * scripts/audit/ is what proves behaviour against a real deployment.
 *
 *   npx astro build && node scripts/preview-candidates.mjs
 *   → scripts/.preview/*.png
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'scripts', '.preview');
const PORT = 4319;

const ago = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const FIXTURE = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז' }],
  academicYears: ['תשפ״ז'],
  candidates: [
    { id: 'c1', name: 'דנה כהן', phone: '052-1234567', email: 'dana@example.com',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: 'https://example.com/dana-cv.pdf',
      applicationUrl: 'https://example.com/dana-form.pdf', interviewDate: ago(6),
      interviewTime: '10:00-10:30', interviewConducted: true, interviewResult: 'passed',
      interviewSummary: 'מוטיבציה גבוהה, ניסיון קודם בגיוס.', evalScore: 88,
      convertedToStudentId: 's1' },
    { id: 'c2', name: 'מאיה בר', phone: '054-1112222', email: 'maya@example.com',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: 'https://example.com/maya-cv.pdf',
      applicationUrl: 'https://example.com/maya-form.pdf' },
    { id: 'c3', name: 'רון שגב', phone: '050-3334444', email: 'ron@example.com',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: 'https://example.com/ron-cv.pdf',
      interviewDate: ago(17), interviewConducted: true, interviewResult: 'failed',
      interviewSummary: 'לא הציג התאמה לתחום.' },
    { id: 'c4', name: 'טל אבני', phone: '058-7778888', email: 'tal@example.com',
      courseId: 'hr', year: 'תשפ״ז' },
  ],
  students: [
    { id: 's1', name: 'דנה כהן', phone: '052-1234567', email: 'dana@example.com',
      courseId: 'hr', year: 'תשפ״ז', preparation: { passed: false }, fromCandidate: true,
      fromCandidateId: 'c1', cvUrl: 'https://example.com/dana-cv.pdf',
      formUrl: 'https://example.com/dana-form.pdf',
      notes: 'ציון ראיון: 88\nסיכום ראיון: מוטיבציה גבוהה, ניסיון קודם בגיוס.' },
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
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(DIST, p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(PORT, r));

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
  .find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

async function open({ width, height, page: which }) {
  const hits = [];
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  // Hard block: nothing in this preview may reach the real project.
  // Route EVERYTHING, then let only same-origin (the local dist server) through.
  // A narrower pattern is tempting but leaves the fonts + realtime calls hitting
  // the network, which is exactly what this preview must never do.
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    hits.push(url.slice(0, 110));
    if (url.includes('practicum_data') && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: FIXTURE, updated_at: new Date().toISOString(),
          last_editor_name: 'preview', last_editor_email: 'preview@local' }) });
    }
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    // Anything else the app asks the cloud for answers empty rather than erroring,
    // so a missing table cannot masquerade as a broken screen.
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await ctx.addInitScript(([whichPage]) => {
    localStorage.setItem('practicum_v2_session', JSON.stringify({
      profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr', year: 'תשפ״ז' }));
    localStorage.setItem('practicum_v2_page', whichPage);
    localStorage.setItem('practicum_theme', 'light');
  }, [which]);
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1800);
  return { pg, ctx, errors, hits };
}

const results = [];
for (const [which, w, tag] of [['candidates', 1180, 'desktop'], ['candidates', 390, 'phone'],
                               ['students', 1180, 'desktop'], ['students', 390, 'phone']]) {
  const { pg, ctx, errors, hits } = await open({ width: w, height: 1000, page: which });
  const overflow = await pg.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  const seen = await pg.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 180));
  await pg.screenshot({ path: join(OUT, `${which}-${tag}.png`), fullPage: true });
  results.push({ which, tag, w, overflow, seen, hits: hits.slice(0, 5), errors: errors.slice(0, 3) });

  if (which === 'candidates' && tag === 'desktop') {
    const box = pg.locator('input[data-archive-toggle]');
    if (await box.count()) {
      await box.check();
      await pg.waitForTimeout(600);
      await pg.screenshot({ path: join(OUT, 'candidates-archive-on.png'), fullPage: true });
    }
    results.push({ which: 'archive-toggle', found: await box.count() });
  }
  await ctx.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
server.close();
