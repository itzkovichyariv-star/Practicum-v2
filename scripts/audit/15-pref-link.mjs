#!/usr/bin/env node
/**
 * 15-pref-link.mjs — send the stage-2 (preference-selection) link from a student card.
 *
 *   PREFLINK-copy  The student editor's "📨 קישור אישי לבחירת העדפות" block copies
 *                  the correct personalized /cv-update?email=…&name=… link, and
 *                  exposes WhatsApp + email actions.
 *
 * Seeds a temp student, removes it after. No employer needed.
 */
import { Audit, sbQuery, mutateData, appReady } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'pref-link' });
const ts = Date.now();
const STU_ID = `audit-pl-${ts}`, STU_NAME = `מועמד קישור ${ts}`, STU_EMAIL = `audit-pl-${ts}@audit.local`, STU_PHONE = '0541234567';

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = (data.courses || [])[0]?.id || '';
  await mutateData(data => ({ ...data, students: [...(data.students || []), { id: STU_ID, name: STU_NAME, email: STU_EMAIL, phone: STU_PHONE, courseId }] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: audit.baseUrl }).catch(() => {});
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { cId: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1000);

audit.log('PREFLINK-copy: student card copies the personalized stage-2 link');
{
  audit.observerMark();
  let opened = false, clip = '', hasWa = false, hasMail = false;
  const expected = `${audit.baseUrl}/cv-update/?` + new URLSearchParams({ email: STU_EMAIL, name: STU_NAME }).toString();

  if (seedOk) {
    const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
    if (await row.isVisible().catch(() => false)) {
      const editBtn = row.getByTitle('ערוך').first();
      if (await editBtn.isVisible().catch(() => false)) await editBtn.click();
      else { await row.hover(); await audit.page.waitForTimeout(300); await row.getByTitle('ערוך').first().click().catch(() => {}); }
      await audit.page.waitForTimeout(1000);
      opened = true;

      const copyBtn = audit.page.getByRole('button', { name: /העתק קישור/ }).first();
      if (await copyBtn.count() > 0) {
        await copyBtn.scrollIntoViewIfNeeded();
        await copyBtn.click().catch(() => {});
        await audit.page.waitForTimeout(400);
        clip = await audit.page.evaluate(() => navigator.clipboard?.readText?.().then(t => t).catch(() => '') ?? '');
      }
      hasWa = await audit.page.evaluate(() => [...document.querySelectorAll('button')].some(b => /WhatsApp/.test(b.textContent || '')));
      hasMail = await audit.page.evaluate(() => [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'מייל'));
    }
  }

  const after = await audit.shot('PREFLINK-copy');
  const obs = audit.observerSnapshot();
  if (!seedOk || !opened) {
    audit.recordCell({ id: 'PREFLINK-copy', tableRef: 'StudentEditor / pref-link block', expected: 'open editor', observed: `seedOk=${seedOk}, opened=${opened}`, pass: seedOk ? false : null, notes: 'Could not seed/open.' });
  } else {
    const pass = clip === expected && hasWa && hasMail && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'PREFLINK-copy',
      tableRef: 'StudentEditor / "📨 קישור אישי לבחירת העדפות" — copy/WhatsApp/email',
      expected: `copy puts the personalized link on the clipboard (${expected}); WhatsApp + email actions present`,
      observed: `clip="${(clip || '').slice(0, 70)}", matches=${clip === expected}, wa=${hasWa}, mail=${hasMail}, errors=(${obs.pageErrors.length}p)`,
      pass, after,
      notes: clip !== expected ? `Clipboard link mismatch.` : (!hasWa || !hasMail) ? 'WhatsApp/email action missing.' : '',
    });
  }
}

try {
  const data = await loadData();
  await mutateData(data => ({ ...data, students: (data.students || []).filter(s => s.id !== STU_ID) }));
  audit.log('Cleanup: removed temp student');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
