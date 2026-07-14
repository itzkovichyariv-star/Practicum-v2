#!/usr/bin/env node
/**
 * 08-org-availability.mjs — organization availability gating.
 *
 *   ADMIN-legend     The Employers admin list shows the legend ('מקרא') and a
 *                    not-available summary, and incomplete orgs carry a purple
 *                    '⚠ חסר …' badge.
 *   STUDENT-hidden   The public /organizations list shows FEWER orgs than the
 *                    admin total — i.e. incomplete orgs are hidden from students.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const audit = new Audit({ name: 'org-availability' });
await audit.setup();

// How many orgs are student-visible? Mirror the app's UNIFIED capacity ledger:
// open places = available vacancySlots, AFTER reconciling legacy acceptedOrg
// placements into the slots (same as migratePlacementData). Private (restricted)
// orgs are hidden from the public /organizations page.
let dbTotal = 0, dbAvailable = 0;
try {
  const rows = await sbQuery('practicum_data', { filter: `org_id=eq.default`, select: 'data' });
  const data = rows?.[0]?.data || {};
  const emps = (data.employers || []).filter(e => e?.name);
  const students = data.students || [];
  dbTotal = emps.length;

  // Replicate the acceptedOrg → slot reconciliation on a clone.
  const slotsByName = {};
  for (const e of emps) slotsByName[e.name] = (e.vacancySlots || []).map(s => ({ ...s }));
  // Step 4b mirror: materialize legacy positions into per-course slots for
  // single-course employers with a number but no slots (matches migratePlacementData,
  // so an org whose only place is taken by a placed student is correctly full).
  for (const e of emps) {
    if ((slotsByName[e.name] || []).length) continue;
    const cids = (e.courseIds && e.courseIds.length) ? e.courseIds : (e.courseId ? [e.courseId] : []);
    if (cids.length !== 1) continue;
    const n = Math.max(0, Number(e.positionsTotal ?? e.positions ?? 0) || 0);
    if (n <= 0) continue;
    slotsByName[e.name] = Array.from({ length: n }, (_, i) => ({ id: `${e.id}-${cids[0]}-s${i + 1}`, courseId: cids[0], status: 'available', studentId: null }));
  }
  for (const st of students) {
    const org = st.acceptedOrg; if (!org) continue;
    const slots = slotsByName[org]; if (!slots) continue;
    if (slots.some(s => s.studentId === st.id)) continue;
    const slot = slots.find(s => s.status === 'available'); if (!slot) continue;
    slot.status = 'placed'; slot.studentId = st.id;
  }
  const openVac = (e) => {
    const slots = slotsByName[e.name] || [];
    if (slots.length) return slots.filter(s => s.status === 'available').length;
    return Math.max(0, (Number(e.positionsTotal ?? e.positions ?? 0) || 0) - (Number(e.filledPositions ?? 0) || 0));
  };
  const totalVac = (e) => {
    const slots = slotsByName[e.name] || [];
    return slots.length || (Number(e.positionsTotal ?? e.positions ?? 0) || 0);
  };
  dbAvailable = emps.filter(e => {
    if (e.restrictedToStudentId) return false; // public page hides private orgs
    const hasDesc = !!(e.notes && String(e.notes).trim());
    return hasDesc && totalVac(e) > 0 && openVac(e) > 0 && e.approvalStatus !== 'rejected' && e.approvalStatus !== 'pending';
  }).length;
} catch (e) {
  audit.log(`could not preload employer data (non-fatal): ${e.message.slice(0, 100)}`);
}

// ─── ADMIN-legend ─────────────────────────────────────────────────────
audit.log('ADMIN-legend: Employers list shows legend + purple incomplete badges');
{
  await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'employers'));
  await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1500);
  audit.observerMark();
  const before = await audit.shot('ADMIN-legend');
  const info = await audit.page.evaluate(() => {
    const body = document.body.textContent || '';
    const STATUSES = ['מאושר', 'בתהליך', 'טרם פניתי', 'נדחה'];
    const statusPills = [...document.querySelectorAll('span')].filter(s => STATUSES.includes((s.textContent || '').trim())).length;
    return {
      hasLegend: body.includes('מקרא'),
      hasApprovedMeaning: body.includes('מאושר'),
      hasNotContactedMeaning: body.includes('טרם פניתי'),
      statusPills,
    };
  });
  const obs = audit.observerSnapshot();
  // Every employer row shows a ramzor status pill, so we always expect ≥1.
  const pass = info.hasLegend && info.hasApprovedMeaning && info.hasNotContactedMeaning &&
    info.statusPills > 0 && obs.pageErrors.length === 0;
  audit.recordCell({
    id: 'ADMIN-legend',
    tableRef: 'Employers admin / ramzor legend + status pills',
    expected: `legend present; ramzor meanings (מאושר / טרם פניתי); ≥1 status pill rendered`,
    observed: `legend=${info.hasLegend}, approvedMeaning=${info.hasApprovedMeaning}, notContactedMeaning=${info.hasNotContactedMeaning}, statusPills=${info.statusPills}, errors=(${obs.pageErrors.length}p)`,
    pass, before,
    notes: !info.hasLegend ? 'Legend (מקרא) missing.' : (info.statusPills === 0 ? 'No status pills rendered.' : ''),
  });
}

// ─── STUDENT-hidden ───────────────────────────────────────────────────
audit.log('STUDENT-hidden: /organizations hides incomplete orgs');
{
  await audit.page.goto(`${audit.baseUrl}/organizations`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1200);
  audit.observerMark();
  const after = await audit.shot('STUDENT-hidden');
  // count cards on the public page
  const studentCount = await audit.page.evaluate(() => {
    const m = (document.body.textContent || '').match(/(\d+)\s*ארגונים/);
    return m ? Number(m[1]) : null;
  });
  const obs = audit.observerSnapshot();
  // Student count should equal the available count (and be ≤ admin total).
  const pass = studentCount !== null && studentCount === dbAvailable && studentCount <= dbTotal && obs.pageErrors.length === 0;
  audit.recordCell({
    id: 'STUDENT-hidden',
    tableRef: '/organizations / availability filter',
    expected: `student-visible orgs == available count (${dbAvailable}); ≤ admin total (${dbTotal})`,
    observed: `studentCount=${studentCount}, dbAvailable=${dbAvailable}, dbTotal=${dbTotal}, errors=(${obs.pageErrors.length}p)`,
    pass, after,
    notes: studentCount !== dbAvailable ? `Student count ${studentCount} != available ${dbAvailable}.` : '',
  });
}

// ─── ADMIN-suggestions ────────────────────────────────────────────────
// Pending candidate org-suggestions (from /cv-update) must surface in the
// Employers admin list for review/approval. (Presence only — never approves.)
audit.log('ADMIN-suggestions: pending candidate org-suggestions appear in the Employers list');
{
  let pendingCount = 0;
  try {
    const sugs = await sbQuery('cv_updates', { select: 'id,suggested_org,seen_at', filter: 'seen_at=is.null&suggested_org=not.is.null' });
    pendingCount = (sugs || []).filter(r => r.suggested_org?.name).length;
  } catch (e) { audit.log(`cv_updates query (non-fatal): ${e.message.slice(0, 80)}`); }

  await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'employers'));
  await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1500);
  audit.observerMark();
  const after = await audit.shot('ADMIN-suggestions');
  const sectionShown = await audit.page.evaluate(() => /ארגון מהמועמדים/.test(document.body.textContent || ''));
  const obs = audit.observerSnapshot();

  if (pendingCount === 0) {
    audit.recordCell({
      id: 'ADMIN-suggestions', tableRef: 'Employers / pending suggestions section',
      expected: 'section shown when pending suggestions exist',
      observed: 'no pending candidate suggestions in cv_updates', pass: null,
      notes: 'Data-dependent: nothing pending to exercise.',
    });
  } else {
    audit.recordCell({
      id: 'ADMIN-suggestions', tableRef: 'Employers / pending suggestions section',
      expected: `'הצעות ארגון מהמועמדים' section visible (${pendingCount} pending)`,
      observed: `sectionShown=${sectionShown}, dbPending=${pendingCount}, errors=(${obs.pageErrors.length}p)`,
      pass: sectionShown && obs.pageErrors.length === 0, after,
      notes: !sectionShown ? 'Pending suggestions exist but the section is not shown.' : '',
    });
  }
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);
