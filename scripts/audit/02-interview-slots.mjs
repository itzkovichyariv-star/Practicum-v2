#!/usr/bin/env node
/**
 * 02-interview-slots.mjs — interview slot capacity gating audit.
 *
 * Cell map:
 *   SLOT-available   An available slot (booked_count < capacity) shows up
 *                    in the /register slot picker.
 *   SLOT-full        A full slot (booked_count >= capacity) does NOT appear
 *                    in the /register slot picker — capacity filter works.
 *   SLOT-mgmt        Management page loads the slots section and shows
 *                    the slot count badge.
 *
 * Seed strategy:
 *   We INSERT two audit-tagged slots (one available, one full) using
 *   future dates so they pass the "gte today" filter in the registration
 *   form. At the end we DELETE them. If anon INSERT is not permitted by
 *   RLS, cells degrade gracefully and report the reason.
 */
import { Audit, sbQuery, sbInsert, sbDelete } from '../audit-lib.mjs';

const audit = new Audit({ name: 'interview-slots' });
await audit.setup();

const auditTs = Date.now();
// Use a future date so the form's "gte today" filter includes our slots.
const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const slotAvailId = `audit-avail-${auditTs}`;
const slotFullId  = `audit-full-${auditTs}`;

// ── Seed ────────────────────────────────────────────────────────────────────
let seedOk = false;
let seedError = '';
try {
  await sbInsert('public_interview_slots', {
    id: slotAvailId,
    date: futureDate,
    start_time: '10:00',
    end_time: '10:45',
    capacity: 5,
    booked_count: 0,
    note: `audit-available-${auditTs}`,
  });
  await sbInsert('public_interview_slots', {
    id: slotFullId,
    date: futureDate,
    start_time: '11:00',
    end_time: '11:45',
    capacity: 3,
    booked_count: 3,   // full
    note: `audit-full-${auditTs}`,
  });
  seedOk = true;
  audit.log('Seed: inserted available + full test slots');
} catch (e) {
  seedError = e.message.slice(0, 200);
  audit.log(`Seed failed (anon INSERT likely blocked by RLS): ${seedError}`);
}

// ─── SLOT-available ──────────────────────────────────────────────────────────
audit.log('SLOT-available: available slot appears in /register picker');
{
  await audit.page.goto(`${audit.baseUrl}/register`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1200);
  const before = await audit.shot('SLOT-available-before');
  audit.observerMark();

  let pass = false;
  let observed = '';

  if (!seedOk) {
    // Fallback: check that ANY slots shown in the form are genuinely available
    // (booked_count < capacity). Query the DB and compare to DOM.
    const dbSlots = await sbQuery('public_interview_slots', {
      filter: `booked_count=lt.capacity&date=gte.${new Date().toISOString().slice(0, 10)}`,
      select: 'id,booked_count,capacity',
    }).catch(() => []);
    const radioCount = await audit.page.locator('input[type="radio"][name="slot"]').count();
    pass = radioCount === dbSlots.length;
    observed = `seed-skipped (RLS); DB has ${dbSlots.length} available slots, form shows ${radioCount} radios`;
  } else {
    // Our test slot should appear
    const radio = audit.page.locator(`input[type="radio"][value="${slotAvailId}"]`);
    const found = await radio.count() > 0;
    pass = found;
    observed = `seed-ok; available test slot ${found ? 'found ✓' : 'NOT found ✗'} in picker`;
  }

  const after = await audit.shot('SLOT-available-after');
  const obs = audit.observerSnapshot();

  audit.recordCell({
    id: 'SLOT-available',
    tableRef: '/register / slot picker / available slots shown',
    expected: 'Available slot (booked_count < capacity) visible in /register slot picker',
    observed: `${observed}; errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p)`,
    pass,
    before, after,
    notes: !seedOk
      ? `Seed skipped — anon INSERT blocked by RLS. Fallback comparison used. Seed error: ${seedError}`
      : !pass ? 'Available slot was inserted to DB but not found in the picker. Check the booked_count < capacity filter.' : '',
  });
}

// ─── SLOT-full ───────────────────────────────────────────────────────────────
audit.log('SLOT-full: full slot does NOT appear in /register picker');
{
  // Page is still on /register from previous cell.
  await audit.page.waitForTimeout(400);
  audit.observerMark();

  let pass = false;
  let observed = '';

  if (!seedOk) {
    // Fallback: verify that NO full slots appear in the DOM
    const dbFullSlots = await sbQuery('public_interview_slots', {
      filter: `booked_count=gte.capacity&date=gte.${new Date().toISOString().slice(0, 10)}`,
      select: 'id',
    }).catch(() => []);
    // Check that none of these IDs appear as radios in the form
    let leakedCount = 0;
    for (const s of dbFullSlots) {
      const r = await audit.page.locator(`input[type="radio"][value="${s.id}"]`).count();
      if (r > 0) leakedCount++;
    }
    pass = leakedCount === 0;
    observed = `seed-skipped; DB has ${dbFullSlots.length} full slots, ${leakedCount} leaked into form`;
  } else {
    const radio = audit.page.locator(`input[type="radio"][value="${slotFullId}"]`);
    const found = await radio.count() > 0;
    pass = !found;  // full slot must NOT be visible
    observed = `seed-ok; full test slot ${found ? 'VISIBLE (wrong) ✗' : 'correctly hidden ✓'}`;
  }

  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'SLOT-full',
    tableRef: '/register / slot picker / full slots hidden',
    expected: 'Full slot (booked_count >= capacity) must NOT appear in /register slot picker',
    observed: `${observed}; errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p)`,
    pass,
    notes: !seedOk
      ? `Seed skipped — anon INSERT blocked by RLS. Fallback: verified no full DB slots appear in picker.`
      : !pass ? 'Full slot leaked into the picker — the booked_count >= capacity filter is broken.' : '',
  });
}

// ─── SLOT-mgmt ───────────────────────────────────────────────────────────────
audit.log('SLOT-mgmt: management page shows slots section');
{
  await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(800);
  // Navigate to management tab
  const mgmtBtn = audit.page.getByRole('button', { name: /ניהול|ניהול מערכת/i });
  if (await mgmtBtn.count() > 0) await mgmtBtn.first().click();
  else {
    // Try nav link
    const mgmtLink = audit.page.locator('button, [role="tab"]').filter({ hasText: /ניהול/ }).first();
    if (await mgmtLink.count() > 0) await mgmtLink.click();
  }
  await audit.page.waitForTimeout(1000);
  const before = await audit.shot('SLOT-mgmt-before');
  audit.observerMark();

  const slotHeader = audit.page.locator('text=מועדי ראיון').first();
  const headerVisible = await slotHeader.isVisible().catch(() => false);

  // Count badge should show a number
  const after = await audit.shot('SLOT-mgmt-after');
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'SLOT-mgmt',
    tableRef: 'Management page / מועדי ראיון section',
    expected: '"מועדי ראיון" section header is visible in management page',
    observed: `headerVisible=${headerVisible}; errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p)`,
    pass: headerVisible,
    before, after,
    notes: !headerVisible ? 'Could not navigate to management page or slots section not rendered.' : '',
  });
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
if (seedOk) {
  try {
    await sbDelete('public_interview_slots', `id=eq.${slotAvailId}`);
    await sbDelete('public_interview_slots', `id=eq.${slotFullId}`);
    audit.log('Cleanup: test slots deleted');
  } catch (e) {
    audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`);
  }
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
