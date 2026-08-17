#!/usr/bin/env node
/**
 * form-drafts-check.mjs — does "nothing is lost if they come back to the link"
 * actually hold, on every form that promises it?
 *
 * THE RULE (Yariv, 2026-07-20): "the recorded data should be kept automatically
 * while typed. that way if they go back to the same link nothing is lost."
 *
 * Two forms, two different key shapes, and the difference is the whole story:
 *
 *   FEEDBACK  keyed by a token in the URL — never typed, never changes.
 *             This one always worked. It is here as a REGRESSION guard: the fix
 *             for the registration form must not disturb it. Verified green
 *             against the pre-fix hook as well as the fixed one.
 *
 *   REGISTER  keyed by the candidate's own email — typed, so the key changed on
 *             every keystroke. The hook restored once, for the first one-letter
 *             key, then wrote the blank form under the finished-email key where
 *             last visit's answers lived. Returning DESTROYED the draft.
 *             Goes red on the pre-fix hook.
 *
 * Offline: dist/ is served locally and every off-origin request is answered from a
 * fixture, so no live data is touched and nobody's real draft is involved.
 *
 *   npx astro build && node scripts/form-drafts-check.mjs
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4327;

const EMAIL = 'adih0838@gmail.com';
const ANSWER = 'עבדתי שנתיים בגיוס והשמה, ואני רוצה להעמיק בפיתוח ארגוני.';
const TOKEN = 'tok-regression-1';
const FEEDBACK_TEXT = 'הפגינה יוזמה, למדה מהר, והשתלבה היטב בצוות הגיוס.';

const FIXTURE = {
  courses: [{ id: 'practicum-hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }],
  academicYears: ['תשפ״ז'],
  candidates: [],
  students: [{
    id: 's1', name: 'נועה שקד', email: 'noa@example.com',
    courseId: 'practicum-hr', year: 'תשפ״ז',
    acceptedOrg: 'ארגון לדוגמה', feedbackToken: TOKEN,
  }],
  employers: [{ id: 'e1', name: 'ארגון לדוגמה', contactPerson: 'רותי לוי' }],
  trainers: [], lectures: [], dispatches: [],
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const b = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b);
  } catch {
    try { // Astro emits /register/index.html
      const b = await readFile(join(DIST, p, 'index.html'));
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

async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 1000 } });
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    if (url.includes('practicum_data') && route.request().method() === 'GET') {
      // .single() asks PostgREST for one object; .limit(1) expects an array. Answer
      // in the shape the caller asked for, or supabase-js reports "not found".
      const accept = route.request().headers()['accept'] || '';
      const one = accept.includes('vnd.pgrst.object');
      const row = { data: FIXTURE, updated_at: '2026-01-01T00:00:00.000Z' };
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(one ? row : [row]) });
    }
    if (url.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  return ctx;
}

const base = `http://127.0.0.1:${PORT}`;
const only = process.argv[2] || '';   // 'feedback' | 'register' | '' (both)

console.log('\nform-drafts-check — offline, real pages\n');

/* ══ FEEDBACK — the stable-key form. Must behave exactly as it always has. ═══ */
if (only !== 'register') {
  console.log('FEEDBACK (key from the link — regression guard)');
  const ctx = await newCtx();
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));

  await pg.goto(`${base}/f?t=${TOKEN}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  const areas = await pg.$$('textarea');
  check('the feedback form opened for this token', areas.length > 0,
    areas.length ? `${areas.length} textareas` : `errors: ${errs.slice(0, 2).join(' | ') || 'none'}`);

  if (areas.length) {
    await areas[0].click();
    await areas[0].type(FEEDBACK_TEXT, { delay: 8 });
    await pg.waitForTimeout(1200);
    const savedNow = await pg.$eval('[data-draft-indicator]', el => el.getAttribute('data-draft-indicator')).catch(() => null);
    check('it says it is saving while they type', savedNow === '1', `indicator=${savedNow}`);

    // Come back to the same link — the supervisor's own scenario.
    await pg.goto(`${base}/f?t=${TOKEN}`, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(1800);
    const back = await pg.$$eval('textarea', els => els.map(e => e.value).filter(Boolean));
    check('their words came back', back.some(v => v.includes(FEEDBACK_TEXT.slice(0, 20))),
      back.length ? `${back.length} filled` : 'all empty');
    const banner = await pg.$('[data-draft-restored]');
    check('and it tells them so', !!banner);
  }
  check('no page errors (feedback)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ══ REGISTER — the typed-key form. This is the one that was destroying drafts. ═ */
if (only !== 'feedback') {
  console.log('\nREGISTER (key from the typed email — the bug)');
  const ctx = await newCtx();
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  const REG = `${base}/register`;

  await pg.goto(REG, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1200);
  const emailSel = 'input[type="email"], input[name*="mail" i]';
  const hasEmail = await pg.$(emailSel);
  check('the registration form rendered', !!hasEmail,
    hasEmail ? '' : `errors: ${errs.slice(0, 2).join(' | ') || 'none'}`);

  if (hasEmail) {
    // Visit 1 — type the email character by character, then answer a question.
    await pg.click(emailSel);
    await pg.type(emailSel, EMAIL, { delay: 60 });
    await pg.waitForTimeout(700);
    const areas = await pg.$$('textarea');
    await areas[0].click();
    await areas[0].type(ANSWER, { delay: 8 });
    await pg.waitForTimeout(1200);

    const stored = await pg.evaluate(([k, a]) => {
      const raw = localStorage.getItem(k);
      return !!raw && raw.includes(a.slice(0, 20));
    }, [`practicum_draft_register_${EMAIL}`, ANSWER]);
    check('the answer was saved under their email', stored);

    // Visit 2 — same link, retype the email, exactly as a returning candidate does.
    await pg.goto(REG, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(1200);
    await pg.click(emailSel);
    await pg.type(emailSel, EMAIL, { delay: 60 });
    await pg.waitForTimeout(1800);

    const restored = await pg.$$eval('textarea', els => els.map(e => e.value).filter(Boolean));
    check('THE RULE — their answer came back', restored.some(v => v.includes(ANSWER.slice(0, 20))),
      restored.length ? `${restored.length} filled` : 'all empty');

    const still = await pg.evaluate(([k, a]) => {
      const raw = localStorage.getItem(k);
      if (!raw) return 'key removed entirely';
      return raw.includes(a.slice(0, 20)) ? 'draft intact' : 'OVERWRITTEN — answer replaced by blanks';
    }, [`practicum_draft_register_${EMAIL}`, ANSWER]);
    check('returning did not destroy the saved draft', still === 'draft intact', still);

    // The email they just typed must survive the restore — a draft may fill blanks,
    // never overwrite live input.
    const emailNow = await pg.$eval(emailSel, el => el.value);
    check('their freshly typed email was not overwritten', emailNow === EMAIL, emailNow);

    const banner = await pg.$('[data-draft-restored]');
    check('and it tells them their answers were restored', !!banner);
  }
  check('no page errors (register)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(`FAILED: ${failed.map(f => f.name).join(', ')}\n`); process.exit(1); }
console.log('');
