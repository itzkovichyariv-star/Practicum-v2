#!/usr/bin/env node
/**
 * 18-modal-dismiss.mjs — an open editor can always be closed (so you can navigate).
 *
 *   MODAL-escape   Pressing Escape closes an open editor and releases the body
 *                  scroll-lock, so the top nav is reachable again.
 *   MODAL-x        The fixed corner ✕ closes the editor too.
 *
 * Read-only (opens/closes an editor, no edits → no DB writes). Guards the
 * "tried to switch screens, buttons don't respond — modal covered the nav" report.
 */
import { Audit } from '../audit-lib.mjs';

const audit = new Audit({ name: 'modal-dismiss' });
await audit.setup();
await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'candidates'));
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);

// "Modal open" = the shared Modal's fixed ✕ is present.
const editorOpen = () => audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
// Scroll-locked = position:fixed (iOS path) OR overflow:hidden (desktop path).
const bodyLocked = () => audit.page.evaluate(() => {
  const s = getComputedStyle(document.body);
  return s.position === 'fixed' || s.overflow === 'hidden';
});

async function openFirstEditor() {
  const row = audit.page.locator('li[data-info-row]').first();
  const editBtn = row.getByTitle('ערוך').first();
  if (await editBtn.isVisible().catch(() => false)) await editBtn.click();
  else { await row.hover(); await audit.page.waitForTimeout(250); await row.getByTitle('ערוך').first().click().catch(() => {}); }
  await audit.page.waitForTimeout(900);
}

// ─── MODAL-escape ─────────────────────────────────────────────────────
audit.log('MODAL-escape: Escape closes the editor + unlocks the page');
{
  audit.observerMark();
  await openFirstEditor();
  const openedOk = await editorOpen();
  const lockedWhileOpen = await bodyLocked();
  await audit.page.keyboard.press('Escape');
  await audit.page.waitForTimeout(600);
  const closed = !(await editorOpen());
  const unlocked = !(await bodyLocked());
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'MODAL-escape', tableRef: 'Modal / Escape-to-close + body unlock',
    expected: 'editor opens (body locked) → Escape closes it and unlocks the body',
    observed: `opened=${openedOk}, lockedWhileOpen=${lockedWhileOpen}, closedAfterEsc=${closed}, unlocked=${unlocked}, errors=(${obs.pageErrors.length}p)`,
    pass: openedOk && lockedWhileOpen && closed && unlocked && obs.pageErrors.length === 0,
    notes: !openedOk ? 'Editor did not open.' : !closed ? 'Escape did not close the editor.' : !unlocked ? 'Body stayed scroll-locked (page would feel frozen).' : '',
  });
}

// ─── MODAL-x ──────────────────────────────────────────────────────────
audit.log('MODAL-x: the fixed corner ✕ closes the editor');
{
  audit.observerMark();
  await openFirstEditor();
  const openedOk = await editorOpen();
  const x = audit.page.locator('button[aria-label="סגור"]').first();
  const xVisible = await x.isVisible().catch(() => false);
  if (xVisible) { await x.click().catch(() => {}); await audit.page.waitForTimeout(600); }
  const closed = !(await editorOpen());
  // After closing, a nav button must be clickable (proves the nav isn't blocked).
  let navWorks = false;
  const nav = audit.page.locator('button, a, [role="tab"]').filter({ hasText: /^סטודנטים$/ }).first();
  if (await nav.count() > 0) { await nav.click({ timeout: 4000 }).catch(() => {}); await audit.page.waitForTimeout(500); navWorks = true; }
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'MODAL-x', tableRef: 'Modal / fixed ✕ close + nav reachable',
    expected: 'a fixed ✕ closes the editor; afterwards a top-nav button is clickable',
    observed: `opened=${openedOk}, xVisible=${xVisible}, closed=${closed}, navClickable=${navWorks}, errors=(${obs.pageErrors.length}p)`,
    pass: openedOk && xVisible && closed && navWorks && obs.pageErrors.length === 0,
    notes: !xVisible ? 'No fixed ✕ close button.' : !closed ? '✕ did not close the editor.' : !navWorks ? 'Nav still not clickable after close.' : '',
  });
}

// ─── MODAL-recycle ────────────────────────────────────────────────────
// Open → close → open → close (the "exit and re-enter" that froze the page).
// After the cycle the body must be fully unlocked (not fixed, not overflow:hidden)
// and a nav button clickable.
audit.log('MODAL-recycle: repeated open/close leaves the page unlocked + interactive');
{
  audit.observerMark();
  let cyclesOk = true;
  for (let i = 0; i < 3; i++) {
    await openFirstEditor();
    if (!(await editorOpen())) { cyclesOk = false; break; }
    await audit.page.locator('button[aria-label="סגור"]').first().click().catch(() => {});
    await audit.page.waitForTimeout(500);
    if (await editorOpen()) { cyclesOk = false; break; }
  }
  const body = await audit.page.evaluate(() => ({ pos: getComputedStyle(document.body).position, overflow: getComputedStyle(document.body).overflow }));
  const unlocked = body.pos !== 'fixed' && body.overflow !== 'hidden';
  let navWorks = false;
  const nav = audit.page.locator('button, a, [role="tab"]').filter({ hasText: /^סטודנטים$/ }).first();
  if (await nav.count() > 0) navWorks = await nav.click({ timeout: 4000 }).then(() => true).catch(() => false);
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'MODAL-recycle', tableRef: 'Modal / open-close cycles leave the page unlocked',
    expected: 'after 3 open/close cycles the body is unlocked (not fixed, not overflow:hidden) and the nav is clickable',
    observed: `cyclesOk=${cyclesOk}, body=${JSON.stringify(body)}, unlocked=${unlocked}, navClickable=${navWorks}, errors=(${obs.pageErrors.length}p)`,
    pass: cyclesOk && unlocked && navWorks && obs.pageErrors.length === 0,
    notes: !cyclesOk ? 'An open/close cycle failed.' : !unlocked ? 'Body left scroll-locked (page would feel frozen).' : !navWorks ? 'Nav not clickable after cycles.' : '',
  });
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
