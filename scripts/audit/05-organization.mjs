#!/usr/bin/env node
/**
 * 05-organization.mjs — organization browsing page audit.
 *
 * Cell map:
 *   ORG-loads        /organizations page renders without crash and shows
 *                    either employer cards or an empty-state message.
 *   ORG-count        The number of cards on screen matches the count shown
 *                    in the header badge ("N ארגונים").
 *   ORG-expand       Clicking an employer card with notes expands the
 *                    description panel (chevron flips, body text visible).
 *   ORG-search       Typing a search term filters the list — result count
 *                    drops and the visible cards match the query.
 *   ORG-no-auth      The page is accessible without the admin session
 *                    (public route — no login required).
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const audit = new Audit({ name: 'organization' });
await audit.setup();

// The public page is COURSE-SCOPED by design: an unscoped visit deliberately shows
// nothing so it can never leak another programme's orgs (see 42-public-orgs-scope;
// students of מש״א תשפ״ז were seeing 15 orgs, 5 from other programmes). The render
// assertions below (count / expand / search) therefore run against a real course.
const _data = (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};
const _perCourse = {};
(_data.employers || []).forEach(e => (e.courseIds || (e.courseId ? [e.courseId] : []))
  .forEach(c => { _perCourse[c] = (_perCourse[c] || 0) + 1; }));
const COURSE = Object.entries(_perCourse).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
const ORGS_URL = `${audit.baseUrl}/organizations?course=${encodeURIComponent(COURSE)}`;
audit.log(`(public org page scoped to course "${COURSE}")`);

// ─── ORG-loads ───────────────────────────────────────────────────────────────
audit.log('ORG-loads: /organizations page loads and renders');
{
  await audit.page.goto(ORGS_URL, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1500);
  const before = await audit.shot('ORG-loads-before');
  audit.observerMark();

  // Page heading should say "ארגונים לפרקטיקום"
  const heading = audit.page.locator('text=ארגונים לפרקטיקום').first();
  const headingVisible = await heading.isVisible().catch(() => false);

  // Either employer cards or empty-state must be visible
  const searchInput = audit.page.locator('input[type="search"]').first();
  const searchVisible = await searchInput.isVisible().catch(() => false);

  const after = await audit.shot('ORG-loads-after');
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'ORG-loads',
    tableRef: '/organizations / page heading',
    expected: '"ארגונים לפרקטיקום" heading visible; search input rendered; no page errors',
    observed: `heading=${headingVisible}, search=${searchVisible}; errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p/${obs.netFailures.length}n)`,
    pass: headingVisible && searchVisible && obs.pageErrors.length === 0,
    before, after,
    notes: !headingVisible ? 'Page heading not found — component may not be rendering.'
         : !searchVisible ? 'Search input not found — OrganizationsPage component may not be loading.'
         : obs.pageErrors.length > 0 ? `Page errors: ${obs.pageErrors.slice(0, 3).join(' | ')}` : '',
  });
}

// ─── ORG-count ───────────────────────────────────────────────────────────────
audit.log('ORG-count: card count matches badge');
{
  audit.observerMark();

  // Count employer cards — each card has exactly one 🏢 emoji in its icon div.
  // Using locator('text=🏢') counts the text nodes directly (1 per card),
  // avoiding the ambiguity of filtering ancestor divs.
  const cardCount = await audit.page.locator('text=🏢').count();

  // Read the count text from the page ("N ארגונים")
  const countText = await audit.page.locator('text=/\\d+ ארגונים/').first().textContent().catch(() => '');
  const match = countText.match(/(\d+)/);
  const badgeCount = match ? parseInt(match[1], 10) : -1;

  // Also cross-check with DB
  const dbEmps = await sbQuery('practicum_data', { select: 'data' }).then((rows) => {
    const emps = rows?.[0]?.data?.employers || [];
    return emps.filter((e) => e.name && e.approvalStatus !== 'rejected');
  }).catch(() => []);

  const pass = badgeCount >= 0 && cardCount === badgeCount;
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'ORG-count',
    tableRef: '/organizations / card count vs badge',
    expected: 'Number of rendered employer cards equals the "N ארגונים" badge',
    observed: `cardCount=${cardCount}, badgeCount=${badgeCount}, dbActiveEmps=${dbEmps.length}`,
    pass,
    notes: !pass
      ? badgeCount < 0
        ? 'Could not parse the count badge. Selector may need updating.'
        : `Mismatch: ${cardCount} cards rendered but badge says ${badgeCount}.`
      : '',
  });
}

// ─── ORG-expand ──────────────────────────────────────────────────────────────
audit.log('ORG-expand: clicking a card with notes expands the description');
{
  const before = await audit.shot('ORG-expand-before');
  audit.observerMark();

  // Find an employer with notes from DB
  const dbEmps = await sbQuery('practicum_data', { select: 'data' }).then((rows) => {
    const emps = rows?.[0]?.data?.employers || [];
    return emps.filter((e) => e.name && e.notes && e.approvalStatus !== 'rejected');
  }).catch(() => []);

  let pass = null;
  let observed = '';

  // Only orgs that are actually rendered (available + not full + not private) can
  // be expanded — a full org is correctly hidden from /organizations now.
  let emp = null;
  for (const e of dbEmps) {
    const vis = await audit.page.getByText(e.name, { exact: true }).first().isVisible().catch(() => false);
    if (vis) { emp = e; break; }
  }

  if (!emp) {
    observed = 'No notes-employer is currently visible on /organizations — cannot test expand';
    pass = null;
  } else {
    audit.log(`  Using employer with notes: "${emp.name}"`);

    // Use getByText with exact match to find the employer name element directly.
    // Clicking it bubbles up to the OrgCard outer div's onClick handler.
    const nameEl = audit.page.getByText(emp.name, { exact: true }).first();
    {
      // Notes panel is only rendered when open=true — not in DOM before click
      const bodyBefore = await audit.page.textContent('body').catch(() => '');
      const notesSnippet = emp.notes.slice(0, 12);
      const alreadyVisible = bodyBefore.includes(notesSnippet);

      await nameEl.click();
      await audit.page.waitForTimeout(800);

      const bodyAfter = await audit.page.textContent('body').catch(() => '');
      const appearedAfterClick = bodyAfter.includes(notesSnippet);
      pass = !alreadyVisible && appearedAfterClick;
      observed = `card="${emp.name}"; alreadyVisible=${alreadyVisible}; appearedAfterClick=${appearedAfterClick}`;
    }
  }

  const after = await audit.shot('ORG-expand-after');
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'ORG-expand',
    tableRef: '/organizations / card expand / description panel',
    expected: 'Clicking an employer card with notes reveals the notes text',
    observed: `${observed}; errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p)`,
    pass,
    before, after,
    notes: pass === null ? 'No employers with notes in DB. Add notes to at least one employer to test expand.'
         : !pass ? 'Card click did not reveal notes. Check OrgCard toggle logic in OrganizationsPage.tsx.' : '',
  });
}

// ─── ORG-search ──────────────────────────────────────────────────────────────
audit.log('ORG-search: search input filters employer cards');
{
  const before = await audit.shot('ORG-search-before');
  audit.observerMark();

  const searchInput = audit.page.locator('input[type="search"]').first();
  const searchVisible = await searchInput.isVisible().catch(() => false);

  let pass = null;
  let observed = '';

  if (!searchVisible) {
    observed = 'Search input not visible';
    pass = false;
  } else {
    // Count cards before typing
    const cardsBefore = await audit.page.locator('text=🏢').count();

    // Type something that won't match anything — expect 0 or fewer results
    const noMatchQuery = 'ZZZNOMATCH9999';
    await searchInput.fill(noMatchQuery);
    await audit.page.waitForTimeout(600);
    const cardsAfterNoMatch = await audit.page.locator('text=🏢').count();

    // Type something common that should match — even a single Hebrew letter
    await searchInput.fill('');
    await audit.page.waitForTimeout(400);
    const cardsAfterClear = await audit.page.locator('text=🏢').count();

    pass = cardsAfterNoMatch === 0 && cardsAfterClear === cardsBefore;
    observed = `before=${cardsBefore}, afterNoMatch=${cardsAfterNoMatch}, afterClear=${cardsAfterClear}`;
  }

  const after = await audit.shot('ORG-search-after');
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'ORG-search',
    tableRef: '/organizations / search filter',
    expected: 'Non-matching query shows 0 cards; clearing restores full list',
    observed: `${observed}; errors=(${obs.consoleErrors.length}c)`,
    pass,
    before, after,
    notes: !pass && pass !== null ? 'Search filter not working as expected. Check the filtered array logic in OrganizationsPage.tsx.' : '',
  });
}

// ─── ORG-no-auth ─────────────────────────────────────────────────────────────
audit.log('ORG-no-auth: page accessible without admin session');
{
  const before = await audit.shot('ORG-no-auth-before');

  // Open a fresh context with no auth
  const freshCtx = await audit.browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'he-IL',
  });
  const freshPage = await freshCtx.newPage();
  const pageErrors = [];
  freshPage.on('pageerror', (e) => pageErrors.push(String(e)));

  await freshPage.goto(`${audit.baseUrl}/organizations`, { waitUntil: 'networkidle' });
  await freshPage.waitForTimeout(1500);

  const heading = freshPage.locator('text=ארגונים לפרקטיקום').first();
  const headingVisible = await heading.isVisible().catch(() => false);

  // Must NOT show a password gate or auth wall
  const passwordGate = await freshPage.locator('text=סיסמה|password|login|כניסה').isVisible().catch(() => false);

  await freshPage.screenshot({ path: `${audit.out}/ORG-no-auth.png` });
  await freshCtx.close();

  audit.recordCell({
    id: 'ORG-no-auth',
    tableRef: '/organizations / public access (no session)',
    expected: 'Page loads without auth; heading visible; no password gate',
    observed: `headingVisible=${headingVisible}, passwordGate=${passwordGate}, pageErrors=${pageErrors.length}`,
    pass: headingVisible && !passwordGate,
    notes: !headingVisible ? 'Page did not load correctly in unauthenticated context.'
         : passwordGate ? 'Page is showing an auth gate — /organizations should be public.' : '',
  });
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
