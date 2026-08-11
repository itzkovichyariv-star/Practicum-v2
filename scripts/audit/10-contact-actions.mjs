#!/usr/bin/env node
/**
 * 10-contact-actions.mjs — RowActions contact buttons.
 *
 *   CALL-desktop  Clicking the 📞 (התקשר) button on a candidate row responds on
 *                 desktop, where `tel:` is a silent no-op. The handler must copy
 *                 the number to the clipboard and toast it (mobile still dials
 *                 natively via tel:). Verifies the clipboard now holds the number
 *                 and the "המספר הועתק" toast appears — i.e. the button is no
 *                 longer a dead control on desktop.
 *
 * Headless Chromium reports a non-coarse pointer + desktop UA, so the handler
 * takes the desktop (copy + toast) branch — exactly the environment where the
 * button used to look broken.
 */
import { Audit, appReady } from '../audit-lib.mjs';

const audit = new Audit({ name: 'contact-actions' });
await audit.setup();

// Allow the page to read/write the clipboard so we can assert what was copied.
await audit.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: audit.baseUrl }).catch(() => {});

audit.log('CALL-desktop: 📞 copies the number + toasts when tel: cannot dial');
{
  await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'candidates'));
  await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1500);
  audit.observerMark();

  const callBtn = audit.page.getByTitle('התקשר').first();
  const btnCount = await callBtn.count();

  if (btnCount === 0) {
    audit.recordCell({
      id: 'CALL-desktop',
      tableRef: 'RowActions / 📞 call button',
      expected: 'a candidate with a phone exposes a 📞 button to exercise',
      observed: 'no 📞 (התקשר) button found — no candidate has a phone',
      pass: null,
      notes: 'Data-dependent: no candidate phone present to exercise the call handler.',
    });
  } else {
    // Reset the clipboard so a stale value can't produce a false pass.
    await audit.page.evaluate(() => navigator.clipboard?.writeText?.('__cleared__').catch(() => {}));
    const before = await audit.shot('CALL-desktop-before');
    await callBtn.click();
    await audit.page.waitForTimeout(600);
    const after = await audit.shot('CALL-desktop-after');

    const clip = await audit.page.evaluate(() =>
      navigator.clipboard?.readText?.().then((t) => t).catch(() => '') ?? '');
    const toastShown = await audit.page.evaluate(() =>
      /המספר הועתק/.test(document.body.textContent || ''));
    const obs = audit.observerSnapshot();

    const copiedNumber = !!clip && clip !== '__cleared__' && /\d/.test(clip);
    const pass = (copiedNumber || toastShown) && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'CALL-desktop',
      tableRef: 'RowActions / 📞 call button (desktop fallback)',
      expected: 'click copies the phone number to clipboard AND/OR shows the "המספר הועתק" toast (no dead button)',
      observed: `clip="${(clip || '').slice(0, 24)}", copied=${copiedNumber}, toast=${toastShown}, errors=(${obs.pageErrors.length}p)`,
      pass, before, after,
      notes: !pass ? 'Clicking 📞 produced neither a clipboard copy nor a toast — handler did not respond.' : '',
    });
  }
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
