#!/usr/bin/env node
/**
 * 12-popover-dismiss.mjs — the pinned candidate detail popover can always close.
 *
 *   POPOVER-x         Pinning a row then clicking the ✕ closes it.
 *   POPOVER-escape    Pressing Escape closes a pinned popover.
 *   POPOVER-outside   Clicking outside a pinned popover closes it.
 *
 * Pure UI interaction (pinning is local state) — no DB writes, no seeding.
 * Regression guard for "popover stuck, ✕ won't close it".
 */
import { Audit, appReady, seedCandidate } from '../audit-lib.mjs';

const audit = new Audit({ name: 'popover-dismiss' });
// This cell needs a candidate on screen. It used to rely on whoever happened to be
// mid-process, and when the list emptied out (2026-08-11) it reported a FAILURE rather
// than an absence — "opened=false" reads as a broken control, not an empty screen.
const seeded = await seedCandidate();
await audit.setup();
await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'candidates'));
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1500);

const popVisible = () => audit.page.evaluate(() =>
  [...document.querySelectorAll('div[data-popover-open="true"]')].some(p => {
    const s = getComputedStyle(p);
    return s.opacity === '1' && s.visibility === 'visible';
  }));

async function pinLastRow() {
  const rows = audit.page.locator('li[data-info-row]');
  const n = await rows.count();
  if (n === 0) return false;
  await rows.nth(n - 1).locator('.serif').first().click();
  await audit.page.waitForTimeout(500);
  return popVisible();
}

// ─── POPOVER-x ────────────────────────────────────────────────────────
audit.log('POPOVER-x: ✕ closes the pinned popover');
{
  audit.observerMark();
  const opened = await pinLastRow();
  const before = await audit.shot('POPOVER-x-open');
  const x = audit.page.locator('div[data-popover-open="true"] button').filter({ hasText: '✕' }).first();
  if (await x.count() > 0) await x.click().catch(() => {});
  await audit.page.waitForTimeout(500);
  const closed = !(await popVisible());
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'POPOVER-x', tableRef: 'Popover / ✕ close button',
    expected: 'pin row → ✕ → popover closed',
    observed: `opened=${opened}, closedAfterX=${closed}, errors=(${obs.pageErrors.length}p)`,
    pass: opened && closed && obs.pageErrors.length === 0, before, after: await audit.shot('POPOVER-x-closed'),
    notes: !opened ? 'Popover did not open.' : !closed ? '✕ did not close the popover (stuck).' : '',
  });
}

// ─── POPOVER-escape ───────────────────────────────────────────────────
audit.log('POPOVER-escape: Escape closes the pinned popover');
{
  audit.observerMark();
  const opened = await pinLastRow();
  await audit.page.keyboard.press('Escape');
  await audit.page.waitForTimeout(500);
  const closed = !(await popVisible());
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'POPOVER-escape', tableRef: 'Popover / Escape-to-close',
    expected: 'pin row → Escape → popover closed',
    observed: `opened=${opened}, closedAfterEsc=${closed}, errors=(${obs.pageErrors.length}p)`,
    pass: opened && closed && obs.pageErrors.length === 0,
    notes: !opened ? 'Popover did not open.' : !closed ? 'Escape did not close the popover.' : '',
  });
}

// ─── POPOVER-outside ──────────────────────────────────────────────────
audit.log('POPOVER-outside: clicking outside closes the pinned popover');
{
  audit.observerMark();
  const opened = await pinLastRow();
  // Click a neutral spot near the top-left, away from any row/popover.
  await audit.page.mouse.click(20, 20);
  await audit.page.waitForTimeout(500);
  const closed = !(await popVisible());
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'POPOVER-outside', tableRef: 'Popover / click-outside-to-close',
    expected: 'pin row → click outside → popover closed',
    observed: `opened=${opened}, closedAfterOutside=${closed}, errors=(${obs.pageErrors.length}p)`,
    pass: opened && closed && obs.pageErrors.length === 0,
    notes: !opened ? 'Popover did not open.' : !closed ? 'Outside click did not close the popover.' : '',
  });
}

await seeded.remove();
await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
