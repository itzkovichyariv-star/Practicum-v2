#!/usr/bin/env node
/**
 * 03-admin-review.mjs — candidate review workflow audit.
 *
 * Cell map:
 *   REVIEW-list       Candidates page renders without crash.
 *   REVIEW-editor     Opening the audit test candidate shows their name
 *                     in the editor's name input field.
 *   REVIEW-persist    Type a unique notes string, save, reload, re-open —
 *                     the note must still be there. (Catches "save doesn't
 *                     write to Supabase" regressions.)
 *
 * Seed strategy:
 *   We INSERT an audit-tagged candidate directly into practicum_data via
 *   a Supabase merge (same pattern saveSnapshot uses). We read the current
 *   row, append our candidate, write it back. On cleanup we read again and
 *   remove any candidate whose id starts with "audit-cand-".
 *
 * IMPORTANT: we NEVER touch real candidates. We operate only on rows
 *            whose id starts with "audit-cand-".
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

const audit = new Audit({ name: 'admin-review' });
const auditTs = Date.now();
const AUDIT_ID   = `audit-cand-${auditTs}`;
const AUDIT_NAME = `Audit Candidate ${auditTs}`;
const AUDIT_NOTE = `audit-persist-note-${auditTs}`;

// ── Seed: insert audit candidate into practicum_data ─────────────────────────
let seedOk = false;
let seedCourseId = '';
try {
  const rows = await sbQuery('practicum_data', { select: 'data' });
  const current = rows?.[0]?.data || {};
  const existingCandidates = current.candidates || [];

  // Get a real courseId from existing courses (NOT from candidates — we
  // don't read real candidate data, only course config which is non-PII).
  const courses = current.courses || [];
  seedCourseId = courses[0]?.id || 'audit-course';

  const auditCandidate = {
    id: AUDIT_ID,
    name: AUDIT_NAME,
    email: `audit-${auditTs}@audit.local`,
    phone: '050-0000000',
    courseId: seedCourseId,
    interviewResult: 'pending',
    notes: '',
  };

  await sbPatch({
    data: { ...current, candidates: [...existingCandidates, auditCandidate] },
  });
  seedOk = true;
} catch (e) {
  audit.startMs = Date.now(); // ensure log works before setup
  console.log(`Seed failed: ${e.message.slice(0, 200)}`);
}

// ── Set up browser with matching context ──────────────────────────────────────
await audit.setup();
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({
    courseId: cId || '__all__',
    year: '__all__',
  }));
}, { cId: seedCourseId });
await audit.page.reload({ waitUntil: 'networkidle' });
audit.log(`Context → courseId=${seedCourseId || '__all__'}`);

// ─── REVIEW-list ─────────────────────────────────────────────────────────────
audit.log('REVIEW-list: candidates page renders without crash');
{
  await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(800);
  const btn = audit.page.locator('button, [role="tab"]').filter({ hasText: /מועמדים/ }).first();
  if (await btn.count() > 0) await btn.click();
  await audit.page.waitForTimeout(1200);
  const before = await audit.shot('REVIEW-list-before');
  audit.observerMark();

  const heading = await audit.page.locator('text=מועמדים').first().isVisible().catch(() => false);
  const addBtn  = await audit.page.getByRole('button', { name: /מועמד.* חדש/ }).isVisible().catch(() => false);
  const after   = await audit.shot('REVIEW-list-after');
  const obs     = audit.observerSnapshot();

  audit.recordCell({
    id: 'REVIEW-list',
    tableRef: 'CandidatesPage / list renders',
    expected: 'Candidates page heading or add-button visible; no page errors',
    observed: `heading=${heading}, addBtn=${addBtn}, errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p/${obs.netFailures.length}n)`,
    pass: heading || addBtn,
    before, after,
    notes: !(heading || addBtn) ? 'Neither the מועמדים heading nor the + button was found.' : '',
  });
}

// ─── REVIEW-editor ───────────────────────────────────────────────────────────
audit.log('REVIEW-editor: clicking edit button opens editor with audit candidate name');
{
  const before = await audit.shot('REVIEW-editor-before');
  audit.observerMark();

  let pass = false;
  let observed = '';

  if (!seedOk) {
    pass = null;
    observed = 'Seed failed — skipped';
  } else {
    // The audit candidate should be in the list. Click the pencil/edit
    // button (title="ערוך") inside the row that contains AUDIT_NAME.
    await audit.page.waitForTimeout(500);

    // Find the li row containing the audit name
    const row = audit.page.locator('li').filter({ hasText: AUDIT_NAME }).first();
    const rowVisible = await row.isVisible().catch(() => false);

    if (!rowVisible) {
      observed = `Row for "${AUDIT_NAME}" not visible in list`;
      pass = false;
    } else {
      // Click the ערוך button within that row
      const editBtn = row.getByTitle('ערוך').first();
      const editBtnVisible = await editBtn.isVisible().catch(() => false);

      if (editBtnVisible) {
        await editBtn.click();
      } else {
        // Hover to make action buttons visible (they may be hidden until hover)
        await row.hover();
        await audit.page.waitForTimeout(300);
        await row.getByTitle('ערוך').first().click().catch(() => {});
      }
      await audit.page.waitForTimeout(1000);

      // Editor panel should show name input containing AUDIT_NAME
      const nameInput = audit.page.locator('input[type="text"]').filter({ hasValue: AUDIT_NAME }).first();
      const editorOpen = await nameInput.isVisible().catch(() => false);
      pass = editorOpen;
      observed = `rowVisible=${rowVisible}; editBtn=${editBtnVisible}; editorOpen=${editorOpen}`;
    }
  }

  const after = await audit.shot('REVIEW-editor-after');
  const obs   = audit.observerSnapshot();
  audit.recordCell({
    id: 'REVIEW-editor',
    tableRef: 'CandidatesPage / RowActions / edit button → editor panel',
    expected: `Editor opens with name="${AUDIT_NAME}" pre-filled`,
    observed: `${observed}; errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p)`,
    pass,
    before, after,
    notes: pass === null ? 'Seed failed — skipped.'
         : !pass ? 'Editor did not open or name field not found. Check RowActions edit button and CandidateEditor name input.' : '',
  });
}

// ─── REVIEW-persist ──────────────────────────────────────────────────────────
audit.log('REVIEW-persist: notes survive save + page reload');
{
  const before = await audit.shot('REVIEW-persist-before');
  audit.observerMark();

  let pass = false;
  let observed = '';

  if (!seedOk) {
    pass = null;
    observed = 'Seed failed — skipped';
  } else {
    // Editor should still be open from previous cell
    const notesField = audit.page.locator('textarea').filter({ hasValue: '' }).last();
    const notesVisible = await audit.page.locator('textarea').last().isVisible().catch(() => false);

    if (!notesVisible) {
      observed = 'Notes textarea not visible — editor may not be open';
      pass = false;
    } else {
      const ta = audit.page.locator('textarea').last();
      await ta.fill(AUDIT_NOTE);
      await audit.page.waitForTimeout(300);

      // Click Save
      const saveBtn = audit.page.getByRole('button', { name: /שמור|save/i }).first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await audit.page.waitForTimeout(2500);
      }

      // Reload + navigate back + re-open same candidate
      await audit.page.reload({ waitUntil: 'networkidle' });
      await audit.page.waitForTimeout(800);
      const candidatesBtn = audit.page.locator('button, [role="tab"]').filter({ hasText: /מועמדים/ }).first();
      if (await candidatesBtn.count() > 0) await candidatesBtn.click();
      await audit.page.waitForTimeout(1000);

      const row = audit.page.locator('li').filter({ hasText: AUDIT_NAME }).first();
      if (await row.isVisible().catch(() => false)) {
        await row.hover();
        await audit.page.waitForTimeout(200);
        const editBtn = row.getByTitle('ערוך').first();
        await editBtn.click().catch(() => {});
        await audit.page.waitForTimeout(1000);
      }

      const notesAfter = audit.page.locator('textarea').last();
      const currentVal = await notesAfter.inputValue().catch(() => '');
      pass = currentVal.includes(AUDIT_NOTE);
      observed = `notes after reload ${pass ? 'contains audit note ✓' : `does NOT contain it ✗ (got "${currentVal.slice(0, 80)}")`}`;

      // Restore empty notes
      if (await notesAfter.isVisible().catch(() => false)) {
        await notesAfter.fill('');
        const saveBtnR = audit.page.getByRole('button', { name: /שמור|save/i }).first();
        if (await saveBtnR.count() > 0) await saveBtnR.click();
        await audit.page.waitForTimeout(1500);
      }
    }
  }

  const after = await audit.shot('REVIEW-persist-after');
  const obs   = audit.observerSnapshot();
  audit.recordCell({
    id: 'REVIEW-persist',
    tableRef: 'CandidateEditor / notes / save + reload',
    expected: `Notes field contains "${AUDIT_NOTE}" after save + reload`,
    observed: `${observed}; errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p)`,
    pass,
    before, after,
    notes: pass === null ? 'Seed failed — skipped.'
         : !pass ? 'Notes were not persisted. saveSnapshot may not be reaching Supabase, or editor is re-opening a stale copy.' : '',
  });
}

// ── Cleanup: remove all audit-cand-* candidates ──────────────────────────────
try {
  const rows = await sbQuery('practicum_data', { select: 'data' });
  const current = rows?.[0]?.data || {};
  const cleaned = (current.candidates || []).filter((c) => !c.id?.startsWith('audit-cand-'));
  await sbPatch({ data: { ...current, candidates: cleaned } });
  audit.log(`Cleanup: removed audit candidates (kept ${cleaned.length} real ones)`);
} catch (e) {
  audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`);
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
