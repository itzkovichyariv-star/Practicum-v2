#!/usr/bin/env node
/**
 * 62-public-form-anon.mjs — the PUBLIC form must never depend on anyone's login state.
 *
 *   PUBFORM-anon  With a STALE/EXPIRED Supabase auth session sitting in localStorage (the
 *                 state of any browser where the coordinator signed into the admin app on
 *                 the same origin), a candidate registration still uploads its CV and
 *                 submits successfully.
 *
 * Why this exists (Yariv, 2026-07-28 — "אני לא יכול להרשות לעצמי מערכת לא יציבה"): his CV
 * upload failed on the live form. Server side was ruled out (anon uploads succeed for pdf/
 * doc/docx/pages/png, up to the 50MB bucket cap, from node AND from the page origin, incl.
 * the multipart path supabase-js uses) and his attempt never reached storage.
 *
 * ⚠️ HONEST SCOPE: this cell does NOT reproduce that failure — the root cause was never
 * identified. It locks a related INVARIANT worth keeping: /register shares an origin with
 * the admin app, whose client persists the coordinator's magic-link session, so the public
 * form could upload as whoever is logged in. It now uses its own anonymous client
 * (publicSupabase: persistSession:false + separate storageKey) and this cell asserts the
 * upload presents the ANON key, never a user JWT.
 *
 * This cell was NOT proven RED→GREEN: with the old shared client it also stays green,
 * because supabase-js discards an unrefreshable session before the upload runs. Treat it as
 * a guard against future regressions (e.g. a valid admin session leaking into a public
 * write), not as evidence that the reported bug is fixed.
 *
 * Seeds its own future slot; removes the slot, the submission row and the uploaded CV.
 */
import { Audit, sbInsert, sbDelete, appReady } from '../audit-lib.mjs';

const SUPA = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const SBH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const PROJECT_REF = 'vpqgmcmavnszcnakhiat';

const ts = Date.now();
const slotDate = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
const EMAIL = `audit-anon-${ts}@audit.local`;
const NAME = `Audit AnonForm ${ts}`;

// An EXPIRED, well-formed-looking Supabase session — exactly what a long-idle admin tab holds.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const expiredJwt = [
  b64({ alg: 'HS256', typ: 'JWT' }),
  b64({ iss: `${SUPA}/auth/v1`, sub: '00000000-0000-0000-0000-000000000000', role: 'authenticated',
        email: 'yarivi@ariel.ac.il', exp: Math.floor(Date.now() / 1000) - 7200, iat: Math.floor(Date.now() / 1000) - 10800 }),
  'auditsignature_not_valid',
].join('.');
const staleSession = {
  access_token: expiredJwt, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) - 7200, refresh_token: 'audit-stale-refresh',
  user: { id: '00000000-0000-0000-0000-000000000000', email: 'yarivi@ariel.ac.il', role: 'authenticated' },
};

const audit = new Audit({ name: 'public-form-anon' });
await audit.setup();

let slotId = null;
try {
  const ins = await sbInsert('public_interview_slots', {
    date: slotDate, start_time: '09:00', end_time: '09:30', capacity: 1, booked_count: 0,
    course_name: 'פרקטיקום משאבי אנוש', note: `audit-anon-${ts}`,
  });
  slotId = (Array.isArray(ins) ? ins[0]?.id : ins?.id) ?? null;
} catch (e) { audit.log(`slot seed failed: ${e.message.slice(0, 120)}`); }

// Poison localStorage with the stale admin session BEFORE any of the app's JS runs
// (addInitScript executes on every navigation, ahead of the page scripts).
await audit.page.addInitScript(({ ref, sess }) => {
  try {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
    localStorage.setItem('supabase.auth.token', JSON.stringify({ currentSession: sess }));
  } catch (e) { /* storage unavailable */ }
}, { ref: PROJECT_REF, sess: staleSession });
await audit.page.goto(`${audit.baseUrl}/register`, { waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1000);

const sessionPresent = await audit.page.evaluate(
  (ref) => !!localStorage.getItem(`sb-${ref}-auth-token`), PROJECT_REF);
audit.log(`Stale admin session injected: ${sessionPresent}; slot ${slotId} on ${slotDate}`);

// Fill and submit exactly as a candidate would.
const consoleErrors = [];
audit.page.on('console', (m) => { if (m.type() === 'error' && /upload/i.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });

// THE load-bearing assertion: capture the credential the CV upload actually presents.
// It must be the ANON key — never a user JWT inherited from the admin session, because a
// user JWT is what turns into a 401 the moment that session goes stale.
const uploadAuth = [];
audit.page.on('request', (req) => {
  if (req.method() === 'POST' && /\/storage\/v1\/object\/candidate-uploads/.test(req.url())) {
    const h = req.headers();
    uploadAuth.push(String(h['authorization'] || h['Authorization'] || '').replace(/^Bearer /, ''));
  }
});

await audit.page.locator('input[type="text"]').nth(0).fill(NAME);
await audit.page.locator('input[type="email"]').first().fill(EMAIL);
await audit.page.locator('input[type="tel"]').first().fill('0501234567');
const city = audit.page.locator('input[type="text"]:not([id^="q-"])').nth(1);
if (await city.count()) await city.fill('Audit City');
for (const id of ['q-studyTracks', 'q-gpa', 'q-workHistory', 'q-favRole', 'q-leastFavRole',
  'q-whyPracticum', 'q-whySuitable', 'q-persistence', 'q-expectations']) {
  const el = audit.page.locator(`#${id}`);
  if (await el.count()) await el.fill('Audit placeholder text.');
}
// A real .docx (the format most CVs arrive in), not a text stub.
await audit.page.locator('input[type="file"]').first().setInputFiles({
  name: 'CV audit.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: Buffer.from(`PKaudit-cv-${ts}`, 'utf-8'),
});
if (slotId) {
  const mine = audit.page.locator(`input[type="radio"][name="slot"][value="${slotId}"]`);
  if (await mine.count()) await mine.check();
}
await audit.page.getByRole('button', { name: /שלח|הגש|submit/i }).first().click();
await audit.page.waitForFunction(
  () => /תודה|נשלח|בהצלחה|נכשלה/.test(document.body.textContent || ''), null, { timeout: 40_000 },
).catch(() => {});
await audit.page.waitForTimeout(600);

const seen = await audit.page.evaluate(() => {
  const t = document.body.innerText || '';
  return { thanks: /תודה|נקלט/.test(t), uploadFailed: /העלאת קורות החיים נכשלה/.test(t), snippet: t.slice(0, 200).replace(/\s+/g, ' ') };
});

// Ground truth: did the CV actually land in storage? (anon may INSERT rows but NOT read
// candidate_submissions — RLS grants SELECT to authenticated only — so verify the object.)
const cvFolder = EMAIL.split('@')[0];
let uploaded = [];
try {
  const r = await fetch(`${SUPA}/storage/v1/object/list/candidate-uploads`, {
    method: 'POST', headers: SBH,
    body: JSON.stringify({ prefix: `${cvFolder}/`, limit: 10, sortBy: { column: 'name', order: 'desc' } }),
  });
  const j = await r.json();
  if (Array.isArray(j)) uploaded = j;
} catch (e) { audit.log(`storage verify failed: ${e.message.slice(0, 100)}`); }
const cvLanded = uploaded.length > 0;

// anon key presented (not the injected user JWT) on every upload request
const usedAnonKey = uploadAuth.length > 0 && uploadAuth.every((t) => t === ANON);
const usedUserJwt = uploadAuth.some((t) => t.startsWith('eyJ') && t !== ANON);

const pass = slotId ? (seen.thanks && !seen.uploadFailed && cvLanded && usedAnonKey && !usedUserJwt) : null;
audit.recordCell({
  id: 'PUBFORM-anon',
  tableRef: '/register with a stale admin session in localStorage — publicSupabase (anon) client',
  expected: 'the public registration uploads the CV and submits successfully even when an EXPIRED admin Supabase session is present on the origin (the public form must not use anyone\'s login)',
  observed: slotId
    ? `staleSessionInjected=${sessionPresent}, thanksScreen=${seen.thanks}, uploadFailedMsg=${seen.uploadFailed}, cvInStorage=${cvLanded} (${uploaded.length}), uploadReqs=${uploadAuth.length}, usedAnonKey=${usedAnonKey}, usedUserJwt=${usedUserJwt}, uploadConsoleErrors=${consoleErrors.length}`
    : 'seed failed',
  pass,
  after: await audit.shot('public-form-anon'),
  notes: seen.uploadFailed
    ? `CV upload failed with an admin session present — the public form is still inheriting the login. console: ${consoleErrors.slice(0, 2).join(' | ')}`
    : (!cvLanded ? 'No CV object reached storage — the upload silently produced nothing.'
      : (usedUserJwt ? 'The upload presented a USER JWT — the public form is still inheriting the admin login, which 401s once that session goes stale.'
      : (!usedAnonKey ? 'Could not confirm the upload used the anon key.' : ''))),
});

// ── cleanup: submission row, uploaded CV, slot ───────────────────────────────
try {
  for (const o of uploaded) {
    await fetch(`${SUPA}/storage/v1/object/candidate-uploads/${cvFolder}/${o.name}`, { method: 'DELETE', headers: SBH }).catch(() => {});
  }
  await sbDelete('candidate_submissions', `email=eq.${encodeURIComponent(EMAIL)}`).catch(() => {});
  if (slotId) await sbDelete('public_interview_slots', `id=eq.${slotId}`);
  audit.log('Cleanup: submission, CV object and slot removed');
} catch (e) { audit.log(`cleanup (non-fatal): ${e.message.slice(0, 120)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
