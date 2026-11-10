#!/usr/bin/env node
// Read-only student information: show the GPA already stored in the application.
// All data is synthetic and every off-origin request is intercepted locally.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const fixture = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }],
  academicYears: ['תשפ״ז'],
  candidates: [], employers: [], dispatches: [], trainers: [], lectures: [], institutions: [],
  students: [
    { id: 'gpa-decimal', name: 'סטודנט לדוגמה', email: 'student@example.com',
      courseId: 'hr', year: 'תשפ״ז', questionnaire: { gpa: ' 91.75 ', studyTracks: 'משאבי אנוש',
        workHistory: 'תשובה לדוגמה בעברית ובאנגלית Example',
        favRole: '<img src=x onerror=alert(1)> טקסט כפי שהוגש',
        expectations: 'תשובהארוכה'.repeat(80) },
      acceptedOrg: 'ארגון לדוגמה', preparation: { passed: true, date: '2026-07-19' },
      cvUrl: 'https://example.com/cv.pdf', cvUpdatedUrl: 'https://example.com/cv-updated.pdf',
      notes: 'הערה לדוגמה' },
    { id: 'gpa-missing', name: 'סטודנט ללא שאלון', courseId: 'hr', year: 'תשפ״ז' },
    { id: 'gpa-empty', name: 'סטודנט ללא ממוצע', courseId: 'hr', year: 'תשפ״ז', questionnaire: { gpa: '   ' } },
    { id: 'gpa-zero', name: 'סטודנט עם אפס', courseId: 'hr', year: 'תשפ״ז', questionnaire: { gpa: '0' } },
  ],
};
const original = JSON.stringify(fixture);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path.endsWith('/')) path += 'index.html';
  try {
    const bytes = await readFile(join(DIST, path));
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {});
const writes = [];
const errors = [];
let checked = 0;
try {
  for (const width of [375, 430, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'he-IL' });
    await context.route('**/*', route => {
      const request = route.request();
      const url = request.url();
      if (url.startsWith(origin + '/')) return route.continue();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method() + ' ' + new URL(url).pathname);
      // App startup already keeps a recent automatic backup. This fixture suppresses
      // that unrelated heartbeat so the read-only interaction check observes its own writes.
      if (url.includes('practicum_snapshots') && request.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ created_at: new Date().toISOString() }) });
      }
      if (url.includes('practicum_data') && request.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: fixture, updated_at: '2026-11-10T00:00:00.000Z',
            last_editor_name: 'fixture', last_editor_email: 'fixture@example.com' }) });
      }
      return route.fulfill({ status: 200, contentType: url.includes('fonts.g') ? 'text/css' : 'application/json',
        body: url.includes('fonts.g') ? '' : '[]' });
    });
    await context.addInitScript(() => {
      localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'בדיקה', email: 'fixture@example.com' } }));
      localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr', year: 'תשפ״ז' }));
      localStorage.setItem('practicum_v2_page', 'students');
      localStorage.setItem('practicum_theme', 'light');
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(origin, { waitUntil: 'networkidle' });
    const open = async id => {
      const row = page.locator(`[data-student-row="${id}"]`);
      await row.locator('.serif').first().click();
      const popover = row.locator('[data-popover-open="true"]');
      await expect(popover).toBeVisible();
      await expect(popover).toHaveCSS('opacity', '1');
      return popover;
    };
    for (const [id, value] of [['gpa-decimal', '91.75'], ['gpa-missing', 'לא צוין'], ['gpa-empty', 'לא צוין'], ['gpa-zero', '0']]) {
      const popover = await open(id);
      const label = popover.getByText('ממוצע ציונים', { exact: true });
      await expect(label).toBeVisible();
      const detail = label.locator('..');
      await expect(detail.locator('span').last()).toHaveText(value);
      const box = await detail.boundingBox();
      if (!box || box.x < -1 || box.x + box.width > width + 1) throw new Error(`GPA row clipped at ${width}px`);
      if (id === 'gpa-decimal') {
        for (const text of ['student@example.com', 'ארגון לדוגמה', '✓ זמין', '✓ הוגש', 'הערה לדוגמה']) {
          await expect(popover.getByText(text, { exact: true })).toBeVisible();
        }
        await mkdir(join(ROOT, 'test-results'), { recursive: true });
        const panel = await popover.boundingBox();
        if (!panel || panel.x < 0 || panel.y < 0 || panel.x + panel.width > width + 1 || panel.y + panel.height > 901) {
          throw new Error(`Student panel leaves the viewport at ${width}px: ${JSON.stringify(panel)}`);
        }
        await popover.screenshot({ animations: 'disabled', path: join(ROOT, 'test-results', `student-gpa-${width}.png`) });
      }
      await popover.locator('button[title="סגור"]').click();
      await expect(page.locator('[data-popover-open="true"]')).toHaveCount(0);
      checked++;
    }
    // Open the saved questionnaire directly, never the editable student card.
    for (const id of ['gpa-decimal', 'gpa-missing', 'gpa-empty', 'gpa-zero']) {
      const popover = await open(id);
      await popover.getByRole('button', { name: 'הצג טופס הגשת מועמדות', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('תשובות השאלון השמורות במערכת · קריאה בלבד', { exact: true })).toBeVisible();
      await expect(dialog.locator('input,textarea,select,a')).toHaveCount(0);
      await expect(dialog.getByRole('button')).toHaveCount(1);
      await expect(dialog.getByRole('button', { name: 'סגור', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'סגור', exact: true })).toBeFocused();
      if (id === 'gpa-decimal') {
        await expect(dialog.getByText('חוג: משאבי אנוש · ממוצע: 91.75', { exact: true })).toBeVisible();
        await expect(dialog.getByText('תשובה לדוגמה בעברית ובאנגלית Example', { exact: true })).toBeVisible();
        await expect(dialog.getByText('<img src=x onerror=alert(1)> טקסט כפי שהוגש', { exact: true })).toBeVisible();
        await expect(dialog.locator('img')).toHaveCount(0);
        await expect(dialog.getByText('לא מולא', { exact: true })).toHaveCount(4);
        const lastAnswer = dialog.getByText('תשובהארוכה'.repeat(80), { exact: true });
        await lastAnswer.scrollIntoViewIfNeeded();
        await expect(lastAnswer).toBeInViewport();
        const bounds = await lastAnswer.boundingBox();
        if (!bounds || bounds.x < 0 || bounds.x + bounds.width > width + 1) throw new Error('Long answer overflows');
        await dialog.getByRole('heading', { name: 'טופס הגשת מועמדות', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(ROOT, 'test-results', `student-application-${width}.png`), animations: 'disabled' });
      } else if (id === 'gpa-zero') {
        await expect(dialog.getByText('ממוצע: 0', { exact: true })).toBeVisible();
      } else {
        await expect(dialog.getByText('לא נשמרו תשובות לטופס הגשת המועמדות ברשומה זו.', { exact: true })).toBeVisible();
      }
      if (id === 'gpa-missing') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: 'סגור', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      if (context.pages().length !== 1) throw new Error('Read-only form opened a new tab');
    }
    await open('gpa-decimal');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-popover-open="true"]')).toHaveCount(0);
    await open('gpa-decimal');
    await page.locator('h1').click();
    await expect(page.locator('[data-popover-open="true"]')).toHaveCount(0);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) {
      throw new Error(`Page overflows at ${width}px`);
    }
    await context.close();
  }
  if (writes.length) throw new Error(`Read-only view attempted writes: ${writes.join(', ')}`);
  if (errors.length) throw new Error(errors.join('\n'));
  if (JSON.stringify(fixture) !== original) throw new Error('Fixture changed');
  console.log(`PASS: ${checked} GPA cases, 3 viewport widths, read-only application view (saved/partial/missing), literal escaped answers, keyboard focus, mobile scrolling, existing details, repeated open/close, Escape/outside dismissal, no writes, outgoing contact actions or page errors.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
