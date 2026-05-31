#!/usr/bin/env node
/**
 * 22-conducted-status.mjs — "ראיון בוצע" is a selectable status in the candidate
 * editor's "תוצאה / סטטוס" dropdown (alongside עבר / לא התקבל / טרם רואיין).
 *
 *   STATUS-option   Opening a candidate editor, the result/status <select>
 *                   exposes a "ראיון בוצע" option. Guards the user request to
 *                   surface the status where it's naturally looked for (not only
 *                   as the separate checkbox + filter tab).
 *
 * Read-only — opens an editor and inspects options, no selection, no DB writes.
 */
import { Audit } from '../audit-lib.mjs';

const audit = new Audit({ name: 'conducted-status' });
await audit.setup();
await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'candidates'));
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1300);

const P = audit.page;
audit.log('STATUS-option: the editor status dropdown offers "ראיון בוצע"');
{
  audit.observerMark();
  let opened = false, found = null, statusOpts = [];
  const pencil = P.locator('li[data-info-row] button[title="ערוך"]').first();
  if (await pencil.count() > 0) {
    await pencil.click().catch(() => {});
    await P.waitForTimeout(1200);
    opened = await P.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
    const r = await P.evaluate(() => {
      // The status select is the one whose options include the decision labels.
      const selects = [...document.querySelectorAll('select')];
      for (const s of selects) {
        const labels = [...s.options].map(o => o.textContent.trim());
        if (labels.includes('עבר') && labels.includes('לא התקבל')) {
          return { labels, hasConducted: labels.includes('ראיון בוצע') };
        }
      }
      return { labels: [], hasConducted: false };
    });
    statusOpts = r.labels;
    found = r.hasConducted;
    await P.keyboard.press('Escape').catch(() => {});
    await P.waitForTimeout(300);
  }
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'STATUS-option', tableRef: 'CandidateEditor / "תוצאה / סטטוס" dropdown',
    expected: 'the status dropdown lists "ראיון בוצע" as an option',
    observed: `editorOpened=${opened}, statusOptions=[${statusOpts.join(', ')}], hasConducted=${found}, errors=(${obs.pageErrors.length}p)`,
    pass: opened && found === true && obs.pageErrors.length === 0,
    notes: !opened ? 'Editor did not open.' : found ? '' : '"ראיון בוצע" not found in the status dropdown.',
  });
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
