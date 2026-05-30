#!/usr/bin/env node
/**
 * 11-email-personalization.mjs — per-recipient acceptance email.
 *
 *   GROUP-personalized  Selecting TWO passed candidates and sending the
 *                       acceptance opens ONE draft per recipient (TO, not BCC),
 *                       each carrying that person's own /cv-update?email=… link.
 *                       No shared BCC, no "[קישור אישי…]" placeholder.
 *
 * window.open is stubbed to capture the mailto: URLs instead of launching the OS
 * mail client, so we can assert exactly what each recipient would receive.
 *
 * Seeds two audit-tagged passed candidates and removes them at the end.
 * NEVER touches real candidates.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';

async function sbPatch(patch) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`sbPatch failed ${r.status}: ${await r.text().catch(() => '')}`);
}

const audit = new Audit({ name: 'email-personalization' });
const ts = Date.now();
const A_ID = `audit-cand-pp-a-${ts}`, B_ID = `audit-cand-pp-b-${ts}`;
const A_NAME = `Audit PP A ${ts}`, B_NAME = `Audit PP B ${ts}`;
const A_EMAIL = `audit-pp-a-${ts}@audit.local`, B_EMAIL = `audit-pp-b-${ts}@audit.local`;

// ── Seed two PASSED candidates ───────────────────────────────────────
let seedOk = false, seedCourseId = '';
try {
  const rows = await sbQuery('practicum_data', { select: 'data' });
  const current = rows?.[0]?.data || {};
  const existing = current.candidates || [];
  seedCourseId = (current.courses || [])[0]?.id || 'audit-course';
  await sbPatch({
    data: {
      ...current,
      candidates: [
        ...existing,
        { id: A_ID, name: A_NAME, email: A_EMAIL, courseId: seedCourseId, interviewResult: 'passed', interviewSummary: 'audit', notes: '' },
        { id: B_ID, name: B_NAME, email: B_EMAIL, courseId: seedCourseId, interviewResult: 'passed', interviewSummary: 'audit', notes: '' },
      ],
    },
  });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 200)}`); }

await audit.setup();
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'candidates');
}, { cId: seedCourseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(800);

audit.log('GROUP-personalized: two passed candidates → two personalized drafts');
{
  // Go to candidates → passed tab.
  const candidatesBtn = audit.page.locator('button, [role="tab"]').filter({ hasText: /מועמדים/ }).first();
  if (await candidatesBtn.count() > 0) { await candidatesBtn.click(); await audit.page.waitForTimeout(1000); }
  const passedTab = audit.page.locator('button').filter({ hasText: /עבר|עברה/ }).first();
  if (await passedTab.count() > 0) { await passedTab.click(); await audit.page.waitForTimeout(700); }

  // Select both audit candidates.
  let selected = 0;
  for (const name of [A_NAME, B_NAME]) {
    const row = audit.page.locator('li').filter({ hasText: name }).first();
    if (await row.isVisible().catch(() => false)) {
      const cb = row.locator('input[type="checkbox"]').first();
      if (await cb.count() > 0) { await cb.check().catch(() => {}); selected++; }
      await audit.page.waitForTimeout(250);
    }
  }

  const before = await audit.shot('GROUP-personalized-before');
  audit.observerMark();

  // Open the acceptance dialog via the SELECTED-recipients button
  // ("✓ הודעת קבלה (N)"), NOT the "send to whole filtered group" button — so the
  // draft count is deterministically the two we selected.
  let mailtos = [];
  let dialogOpen = false;
  const acceptBtn = audit.page.locator('button').filter({ hasText: /הודעת קבלה \(\d+\)/ }).first();
  if (selected === 2 && await acceptBtn.isVisible().catch(() => false)) {
    await acceptBtn.click();
    await audit.page.waitForTimeout(800);
    dialogOpen = await audit.page.locator('text=הודעת קבלה').first().isVisible().catch(() => false);

    // Stub window.open to capture the mailto URLs instead of launching mail.
    await audit.page.evaluate(() => {
      window.__mailtos = [];
      window.open = (u) => { window.__mailtos.push(String(u)); return null; };
    });

    // The acceptance-modal send button is uniquely "פתח ב‑Outlook (N) →".
    // Other "Outlook" buttons exist on the page (a group-mail launcher) and sit
    // behind the modal backdrop, so match the count suffix to target the right one.
    const sendBtn = audit.page.locator('button').filter({ hasText: /Outlook \(\d+\)/ }).first();
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click();
      await audit.page.waitForTimeout(700);
      mailtos = await audit.page.evaluate(() => window.__mailtos || []);
    }
  }
  const after = await audit.shot('GROUP-personalized-after');
  const obs = audit.observerSnapshot();

  if (!seedOk || selected !== 2 || !dialogOpen) {
    audit.recordCell({
      id: 'GROUP-personalized',
      tableRef: 'CandidatesPage / group acceptance / per-recipient drafts',
      expected: 'two passed candidates selected → acceptance dialog opens',
      observed: `seedOk=${seedOk}, selected=${selected}, dialogOpen=${dialogOpen}`,
      pass: seedOk ? false : null, before, after,
      notes: !seedOk ? 'Seed failed — candidates not in DB (RLS?).'
        : selected !== 2 ? 'Could not select both audit candidates on the passed tab.'
        : 'Acceptance dialog did not open.',
    });
  } else {
    const encA = encodeURIComponent(A_EMAIL), encB = encodeURIComponent(B_EMAIL);
    const count2 = mailtos.length === 2;
    const allHaveCvLink = mailtos.length > 0 && mailtos.every((m) => m.includes('cv-update'));
    const noBcc = mailtos.every((m) => !/bcc=/i.test(m));
    const noPlaceholder = mailtos.every((m) => !m.includes(encodeURIComponent('קישור אישי')));
    const toA = mailtos.some((m) => m.startsWith(`mailto:${encA}`) && m.includes(encA));
    const toB = mailtos.some((m) => m.startsWith(`mailto:${encB}`));
    const distinctRecipients = toA && toB;

    const pass = count2 && allHaveCvLink && noBcc && noPlaceholder && distinctRecipients && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'GROUP-personalized',
      tableRef: 'CandidatesPage / group acceptance / per-recipient personalized drafts',
      expected: '2 mailto drafts, one per recipient (TO not BCC), each with its own /cv-update link; no placeholder',
      observed: `drafts=${mailtos.length}, eachHasCvLink=${allHaveCvLink}, noBcc=${noBcc}, noPlaceholder=${noPlaceholder}, toA=${toA}, toB=${toB}, errors=(${obs.pageErrors.length}p)`,
      pass, before, after,
      notes: !count2 ? `Expected 2 drafts, got ${mailtos.length}.`
        : !allHaveCvLink ? 'A draft is missing its /cv-update link.'
        : !noBcc ? 'A draft still uses BCC.'
        : !distinctRecipients ? 'Drafts are not addressed to the two distinct recipients.'
        : !noPlaceholder ? 'Placeholder text still present.' : '',
    });
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────
try {
  const rows = await sbQuery('practicum_data', { select: 'data' });
  const current = rows?.[0]?.data || {};
  const cleaned = (current.candidates || []).filter((c) => !c.id?.startsWith('audit-cand-pp-'));
  await sbPatch({ data: { ...current, candidates: cleaned } });
  audit.log(`Cleanup: removed audit candidates (kept ${cleaned.length} real ones)`);
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
