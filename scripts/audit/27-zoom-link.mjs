#!/usr/bin/env node
/**
 * 27-zoom-link.mjs — per-day Zoom link: saved, independent of slots, own delete.
 *
 *   ZOOM-save        Pasting a link in a day's Zoom field persists it to
 *                    practicum_data.interviewZoomLinks[date].
 *   ZOOM-independent Deleting that day's interview SLOTS does NOT delete the Zoom
 *                    link (it lives independently of the slot rows).
 *
 * Seeds a temp slot on a unique far-future date; cleans up the slot AND the link.
 */
import { Audit, sbQuery, mutateData } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};
async function delSlotsForDate(date) {
  await fetch(`${SUPABASE_URL}/rest/v1/public_interview_slots?date=eq.${date}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' } });
}

const audit = new Audit({ name: 'zoom-link' });
const TDATE = '2099-01-09';
const LINK = `https://zoom.example/audit-${Date.now()}`;
let seedOk = false, slotId = '';
try {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/public_interview_slots`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ date: TDATE, start_time: '09:00', end_time: '09:15', capacity: 1, booked_count: 0 }),
  });
  const rows = await r.json(); slotId = rows?.[0]?.id || ''; seedOk = r.ok;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 120)}`); }

await audit.setup();
await audit.page.setViewportSize({ width: 1280, height: 1100 });
await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'management'));
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1800);

const P = audit.page;
// ─── ZOOM-save ──────────────────────────────────────────────────────────
audit.log('ZOOM-save: pasting a link persists it to interviewZoomLinks[date]');
{
  audit.observerMark();
  const input = P.locator(`input[data-zoom-date="${TDATE}"]`).first();
  let inputSeen = false, persisted = false;
  if (await input.count() > 0) {
    inputSeen = true;
    await input.scrollIntoViewIfNeeded();
    await input.fill(LINK);
    await input.blur();
    await P.waitForTimeout(1500); // saveSnapshot round-trip
    for (let i = 0; i < 8; i++) {
      const d = await loadData();
      if ((d.interviewZoomLinks || {})[TDATE] === LINK) { persisted = true; break; }
      await P.waitForTimeout(400);
    }
  }
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'ZOOM-save', tableRef: 'ManagementPage slots / per-day Zoom link',
    expected: 'pasting a Zoom link in a day saves it to interviewZoomLinks[date]',
    observed: `seedOk=${seedOk}, inputSeen=${inputSeen}, persisted=${persisted}, errors=(${obs.pageErrors.length}p)`,
    pass: seedOk ? (inputSeen && persisted && obs.pageErrors.length === 0) : null,
    notes: !seedOk ? 'seed failed' : !inputSeen ? 'No Zoom input for the seeded date.' : persisted ? '' : 'Link did not persist.',
  });
}

// ─── ZOOM-independent ───────────────────────────────────────────────────
audit.log('ZOOM-independent: deleting the day\'s slots keeps the Zoom link');
{
  audit.observerMark();
  let linkSurvives = null;
  if (seedOk) {
    await delSlotsForDate(TDATE);            // delete the interview slots for that day
    await P.waitForTimeout(800);
    const d = await loadData();              // link must still be there
    linkSurvives = (d.interviewZoomLinks || {})[TDATE] === LINK;
  }
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'ZOOM-independent', tableRef: 'interviewZoomLinks independent of slot rows',
    expected: 'deleting a day\'s interview slots does NOT delete its Zoom link',
    observed: `linkSurvivesSlotDeletion=${linkSurvives}`,
    pass: seedOk ? (linkSurvives === true) : null,
    notes: linkSurvives === false ? 'Zoom link was lost when slots were deleted.' : '',
  });
}

// ─── ZOOM-recreate ──────────────────────────────────────────────────────
// The reporter's real workflow: after deleting the test slots (link kept),
// RE-CREATE slots for the same day → the existing link must re-associate and
// still be picked up (both in the UI and by the email's date-keyed lookup).
audit.log('ZOOM-recreate: new slots for the same day re-associate with the kept link');
{
  audit.observerMark();
  let uiShowsLink = null, lookupResolves = null;
  if (seedOk) {
    // recreate a slot for the same date (slots were deleted in the previous step)
    await fetch(`${SUPABASE_URL}/rest/v1/public_interview_slots`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ date: TDATE, start_time: '11:00', end_time: '11:15', capacity: 1, booked_count: 0 }),
    });
    await P.evaluate(() => localStorage.setItem('practicum_v2_page', 'management'));
    await P.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
    await P.waitForTimeout(1600);
    uiShowsLink = await P.evaluate((d) => {
      const i = document.querySelector(`input[data-zoom-date="${d}"]`);
      return !!i && i.value && i.value.length > 0;
    }, TDATE);
    // email-side: parse a booked slot on the recreated day → link must resolve
    const data = await loadData();
    const note = `בחר מועד ראיון: ${TDATE} 11:00–11:15`;
    const m = note.match(/(\d{4}-\d{2}-\d{2})/);
    lookupResolves = !!m && (data.interviewZoomLinks || {})[m[1]] === LINK;
  }
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'ZOOM-recreate', tableRef: 'Zoom link re-associates with recreated slots',
    expected: 'after deleting then recreating a day\'s slots, the kept link shows in the UI AND resolves for the email',
    observed: `uiShowsLink=${uiShowsLink}, emailLookupResolves=${lookupResolves}`,
    pass: seedOk ? (uiShowsLink === true && lookupResolves === true) : null,
    notes: uiShowsLink === false ? 'Recreated day did not show the kept link.' : lookupResolves === false ? 'Email lookup did not resolve for the recreated day.' : '',
  });
}

// Cleanup: remove the temp slot(s) + the temp Zoom link key.
try {
  await delSlotsForDate(TDATE);
  const d = await loadData();
  // In-place mutation of a stale read is the same clobber as the spread form, just
  // less obvious: the whole blob still goes back, reverting anything written meanwhile.
  if (d.interviewZoomLinks && d.interviewZoomLinks[TDATE]) {
    await mutateData(data => {
      const next = { ...data, interviewZoomLinks: { ...(data.interviewZoomLinks || {}) } };
      delete next.interviewZoomLinks[TDATE];
      return next;
    });
  }
  audit.log('Cleanup: removed temp slot + temp zoom link');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
