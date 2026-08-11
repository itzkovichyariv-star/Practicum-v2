#!/usr/bin/env node
/**
 * 61-zoom-default.mjs — the PERMANENT default Zoom room.
 *
 *   ZOOMDEF-fallback  A booked slot on a day with NO per-day Zoom link still shows the
 *                     Zoom block on the confirmation screen, using
 *                     practicum_data.interviewZoomLinkDefault.
 *   ZOOMDEF-override  When that same day DOES have its own link, the per-day link wins.
 *
 * Why this exists (Yariv 2026-07-27): interview Zoom links used to be per-day only, so a
 * newly published interview date with no link left candidates reading "the link will be
 * sent later" on screen AND in the email. Yariv's standing rule is one personal Zoom room
 * that is always open, so the default makes a new date need no Zoom setup at all. The same
 * resolution (per-day || default) is duplicated in notify-submission/index.ts — if this
 * cell changes, check that function too, or the screen and the email drift apart.
 *
 * Seeds its own future slot + (for the override cell) a per-day link, and removes both.
 */
import { Audit, sbInsert, sbDelete, appReady } from '../audit-lib.mjs';

const SUPA = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const SBH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

const ts = Date.now();
const slotDate = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10);
const PER_DAY_LINK = `https://ariel-ac-il.zoom.us/j/perday-${ts}`;

const readBlob = async () => (await (await fetch(`${SUPA}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: SBH })).json())[0];
async function casBlob(mutate) {
  for (let i = 0; i < 6; i++) {
    const row = await readBlob();
    const next = mutate(structuredClone(row.data));
    const r = await fetch(`${SUPA}/rest/v1/practicum_data?org_id=eq.default&version=eq.${row.version}`, {
      method: 'PATCH', headers: { ...SBH, Prefer: 'return=representation' },
      body: JSON.stringify({ data: next, version: row.version + 1, updated_at: new Date().toISOString() }),
    });
    const j = await r.json().catch(() => null);
    if (Array.isArray(j) && j.length) return true;
  }
  return false;
}

const audit = new Audit({ name: 'zoom-default' });
await audit.setup();

// The default must exist for this feature to mean anything; remember whether we had to
// set it so we can restore the original value exactly.
const blob0 = await readBlob();
const originalDefault = String(blob0.data?.interviewZoomLinkDefault || '').trim();
const DEFAULT_LINK = originalDefault || `https://ariel-ac-il.zoom.us/j/default-${ts}`;
if (!originalDefault) await casBlob((d) => ({ ...d, interviewZoomLinkDefault: DEFAULT_LINK }));

let slotId = null;
try {
  const ins = await sbInsert('public_interview_slots', {
    date: slotDate, start_time: '11:00', end_time: '11:30', capacity: 1, booked_count: 0,
    course_name: 'פרקטיקום משאבי אנוש', note: `audit-zoomdef-${ts}`,
  });
  slotId = (Array.isArray(ins) ? ins[0]?.id : ins?.id) ?? null;
} catch (e) { audit.log(`slot seed failed: ${e.message.slice(0, 120)}`); }
audit.log(`Seeded slot ${slotId} on ${slotDate}; default="${DEFAULT_LINK.slice(0, 48)}" (pre-existing: ${!!originalDefault})`);

async function fillAndSubmit(email) {
  await audit.page.goto(`${audit.baseUrl}/register`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(900);
  await audit.page.locator('input[type="text"]').nth(0).fill(`Audit Zoomdef ${ts}`);
  await audit.page.locator('input[type="email"]').first().fill(email);
  await audit.page.locator('input[type="tel"]').first().fill('0501234567');
  const city = audit.page.locator('input[type="text"]:not([id^="q-"])').nth(1);
  if (await city.count()) await city.fill('Audit City');
  for (const id of ['q-studyTracks', 'q-gpa', 'q-workHistory', 'q-favRole', 'q-leastFavRole',
    'q-whyPracticum', 'q-whySuitable', 'q-persistence', 'q-expectations']) {
    const el = audit.page.locator(`#${id}`);
    if (await el.count()) await el.fill('Audit placeholder text.');
  }
  await audit.page.locator('input[type="file"]').first().setInputFiles({
    name: 'audit-cv.txt', mimeType: 'text/plain', buffer: Buffer.from(`zoomdef ${ts}`, 'utf-8'),
  });
  const mine = audit.page.locator(`input[type="radio"][name="slot"][value="${slotId}"]`);
  const picked = (await mine.count()) > 0;
  if (picked) await mine.check();
  await audit.page.getByRole('button', { name: /שלח|הגש|submit/i }).first().click();
  await audit.page.waitForFunction(() => /תודה|נשלח|בהצלחה/.test(document.body.textContent || ''), null, { timeout: 30_000 }).catch(() => {});
  await audit.page.waitForTimeout(400);
  const seen = await audit.page.evaluate(() => {
    const t = document.body.innerText || '';
    const a = [...document.querySelectorAll('a')].map((x) => x.getAttribute('href') || '');
    return { hasZoomBlock: /קישור לראיון בזום/.test(t), hasWaitingRoom: /חדר ההמתנה בזום/.test(t), links: a.filter((h) => /zoom\.us/.test(h)) };
  });
  return { picked, ...seen };
}

// ── ZOOMDEF-fallback — no per-day link for this date ──────────────────────────
const emailA = `audit-${ts}-zoomdef@audit.local`;
const a = await fillAndSubmit(emailA);
const usedDefault = a.links.some((h) => h === DEFAULT_LINK);
audit.recordCell({
  id: 'ZOOMDEF-fallback',
  tableRef: '/register success screen / default Zoom room when the day has no link',
  expected: 'a slot booked on a day with NO per-day Zoom link still shows the Zoom block, linking to interviewZoomLinkDefault',
  observed: `slotOffered=${a.picked}, hasZoomBlock=${a.hasZoomBlock}, hasWaitingRoom=${a.hasWaitingRoom}, usedDefaultLink=${usedDefault}, links=${JSON.stringify(a.links).slice(0, 160)}`,
  pass: slotId ? (a.picked && a.hasZoomBlock && a.hasWaitingRoom && usedDefault) : null,
  after: await audit.shot('zoomdef-fallback'),
  notes: !a.picked ? 'Seeded slot was not offered in the picker — cannot judge the Zoom block.'
    : !a.hasZoomBlock ? 'No Zoom block: a new interview date would tell candidates "the link will be sent later" instead of the permanent room.'
    : !usedDefault ? 'Zoom block shown but not the default link.' : '',
});

// ── ZOOMDEF-override — the day's own link wins over the default ───────────────
let overrideRan = false, b = null;
if (slotId) {
  // release the slot we just booked so it can be booked again
  await fetch(`${SUPA}/rest/v1/public_interview_slots?id=eq.${slotId}`, {
    method: 'PATCH', headers: { ...SBH, Prefer: 'return=minimal' }, body: JSON.stringify({ booked_count: 0, booked_by: null }),
  }).catch(() => {});
  const linked = await casBlob((d) => ({ ...d, interviewZoomLinks: { ...(d.interviewZoomLinks || {}), [slotDate]: PER_DAY_LINK } }));
  if (linked) {
    overrideRan = true;
    b = await fillAndSubmit(`audit-${ts}-zoomovr@audit.local`);
  }
}
audit.recordCell({
  id: 'ZOOMDEF-override',
  tableRef: '/register success screen / per-day Zoom link overrides the default',
  expected: "when the booked day HAS its own Zoom link, the screen shows THAT link, not the default",
  observed: overrideRan ? `hasZoomBlock=${b.hasZoomBlock}, usedPerDay=${b.links.includes(PER_DAY_LINK)}, usedDefault=${b.links.includes(DEFAULT_LINK)}, links=${JSON.stringify(b.links).slice(0, 160)}` : 'setup failed (slot or per-day link not seeded)',
  pass: overrideRan ? (b.hasZoomBlock && b.links.includes(PER_DAY_LINK) && !b.links.includes(DEFAULT_LINK)) : null,
  after: overrideRan ? await audit.shot('zoomdef-override') : undefined,
  notes: overrideRan && b.links.includes(DEFAULT_LINK) ? 'Default link shown even though the day has its own — per-day must win.' : '',
});

// ── cleanup: slot row, the per-day link, and the default if WE introduced it ──
try {
  if (slotId) await sbDelete('public_interview_slots', `id=eq.${slotId}`);
  // `%40` decodes to '@', so the intended wildcard vanished and this matched NOTHING —
  // every run left its submissions behind. PostgREST takes `*` as the LIKE wildcard.
  // Measured before and after: the old form matched 0 rows, this one matched all 56
  // that had accumulated in Yariv's submissions inbox by 2026-08-11.
  await sbDelete('candidate_submissions', `email=like.audit-${ts}-*@audit.local`).catch(() => {});
  const cleaned = await casBlob((d) => {
    const links = { ...(d.interviewZoomLinks || {}) };
    delete links[slotDate];
    const out = { ...d, interviewZoomLinks: links };
    if (!originalDefault) delete out.interviewZoomLinkDefault; // restore: we added it
    return out;
  });
  audit.log(`Cleanup: slot + per-day link removed (blob write: ${cleaned}); default ${originalDefault ? 'left as-is' : 'removed (we added it)'}`);
} catch (e) { audit.log(`cleanup (non-fatal): ${e.message.slice(0, 120)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
