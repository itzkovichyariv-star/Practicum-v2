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

type Captured = { inserts: any[]; uploads: string[]; notifies: any[] };

/** What a classmate's own row says, for the mutual-confirmation probe. */
type PartnerRows = Record<string, string[]>;

/**
 * Stand in for Supabase. `partnerColumns:false` reproduces the deployment where the
 * migration has not been run — PostgREST's own answer, so the form's fallback is tested
 * against the shape it will really meet.
 */
async function stubSupabase(page: Page, opts: { partnerColumns?: boolean; partnerRows?: PartnerRows; history?: any[] } = {}): Promise<Captured> {
  const partnerColumns = opts.partnerColumns !== false;
  const partnerRows = opts.partnerRows || {};
  const captured: Captured = { inserts: [], uploads: [], notifies: [] };

  await page.route('**/rest/v1/practicum_data*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: BLOB }) }));

  await page.route('**/storage/v1/object/candidate-uploads/**', (route: Route) => {
    captured.uploads.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'ok' }) });
  });

  await page.route('**/rest/v1/cv_updates*', (route: Route) => {
    const req = route.request();
    const url = req.url();

    const q = new URL(url).searchParams;
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

    // The mutual-confirmation probe: "is there a row by <email> naming <my name>?"
    // It must answer with an id or nothing — never with anyone's answer.
    //
    // Read through searchParams, NOT decodeURIComponent: a space travels as `+` in a query
    // string and decodeURIComponent leaves it alone, so "נועה כהן" arrived as "נועה+כהן"
    // and every comparison was false. PostgREST itself decodes it as a space.
    const contains = q.get('partner_names');
    const eqEmail = q.get('email');
    if (contains?.startsWith('cs.') && eqEmail?.startsWith('eq.')) {
      const email = eqEmail.slice(3);
      const asked = parseContainsList(contains.slice(3));
      const theirs = partnerRows[email] || [];
      const named = asked.every(n => theirs.includes(n));
      if (process.env.MA_DEBUG) console.log('PROBE', JSON.stringify({ email, asked, theirs, named }));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(named ? [{ id: 'row-1' }] : []),
      });
    }

    // The student's own earlier submissions — what the release prompt is built from.
    if (opts.history && /select=\*/.test(url) && q.get('email')?.startsWith('eq.')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.history) });
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
  await page.route('**/functions/v1/**', (route: Route) => {
    // Kept, not merely blocked: what this mail SAYS is a thing Yariv reads.
    try { captured.notifies.push(JSON.parse(route.request().postData() || '{}')); } catch { /* not json */ }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return captured;
}

/**
 * PostgREST writes a `contains` filter as an array LITERAL — `cs.{"אבי לוי"}` — not as
 * JSON, which is what the first version of this stub assumed and choked on. Both forms are
 * accepted here so the stub cannot be the thing that breaks.
 */
function parseContainsList(raw: string): string[] {
  const t = raw.trim();
  const inner = t.startsWith('{') && t.endsWith('}') ? t.slice(1, -1)
    : t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : t;
  if (!inner.trim()) return [];
  return inner.split(',').map(x => x.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
}

/**
 * The own-organization panel, filled.
 *
 * Every proposing test needs the same six answers now — the organization, the student's
 * own account of it, and WHEN he may call — so they live here rather than being retyped
 * and quietly diverging.
 */
async function fillOwnOrg(page: Page, opts: {
  name?: string; permission?: 'now' | 'later'; contact?: boolean;
} = {}) {
  const { name = 'חברת ביטוח כלשהי', permission = 'now', contact = true } = opts;
  await page.locator('[data-ma-propose]').click();
  await page.getByTestId('ma-p-name').fill(name);
  await page.getByTestId('ma-p-offer').fill('ליווי תהליכי פיתוח ארגוני');
  await page.getByTestId('ma-p-agreed').fill('דיברנו והם מעוניינים');
  await page.getByTestId('ma-p-relationship').fill('מכר של המשפחה');
  await page.locator(`[data-ma-permission-opt="${permission}"] input`).click();
  if (contact) {
    await page.getByTestId('ma-p-contact').fill('שרה כהן');
    await page.getByTestId('ma-p-role').fill('מנהלת משאבי אנוש');
    await page.getByTestId('ma-p-email').fill('sara@insure.co.il');
    await page.getByTestId('ma-p-phone').fill('0501234567');
  }
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
  await fillOwnOrg(page, { name: 'חברת ביטוח כלשהי' });
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

/* ── the personal link, and the mutual-confirmation nudge ─────────────── */

test('a personal link needs no typing, and the address cannot be edited', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma?email=' + encodeURIComponent('noa@ariel.ac.il'));
  const field = page.locator('[data-ma-email]');
  await expect(field).toHaveValue('noa@ariel.ac.il');
  await expect(field).toHaveAttribute('readonly', '');
  await expect(page.locator('[data-ma-identified]')).toContainText('נועה כהן');
  // And the whole form is usable from there without the student entering anything else.
  await expect(page.locator('[data-ma-org="פסגות"]')).toBeVisible();
});

test('THE NUDGE: the partner has not named you back, and the page does not say what they chose', async ({ page }) => {
  // אבי's own row says "alone" (he named nobody), so נועה's claim is unconfirmed.
  await stubSupabase(page, { partnerRows: { 'avi@ariel.ac.il': [] } });
  await page.goto('/ma?email=' + encodeURIComponent('noa@ariel.ac.il'));
  await attachCv(page);
  await page.locator('[data-ma-org="פסגות"]').click();
  await page.locator('[data-ma-mode="with"]').click();
  await page.locator('[data-ma-partner1]').selectOption('אבי לוי');
  await page.locator('[data-ma-submit]').click();

  const warn = page.locator('[data-ma-mutual-warning]');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText('בדקו עם השותף/ה');
  // Nothing about the other answer leaks onto the page.
  const body = await page.locator('body').innerText();
  expect(body).not.toContain('לבד או');
  expect(body).not.toMatch(/אבי לוי סימן|בחר לבד|לא מילא|טרם מילא/);
});

test('when both named each other, the page says so instead of nagging', async ({ page }) => {
  await stubSupabase(page, { partnerRows: { 'avi@ariel.ac.il': ['נועה כהן'] } });
  await page.goto('/ma?email=' + encodeURIComponent('noa@ariel.ac.il'));
  await attachCv(page);
  await page.locator('[data-ma-org="פסגות"]').click();
  await page.locator('[data-ma-mode="with"]').click();
  await page.locator('[data-ma-partner1]').selectOption('אבי לוי');
  await page.locator('[data-ma-submit]').click();

  await expect(page.locator('[data-ma-mutual-ok]')).toContainText('הסימון הדדי');
  await expect(page.locator('[data-ma-mutual-warning]')).toHaveCount(0);
});

test('choosing "alone" raises no partner nudge at all', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma?email=' + encodeURIComponent('dana@ariel.ac.il'));
  await attachCv(page);
  await page.locator('[data-ma-org="פסגות"]').click();
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();
  await expect(page.locator('[data-ma-done]')).toBeVisible();
  await expect(page.locator('[data-ma-mutual-warning]')).toHaveCount(0);
  await expect(page.locator('[data-ma-mutual-ok]')).toHaveCount(0);
});

/* ── the mismatch case, in a real browser ───────────────────────────────────── */
/**
 * Yariv 2026-10-07: "המייל שלהן זה המייל שהם רשומים איתו לאוניברסיטה אז זה לא לתכנית". The
 * address a student actually has is the one case the unit tests cannot show reaching the
 * database, so it is driven here from an empty form to the captured row.
 */

test('THE MISMATCH, END TO END: a personal address, identified by name, filed under the card\'s address', async ({ page }) => {
  const cap = await stubSupabase(page);
  await page.goto('/ma');

  // The address the student is sitting in front of. Nobody's card carries it.
  await page.locator('[data-ma-email]').fill('noa.cohen.private@gmail.com');
  await expect(page.locator('[data-ma-unknown]')).toBeVisible();
  await expect(page.locator('[data-ma-unknown]')).toContainText('הוסיפו את שמכם המלא');
  // The organizations stay hidden until somebody is identified.
  await expect(page.locator('[data-ma-org="פסגות"]')).toHaveCount(0);

  await page.locator('[data-ma-name]').fill('לוי אבי');          // reversed on purpose
  await expect(page.locator('[data-ma-identified]')).toContainText('אבי לוי');
  // and it says which address the submission will land on, because that is not guessable.
  await expect(page.locator('[data-ma-filed-under]')).toContainText('avi@ariel.ac.il');

  await attachCv(page);
  await page.locator('[data-ma-org="פסגות"]').click();
  await page.locator('[data-ma-mode="with"]').click();
  await page.locator('[data-ma-partner1]').selectOption('נועה כהן');
  await page.locator('[data-ma-submit]').click();

  await expect(page.locator('[data-ma-done]')).toBeVisible();
  const row = cap.inserts[0];
  // ONE identity: the card's address, not the typed one — otherwise the partner probe,
  // which looks a classmate up BY that address, could never match the pair.
  expect(row.email).toBe('avi@ariel.ac.il');
  expect(row.name).toBe('אבי לוי');
  expect(row.org_pref_1).toBe('פסגות');
  expect(row.partner_names).toEqual(['נועה כהן']);
  expect(row.cv_file_path).toContain('cv-updates/ma-avi-');
});

test('a name nobody carries is refused in the browser too, and no field opens up', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('someone@gmail.com');
  await page.locator('[data-ma-name]').fill('מיכל ברקוביץ');
  await expect(page.locator('[data-ma-unknown]')).toContainText('לא מצאנו');
  await expect(page.locator('[data-ma-org="פסגות"]')).toHaveCount(0);
});

test('a recognised address never sees the name field at all', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await expect(page.locator('[data-ma-identified]')).toBeVisible();
  await expect(page.locator('[data-ma-name]')).toHaveCount(0);
  // Nothing about a second address, because there is only one.
  await expect(page.locator('[data-ma-filed-under]')).toHaveCount(0);
});

/**
 * The preview was removed once Yariv had walked the form ("ואז תסיר את השם שלי ואשלח
 * לסטודנטים"). Checked in the browser as well as in the unit suite, because this is the
 * state the fifteen students will actually meet: his address must behave like any other
 * unrecognised one — the name field, and no coordinator box.
 */
test('THE PREVIEW IS GONE: the coordinator address is treated like any other', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma?course=c-ma');
  await page.locator('[data-ma-email]').fill('yarivi@ariel.ac.il');
  await expect(page.locator('[data-ma-preview]')).toHaveCount(0);
  await expect(page.locator('[data-ma-identified]')).toHaveCount(0);
  // Not a dead end — the ordinary "we do not know this address" path opens.
  await expect(page.locator('[data-ma-name]')).toBeVisible();
});

test('a HALF-TYPED address is not judged — no red box, no name field', async ({ page }) => {
  // From Yariv's screenshot, 2026-10-07: "ya" in the field and the page already saying the
  // address is not on the list. An unfinished address is not a wrong one.
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('ya');
  await expect(page.locator('[data-ma-unknown]')).toHaveCount(0);
  await expect(page.locator('[data-ma-name]')).toHaveCount(0);

  await page.locator('[data-ma-email]').fill('ya@');
  await expect(page.locator('[data-ma-unknown]')).toHaveCount(0);

  // Finished, and genuinely unknown: now it speaks.
  await page.locator('[data-ma-email]').fill('ya@gmail.com');
  await expect(page.locator('[data-ma-unknown]')).toBeVisible();
  await expect(page.locator('[data-ma-name]')).toBeVisible();
});

/* ── what happens next ────────────────────────────────────────────────── */

test('a CHOSEN organization: the student is told the organization will contact them', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await page.locator('[data-ma-org="פסגות"]').click();
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();

  const next = page.locator('[data-ma-next]');
  await expect(next).toBeVisible();
  await expect(next).toContainText('פסגות');
  await expect(next).toContainText('יצור איתך קשר להמשך תהליך המיון');
  // Nothing about an approval — that is the other path, and saying both would be noise.
  await expect(next).not.toContainText('יאושר');
});

test('a PROPOSED organization: who approaches it is named, and an update follows by email', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await fillOwnOrg(page, { name: 'מעבדות אלפא' });
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();

  const next = page.locator('[data-ma-next]');
  await expect(next).toBeVisible();
  // Yariv 2026-10-07: "הוא יקבל הודעה שאומרת לו שאני אצור קשר עם הארגון לאישור" — the
  // student is told WHO makes the approach, not only that an approval exists. One name
  // throughout, at his word: "מנחה התכנית במקום ד״ר איצקוביץ … לאחד את הנוסח".
  await expect(next).toContainText('מנחה התכנית יצור קשר עם הארגון');
  await expect(next).toContainText('עדכון במייל');
  await expect(next).toContainText('להתחיל את הפרקטיקום');
});

/**
 * The address in the coordinator's mail must be the one the ROW was filed under.
 *
 * A student identified by name is filed under the address on their card, so a mail
 * quoting the personal address they happened to type would hand Yariv an address matching
 * no row he can open — the one case where the two differ is exactly the one this form was
 * built for.
 */
test('the coordinator mail carries the FILED address, not the typed one', async ({ page }) => {
  const cap = await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('avi.personal@gmail.com');
  await page.locator('[data-ma-name]').fill('אבי לוי');
  await attachCv(page);
  await fillOwnOrg(page, { name: 'ארגון כלשהו' });
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();
  await expect(page.locator('[data-ma-done]')).toBeVisible();

  expect(cap.notifies).toHaveLength(1);
  const r = cap.notifies[0].record;
  expect(r.candidateEmail).toBe('avi@ariel.ac.il');
  expect(r.candidateName).toBe('אבי לוי');
  // And the mail must still say which form this came from, or it reverts to "second stage".
  expect(r.track).toBe('ma');
  expect(cap.inserts[0].email).toBe('avi@ariel.ac.il');
});

/**
 * "NOT YET" in the browser, and the question behind it: WHEN MAY HE CALL.
 *
 * Yariv 2026-10-07: "אם הארגון בתהליך בדיקה בין הסטודנט לארגון אני צריך לדעת מתי אוכל
 * לפנות", and for an organization the student brings he needs "שם תפקיד טלפון ומייל וכמה
 * מילות הסבר" — what it offers, what was agreed, and what the connection is.
 */
test('CALL THEM NOW: the row carries the organization and the permission', async ({ page }) => {
  const cap = await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await fillOwnOrg(page, { name: 'מכון אביב', permission: 'now' });
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();

  await expect(page.locator('[data-ma-done]')).toBeVisible();
  const row = cap.inserts[0];
  expect(row.contact_permission).toBe('now');
  expect(row.org_status).toBeNull();          // nothing is pending — he may act today
  expect(row.org_pref_1).toBeNull();
  expect(row.suggested_org.name).toBe('מכון אביב');
  // The student's own account travels with it, labelled, for him to read before phoning.
  expect(row.suggested_org.notes).toContain('מה הארגון מציע: ליווי תהליכי פיתוח ארגוני');
  expect(row.suggested_org.notes).toContain('אופי הקשר: מכר של המשפחה');
  expect(row.student_note).toBe('אפשר לפנות לארגון עכשיו · מכון אביב');
});

test('THE DATE IS GONE: there is no middle option left to pick', async ({ page }) => {
  // Yariv 2026-10-07: "לא צריך תאריך שיוגדר זה במילא לא ראלי".
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await page.locator('[data-ma-propose]').click();
  await expect(page.locator('[data-ma-permission-opt]')).toHaveCount(2);
  await expect(page.locator('[data-ma-contact-after]')).toHaveCount(0);
});

test('STILL TALKING: contact details are requested, not demanded', async ({ page }) => {
  // A student mid-conversation often has no direct line yet; demanding it produces an
  // invented number, which is worse than a blank because a blank is visible.
  const cap = await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await fillOwnOrg(page, { name: 'מכון אביב', permission: 'later', contact: false });
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();

  await expect(page.locator('[data-ma-done]')).toBeVisible();
  expect(cap.inserts[0].contact_permission).toBe('later');
  expect(cap.inserts[0].org_status).toBe('pending');
  // And the student is told what to do when it does become possible.
  await expect(page.locator('[data-ma-next]')).toContainText('חזרו ועדכנו את הטופס');
});

test('but the same details, when given, must still be real', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await fillOwnOrg(page, { permission: 'later', contact: false });
  await page.getByTestId('ma-p-email').fill('not-an-address');
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();
  await expect(page.locator('[data-ma-error]')).toContainText('אימייל');
});

test("THE STUDENT'S OWN ACCOUNT is required whatever the timing", async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await page.locator('[data-ma-propose]').click();
  await page.getByTestId('ma-p-name').fill('מכון אביב');
  await page.locator('[data-ma-permission-opt="later"] input').click();
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();
  await expect(page.locator('[data-ma-error]')).toContainText('מה הארגון מציע');
});

test('NO ORGANIZATION: it submits straight away, asking nothing further', async ({ page }) => {
  // The "why not the listed organization" box was struck 2026-10-07 — "אפשר להסיר שיפנו
  // אלי להסבר". A reason typed to get past a form is not a reason he can act on.
  const cap = await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await page.locator('[data-ma-status="none"]').click();
  await expect(page.locator('[data-ma-why-not]')).toHaveCount(0);
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();

  await expect(page.locator('[data-ma-done]')).toBeVisible();
  expect(cap.inserts[0].org_status).toBe('none');
  expect(cap.inserts[0].student_note).toBe('אין ארגון כרגע');
});

test('the open box reaches the coordinator even when an organization WAS chosen', async ({ page }) => {
  const cap = await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await page.locator('[data-ma-org="פסגות"]').click();
  await page.locator('[data-ma-status-note]').fill('אני בחופשת לידה עד דצמבר');
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();

  await expect(page.locator('[data-ma-done]')).toBeVisible();
  expect(cap.inserts[0].org_pref_1).toBe('פסגות');
  expect(cap.inserts[0].org_status).toBeNull();
  expect(cap.inserts[0].student_note).toBe('אני בחופשת לידה עד דצמבר');
});

test('the three answers are exclusive — choosing one clears the others', async ({ page }) => {
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await page.locator('[data-ma-propose]').click();
  await expect(page.getByTestId('ma-p-name')).toBeVisible();
  await page.locator('[data-ma-status="none"]').click();
  await expect(page.getByTestId('ma-p-name')).toHaveCount(0);
  await expect(page.locator('[data-ma-none-panel]')).toBeVisible();
  await page.locator('[data-ma-org="פסגות"]').click();
  await expect(page.locator('[data-ma-none-panel]')).toHaveCount(0);
});


/**
 * THE RELEASE — the thing Yariv asked for in so many words: "שהסטודנט יכנס לקישור בפעם
 * הבאה … יוכל לשנות לאפשר לפנות לארגון ואני אקבל הודעה שאומרת סטודנט x עדכן שניתן לפנות
 * לארגון".
 *
 * The student already said "not yet" once. Making them retype the whole form to take it
 * back is how an organization sits untouched for a month.
 */
const HELD_BACK = [{
  id: 'row-held', uploaded_at: '2026-10-01T09:00:00Z',
  cv_file_path: 'cv-updates/ma-noa-1.pdf', org_pref_1: null,
  partner_mode: 'alone', partner_names: [],
  contact_permission: 'later',
  suggested_org: {
    name: 'מכון אביב', contactName: 'שרה כהן', contactRole: 'מנהלת',
    email: 'sara@aviv.co.il', phone: '0501234567', location: '', notes: 'מה הארגון מציע: ליווי',
  },
}];

test('A RETURNING STUDENT is offered the release, and one click sends it', async ({ page }) => {
  const cap = await stubSupabase(page, { history: HELD_BACK });
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');

  const prompt = page.locator('[data-ma-release]');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('מכון אביב');

  await page.locator('[data-ma-release-go]').click();
  await expect(page.locator('[data-ma-released]')).toContainText('מכון אביב');

  // The row says he may call now, and keeps everything the student already gave.
  const row = cap.inserts[0];
  expect(row.contact_permission).toBe('now');
  expect(row.org_status).toBeNull();
  expect(row.suggested_org.name).toBe('מכון אביב');
  expect(row.cv_file_path).toBe('cv-updates/ma-noa-1.pdf');   // no re-upload asked of them
  expect(row.partner_mode).toBe('alone');                      // and the partner answer survives

  // And the mail that reaches Yariv says exactly what he asked to be told.
  const note = cap.notifies.find(n => n.record?.isRelease);
  expect(note).toBeTruthy();
  expect(note.record.candidateName).toBe('נועה כהן');
  expect(note.record.contactPermission).toBe('now');
  expect(note.record.permissionLine).toBe('אפשר לפנות לארגון עכשיו');
});

test('a release with no way to CALL them is not a release — it asks for the details', async ({ page }) => {
  const noContact = [{ ...HELD_BACK[0], suggested_org: { ...HELD_BACK[0].suggested_org, contactName: '', phone: '', email: '' } }];
  const cap = await stubSupabase(page, { history: noContact });
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await page.locator('[data-ma-release-go]').click();

  await expect(page.locator('[data-ma-error]')).toContainText('פרטי איש/אשת הקשר');
  expect(cap.inserts).toHaveLength(0);
  // The panel is open on "call now", prefilled, so they finish rather than start again.
  await expect(page.getByTestId('ma-p-name')).toHaveValue('מכון אביב');
});

test('a student who never withheld permission is not nagged', async ({ page }) => {
  const settled = [{ ...HELD_BACK[0], contact_permission: 'now' }];
  await stubSupabase(page, { history: settled });
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await expect(page.locator('[data-ma-identified]')).toBeVisible();
  await expect(page.locator('[data-ma-release]')).toHaveCount(0);
});

/**
 * Yariv 2026-10-07: "בכל מקרה צריך להיות כפתור שלח והודעה מסכמת לאחר שליחה שאומרת הפרטים
 * נשמרו וד״ר איצקוביץ עודכן בסטטוס".
 *
 * The sentence is a PROMISE to fifteen students, so it has to be true for all three
 * answers — which is why the form now mails him on every submission, not only a proposal.
 */
for (const [label, fill] of [
  ['chose from the list', async (page: Page) => { await page.locator('[data-ma-org="פסגות"]').click(); }],
  ['brought their own', async (page: Page) => { await fillOwnOrg(page, { name: 'מכון אביב' }); }],
  ['has none yet', async (page: Page) => {
    await page.locator('[data-ma-status="none"]').click();
  }],
] as const) {
  test(`SUMMARY: a student who ${label} is told he was updated — and he really was`, async ({ page }) => {
    const cap = await stubSupabase(page);
    await page.goto('/ma');
    await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
    await attachCv(page);
    await fill(page);
    await page.locator('[data-ma-mode="alone"]').click();
    await page.locator('[data-ma-submit]').click();

    await expect(page.locator('[data-ma-summary]')).toContainText('הפרטים נשמרו');
    await expect(page.locator('[data-ma-summary]')).toContainText('מנחה התכנית עודכן בסטטוס');
    // The promise is only honest if a mail actually went.
    expect(cap.notifies, 'the confirmation claims he was updated').toHaveLength(1);
    expect(cap.notifies[0].record.track).toBe('ma');
  });
}

test('NO ORGANIZATION: sent to the supervisor, and told they may come back', async ({ page }) => {
  // Yariv: "באין ארגון כרגע צריך להיות כתוב אנא פנה למנחה הפרקטיקום לתיאום ובתוספת אפשר
  // לחזור בכל רגע נתון ולהוסיף ארגון".
  const cap = await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await page.locator('[data-ma-status="none"]').click();
  // Said before submitting, while they are still deciding...
  await expect(page.locator('[data-ma-none-panel]')).toContainText('אנא פנו למנחה התכנית לתיאום');
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();

  // ...and again on the screen they are left looking at.
  const next = page.locator('[data-ma-next]');
  await expect(next).toContainText('אנא פנו למנחה התכנית לתיאום');
  await expect(next).toContainText('בכל רגע נתון ולהוסיף ארגון');
  expect(cap.notifies[0].record.noOrg).toBe(true);
});

test('NOT YET: the student is told to come back and update when it is possible', async ({ page }) => {
  // Yariv: "בקשר עם ארגון עוד לא לפנו הסטודנט צריך לראות חזור ועדכן את הטופס כאשר ניתן
  // יהיה לפנות לארגון".
  await stubSupabase(page);
  await page.goto('/ma');
  await page.locator('[data-ma-email]').fill('noa@ariel.ac.il');
  await attachCv(page);
  await fillOwnOrg(page, { name: 'מכון אביב', permission: 'later', contact: false });
  await page.locator('[data-ma-mode="alone"]').click();
  await page.locator('[data-ma-submit]').click();

  const next = page.locator('[data-ma-next]');
  await expect(next).toContainText('חזרו ועדכנו את הטופס כאשר ניתן יהיה לפנות לארגון');
  // And the reassurance that nothing happens behind their back in the meantime.
  await expect(next).toContainText('לא ניצור איתם קשר');
});
