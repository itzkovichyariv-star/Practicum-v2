#!/usr/bin/env node
/**
 * 21-edit-target.mjs — the row "edit" affordance is an easy, reliable target.
 *
 *   EDIT-size         The candidate row's edit (pencil) button is a generous
 *                     target (>=36px) — the old 28px circle was easy to miss,
 *                     producing "false" clicks and the feeling of needing several
 *                     clicks to enter edit mode.
 *   EDIT-rapid-click  Clicking the pencil several times in quick succession
 *                     leaves the editor OPEN. Regression guard for the bug where
 *                     click 1 opened the modal and click 2 landed on its backdrop
 *                     and closed it (an even number of clicks netted CLOSED — the
 *                     "sometimes I need 3 clicks" report). The Modal now ignores
 *                     backdrop-close for ~500ms after open.
 *
 * Read-only (opens/closes an editor, no DB writes).
 */
import { Audit } from '../audit-lib.mjs';

const audit = new Audit({ name: 'edit-target' });
await audit.setup();
await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'candidates'));
await audit.page.setViewportSize({ width: 1440, height: 900 });
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1300);

const P = audit.page;
const editorOpen = () => P.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));

// ─── EDIT-size ────────────────────────────────────────────────────────────
audit.log('EDIT-size: the edit pencil is a generous (>=36px) target');
{
  audit.observerMark();
  const size = await P.evaluate(() => {
    const b = document.querySelector('li[data-info-row] button[title="ערוך"]')?.getBoundingClientRect();
    return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null;
  });
  const obs = audit.observerSnapshot();
  const big = !!size && size.w >= 36 && size.h >= 36;
  audit.recordCell({
    id: 'EDIT-size', tableRef: 'RowActions / edit button hit target',
    expected: 'the row edit (pencil) button is at least 36×36px',
    observed: `size=${JSON.stringify(size)}, errors=(${obs.pageErrors.length}p)`,
    pass: big && obs.pageErrors.length === 0,
    notes: big ? '' : 'Edit button smaller than 36px — an easy target to miss.',
  });
}

// ─── EDIT-rapid-click ───────────────────────────────────────────────────────
audit.log('EDIT-rapid-click: clicking the pencil 2× fast leaves the editor OPEN');
{
  audit.observerMark();
  if (await editorOpen()) { await P.keyboard.press('Escape'); await P.waitForTimeout(300); }
  const pencil = P.locator('li[data-info-row] button[title="ערוך"]').first();
  let twoClicksOpen = null, rowSeen = false;
  if (await pencil.count() > 0) {
    rowSeen = true;
    await pencil.scrollIntoViewIfNeeded();
    await P.waitForTimeout(120);
    const box = await pencil.boundingBox();
    if (box) {
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await P.mouse.click(x, y);      // opens
      await P.waitForTimeout(80);
      await P.mouse.click(x, y);      // 2nd fast click would hit the backdrop
      await P.waitForTimeout(450);
      twoClicksOpen = await editorOpen();
      if (twoClicksOpen) { await P.keyboard.press('Escape'); await P.waitForTimeout(250); }
    }
  }
  const obs = audit.observerSnapshot();
  if (!rowSeen) {
    audit.recordCell({ id: 'EDIT-rapid-click', tableRef: 'Modal / backdrop-close guard', expected: 'editor stays open on a fast double-click', observed: 'no candidate row available', pass: null, notes: 'No candidate rows to test.' });
  } else {
    audit.recordCell({
      id: 'EDIT-rapid-click', tableRef: 'Modal / backdrop-close guard after open',
      expected: 'a fast 2× click on the edit pencil leaves the editor OPEN (2nd click does not close it via the backdrop)',
      observed: `editorOpenAfterDoubleClick=${twoClicksOpen}, errors=(${obs.pageErrors.length}p)`,
      pass: twoClicksOpen === true && obs.pageErrors.length === 0,
      notes: twoClicksOpen ? '' : 'A fast second click closed the just-opened editor (backdrop race).',
    });
  }
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
