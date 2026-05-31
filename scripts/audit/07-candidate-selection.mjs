#!/usr/bin/env node
/**
 * 07-candidate-selection.mjs — Candidates page selection + detail-card behavior.
 *
 * Guards two fixes:
 *   SELECT-toggle    A row checkbox selects (0→1) then deselects (1→0); the bulk
 *                    toolbar count mirrors it; clicking the checkbox does NOT
 *                    open the detail card; no page errors.
 *   HOVER-vs-CLICK   Hovering a row does NOT open the detail popover (it used to
 *                    open on hover/proximity), but clicking the row DOES.
 *
 * IMPORTANT: target only real row checkboxes (`li[data-info-row] input`). The
 * page also has non-row checkboxes (e.g. the "show processed" filter) — clicking
 * those is not a selection and previously produced a false "broken" reading.
 */
import { Audit } from '../audit-lib.mjs';

const audit = new Audit({ name: 'candidate-selection' });
await audit.setup();

await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'candidates'));
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await audit.page.waitForSelector('li[data-info-row] input[type="checkbox"]', { timeout: 15000 }).catch(() => {});
await audit.page.waitForTimeout(1500);

async function selCount() {
  return audit.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /הודעת קבלה/.test(x.textContent || ''));
    const m = b && b.textContent.match(/\((\d+)\)/);
    return m ? Number(m[1]) : 0;
  });
}
function popoverVisible() {
  return audit.page.evaluate(() => {
    const els = [...document.querySelectorAll('div')].filter(d => (d.textContent || '').includes('שלב:'));
    return els.some(d => { const s = getComputedStyle(d); return s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.5; });
  });
}

// ─── SELECT-toggle ────────────────────────────────────────────────────
audit.log('SELECT-toggle: row checkbox 0→1→0 without opening the detail card');
{
  audit.observerMark();
  const before = await audit.shot('SELECT-before');
  const cb = audit.page.locator('li[data-info-row] input[type="checkbox"]').first();
  const boxes = await audit.page.locator('li[data-info-row] input[type="checkbox"]').count();

  const c0 = await selCount();
  await cb.click();
  await audit.page.waitForTimeout(350);
  const c1 = await selCount();
  const popAfterClick = await popoverVisible();
  const checked1 = await cb.isChecked();
  await cb.click();
  await audit.page.waitForTimeout(350);
  const c2 = await selCount();

  const after = await audit.shot('SELECT-after');
  const obs = audit.observerSnapshot();
  const pass = boxes > 0 && c0 === 0 && c1 === 1 && c2 === 0 && checked1 === true && popAfterClick === false && obs.pageErrors.length === 0;
  audit.recordCell({
    id: 'SELECT-toggle',
    tableRef: '/candidates / row checkbox select + deselect',
    expected: 'count 0→1→0; checkbox checked mirrors it; checkbox click does NOT open the card; no page errors',
    observed: `boxes=${boxes}, count ${c0}→${c1}→${c2}, checked1=${checked1}, cardOnCbClick=${popAfterClick}, errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p)`,
    pass, before, after,
    notes: boxes === 0 ? 'No row checkboxes found.' :
           c1 !== 1 ? 'Checkbox did not register a selection.' :
           c2 !== 0 ? 'Could not deselect.' :
           popAfterClick ? 'Checkbox click opened the detail card (should not).' : '',
  });
}

// ─── HOVER-vs-CLICK ───────────────────────────────────────────────────
audit.log('HOVER-vs-CLICK: hover does NOT open the card; click does');
{
  await audit.page.reload({ waitUntil: 'networkidle' });
  await audit.page.waitForSelector('li[data-info-row]', { timeout: 10000 }).catch(() => {});
  await audit.page.waitForTimeout(900);
  audit.observerMark();
  const row = audit.page.locator('li[data-info-row]').first();
  await row.hover();
  await audit.page.waitForTimeout(500);
  const onHover = await popoverVisible();
  // Click the candidate NAME (line 1) — the intended preview trigger. Line 2
  // (contact + edit buttons) deliberately stopPropagation, so clicking the row's
  // geometric centre is not a reliable proxy for "the user clicked the row".
  await row.locator('.serif').first().click();
  await audit.page.waitForTimeout(400);
  const onClick = await popoverVisible();
  const after = await audit.shot('HOVER-after');
  const obs = audit.observerSnapshot();
  const pass = onHover === false && onClick === true && obs.pageErrors.length === 0;
  audit.recordCell({
    id: 'HOVER-vs-CLICK',
    tableRef: '/candidates / detail card trigger',
    expected: 'hover → card hidden; click → card shown; no page errors',
    observed: `onHover=${onHover}, onClick=${onClick}, errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p)`,
    pass, after,
    notes: onHover ? 'Card still opens on hover (the reported over-sensitivity).' :
           !onClick ? 'Card did not open on an intentional click.' : '',
  });
}

// ─── INBOX-select ─────────────────────────────────────────────────────
// Submission-inbox checkboxes must be selectable — including already-processed
// ('נקלט') submissions, which used to be disabled.
audit.log('INBOX-select: submission checkboxes (incl. processed) are not disabled and toggle');
{
  await audit.page.reload({ waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(900);
  audit.observerMark();
  // Reveal processed submissions so the previously-disabled ones are testable.
  const showProc = audit.page.getByText('הצג גם מעובדים', { exact: false });
  if (await showProc.count()) { await showProc.first().click().catch(() => {}); await audit.page.waitForTimeout(500); }

  const inboxBoxes = audit.page.locator('input[data-inbox-cb]');
  const n = await inboxBoxes.count();
  if (n === 0) {
    audit.recordCell({
      id: 'INBOX-select', tableRef: '/candidates / submission-inbox checkbox',
      expected: 'inbox submission checkboxes selectable (incl. processed)',
      observed: 'no submissions present in the inbox to exercise',
      pass: null, notes: 'Data-dependent: no inbox submissions to test in this context.',
    });
  } else {
    const anyDisabled = await audit.page.evaluate(() =>
      [...document.querySelectorAll('input[data-inbox-cb]')].some(cb => cb.disabled));
    const cb = inboxBoxes.first();
    await cb.click();
    await audit.page.waitForTimeout(300);
    const checked = await cb.isChecked();
    const after = await audit.shot('INBOX-after');
    const obs = audit.observerSnapshot();
    audit.recordCell({
      id: 'INBOX-select', tableRef: '/candidates / submission-inbox checkbox',
      expected: 'no inbox checkbox disabled; clicking one marks it; no page errors',
      observed: `count=${n}, anyDisabled=${anyDisabled}, checkedAfter=${checked}, errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p)`,
      pass: anyDisabled === false && checked === true && obs.pageErrors.length === 0,
      after,
      notes: anyDisabled ? 'A processed submission checkbox is still disabled.' :
             !checked ? 'Inbox checkbox did not toggle on click.' : '',
    });
  }
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
