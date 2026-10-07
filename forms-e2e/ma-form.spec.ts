import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * /ma driven in a real browser, with Supabase intercepted.
 *
 * This is the test that answers Yariv's actual question — "האם תוכל להכין את כל זה ולבדוק
 * שזה עובד לפני שאני שולח להם?" — as far as it can be answered from a sandbox that cannot
 * reach Supabase: the page renders, identifies a student from the app's own list, offers the
 * right organizations and the right classmates, refuses what must be refused, and the row it
 * finally sends carries the organization AND the partner.
 *
 * What it cannot prove, and what the live check after deploy is for: that the real table
 * accepts the row (the partner columns need the migration) and that the storage bucket
 * accepts the upload under the anon key.
 */

const COURSE = 'c-ma';

const BLOB = {
  courses: [
    { id: COURSE, name: 'פרקטיקום תואר שני', year: 'תשפ״ז', type: 'practicum' },
    { id: 'c-ba', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' },
  ],
  students: [
    { id: 's1', name: 'נועה כהן',   email: 'noa@ariel.ac.il',   courseId: COURSE, year: 'תשפ״ז' },
    { id: 's2', name: 'אבי לוי',    email: 'avi@ariel.ac.il',   courseId: COURSE, year: 'תשפ״ז' },
    { id: 's3', name: 'דנה מזרחי',  email: 'dana@ariel.ac.il',  courseId: COURSE, year: 'תשפ״ז' },
    { id: 's9', name: 'רון ברק',    email: 'ron@ariel.ac.il',   courseId: 'c-ba', year: 'תשפ״ז' },
  ],
  employers: [
    {
      id: 'e1', name: 'פסגות', courseIds: [COURSE], notes: 'בית השקעות — אגף משאבי אנוש',
      approvalStatus: 'approved',
      vacancySlots: Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, courseId: COURSE, status: 'available' })),
    },
    {
      id: 'e2', name: 'איקון גרופ', courseIds: ['c-ba'], notes: 'גיוס',
      approvalStatus: 'approved',
      vacancySlots: [{ id: 'w1', courseId: 'c-ba', status: 'available' }],
    },
  ],
};

type Captured = { inserts: any[]; uploads: string[] };

/**
 * Stand in for Supabase. `partnerColumns:false` reproduces the deployment where the
 * migration has not been run — PostgREST's own answer, so the form's fallback is tested
 * against the shape it will really meet.
 */
async function stubSupabase(page: Page, opts: { partnerColumns?: boolean } = {}): Promise<Captured> {
  const partnerColumns = opts.partnerColumns !== false;
  const captured: Captured = { inserts: [], uploads: [] };

  await page.route('**/rest/v1/practicum_data*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: BLOB }) }));

  await page.route('**/storage/v1/object/candidate-uploads/**', (route: Route) => {
    captured.uploads.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'ok' }) });
  });

  await page.route('**/rest/v1/cv_updates*', (route: Route) => {
    const req = route.request();
    const url = req.url();

    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const row = Array.isArray(body) ? body[0] : body;
      if (!partnerColumns && ('partner_mode' in row || 'partner_names' in row)) {
        // Verbatim PostgREST: an unknown column in the payload.
        return route.fulfill({
          status: 400, contentType: 'application/json',
          body: JSON.stringify({ code: 'PGRST204', message: "Could not find the 'partner_mode' column of 'cv_updates' in the schema cache" }),
        });
      }
      captured.inserts.push(row);
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }

    // The schema probe: select=partner_mode
    if (/select=partner_mode/.test(url) && !partnerColumns) {
      return route.fulfill({
        status: 400, contentType: 'application/json',
        body: JSON.stringify({ code: '42703', message: 'column cv_updates.partner_mode does not exist' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Never let the notification function reach the network from a test.
  await page.route('**/functions/v1/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  return captured;
}

async function attachCv(page: Page) {
  await page.locator('[data-ma-file]').setInputFiles({
    name: 'noa-cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 cv'),
  });
}

test('the page renders, and identifies the student from the app\'s own list', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await expect(page.getByRole('heading', { name: /קורות חיים, ארגון ושותף/ })).toBeVisible();

  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await expect(page.locator('[data-ma-identified]')).toContainText('נועה כהן');
  await expect(page.locator('[data-ma-identified]')).toContainText('פרקטיקום תואר שני');
  await expect(page.locator('[data-ma-schema-warning]')).toHaveCount(0);
});

test('an address the app does not know is told so, right under the field', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('stranger@gmail.com');
  await expect(page.locator('[data-ma-unknown]')).toContainText('אינה מופיעה ברשימת הסטודנטים');
});

test('only the student\'s own course organizations are offered, with the 8 places named', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await expect(page.locator('[data-ma-org="פסגות"]')).toContainText('8 מקומות');
  await expect(page.locator('[data-ma-org="איקון גרופ"]')).toHaveCount(0); // the BA course's org
  await expect(page.locator('[data-ma-propose]')).toBeVisible();
});

test('the partner list is the cohort, without the student themselves', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await page.locator('[data-ma-mode="with"]').click();
  const options = await page.locator('[data-ma-partner1] option').allInnerTexts();
  expect(options).toContain('אבי לוי');
  expect(options).toContain('דנה מזרחי');
  expect(options).not.toContain('נועה כהן'); // self
  expect(options).not.toContain('רון ברק');  // another programme
});

test('THE WHOLE POINT: a submission carries the organization and the partner', async ({ page }) => {
  const cap = await stubSupabase(page);
  await page.goto('/ma');

  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await page.locator('[data-ma-org="פסגות"]').click();
  await page.locator('[data-ma-mode="with"]').click();
  await page.locator('[data-ma-partner1]').selectOption('אבי לוי');
  await page.locator('[data-ma-submit]').click();

  await expect(page.locator('[data-ma-done]')).toBeVisible();
  expect(cap.uploads.length).toBe(1);
  expect(cap.inserts.length).toBe(1);
  const row = cap.inserts[0];
  expect(row.email).toBe('noa@ariel.ac.il');
  expect(row.name).toBe('נועה כהן');
  expect(row.org_pref_1).toBe('פסגות');
  expect(row.partner_mode).toBe('with');
  expect(row.partner_names).toEqual(['אבי לוי']);
  expect(row.cv_file_path).toContain('cv-updates/ma-noa-');
  expect(row.suggested_org).toBeNull();
});

test('"alone" is recorded as an answer, not as a blank', async ({ page }) => {
  const cap = await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('dana@ariel.ac.il');
  await attachCv(page);
  await page.locator('[data-ma-org="פסגות"]').click();
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();

  await expect(page.locator('[data-ma-done]')).toBeVisible();
  expect(cap.inserts[0].partner_mode).toBe('alone');
  expect(cap.inserts[0].partner_names).toEqual([]);
});

test('a proposed organization travels with its contact details and no org_pref', async ({ page }) => {
  const cap = await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('avi@ariel.ac.il');
  await attachCv(page);
  await page.locator('[data-ma-propose]').click();
  await page.getByTestId('ma-p-name').fill('חברת ביטוח כלשהי');
  await page.getByTestId('ma-p-contact').fill('שרה כהן');
  await page.getByTestId('ma-p-role').fill('מנהלת משאבי אנוש');
  await page.getByTestId('ma-p-email').fill('sara@insure.co.il');
  await page.getByTestId('ma-p-phone').fill('0501234567');
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();

  await expect(page.locator('[data-ma-done]')).toBeVisible();
  const row = cap.inserts[0];
  expect(row.org_pref_1).toBeNull();
  expect(row.suggested_org.name).toBe('חברת ביטוח כלשהי');
  expect(row.suggested_org.contactRole).toBe('מנהלת משאבי אנוש');
  expect(row.partner_mode).toBe('alone');
});

test('nothing is submitted without a CV, an organization, or a partner answer', async ({ page }) => {
  const cap = await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');

  await page.locator('[data-ma-submit]').click();
  await expect(page.locator('[data-ma-error]')).toContainText('קורות חיים');

  await attachCv(page);
  await page.locator('[data-ma-submit]').click();
  await expect(page.locator('[data-ma-error]')).toContainText('יש לבחור ארגון');

  await page.locator('[data-ma-org="פסגות"]').click();
  await page.locator('[data-ma-submit]').click();
  await expect(page.locator('[data-ma-error]')).toContainText('לבד או עם שותף');

  await page.locator('[data-ma-mode="with"]').click();
  await page.locator('[data-ma-submit]').click();
  await expect(page.locator('[data-ma-error]')).toContainText('בחרו את השותף');

  expect(cap.inserts.length).toBe(0); // nothing reached the table
});

test('MIGRATION NOT RUN: the page warns up front, and a submission still keeps the CV', async ({ page }) => {
  const cap = await stubSupabase(page, { partnerColumns: false });
  await page.goto('/ma');

  // The warning is addressed to the coordinator, before any student sees the link.
  await expect(page.locator('[data-ma-schema-warning]')).toContainText('cv_updates_ma_partner.sql');

  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await page.locator('[data-ma-org="פסגות"]').click();
  await page.locator('[data-ma-mode="with"]').click();
  await page.locator('[data-ma-partner1]').selectOption('אבי לוי');
  await page.locator('[data-ma-submit]').click();

  // The CV and the organization are saved — and the student is TOLD the partner was not.
  await expect(page.locator('[data-ma-done]')).toBeVisible();
  await expect(page.locator('[data-ma-done]')).toContainText('בחירת השותף/ה לא נשמרה');
  expect(cap.inserts.length).toBe(1);
  expect(cap.inserts[0].org_pref_1).toBe('פסגות');
  expect('partner_mode' in cap.inserts[0]).toBe(false);
});

test('?email= prefills, so a student who clicks the link is identified immediately', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma?email=' + encodeURIComponent('dana@ariel.ac.il'));
  await expect(page.locator('[data-ma-identified]')).toContainText('דנה מזרחי');
});
