#!/usr/bin/env node
/**
 * 69-strip-states-seeded.mjs — the strip's behaviour, on states we CREATE.
 *
 * Cell 64's browser layer is deliberately read-only: it asserts against whatever real
 * students exist, so it stays green while Yariv works. The cost showed up on 2026-08-11,
 * when his board went quiet: five of its cells reported "no student is in the ours turn
 * right now" / "no mixed row on screen" / "nobody waiting" and skipped. Honest, but a
 * probe that never runs is not coverage — the most important behaviours of the feature
 * were untested precisely because the data happened to be calm.
 *
 * So this cell seeds the states instead of hoping for them, and removes them afterwards:
 *
 *   SEEDED-turn-filter      the ours filter narrows to exactly the ours rows, and restores
 *   SEEDED-queue-lists      "ממתינים לך" lists whoever is waiting, one action each
 *   SEEDED-mixed-actions    on a mixed row, picking the LIST org drops "אשר השמה"
 *   SEEDED-pick-names-target  the send button names the org it will actually send to
 *   SEEDED-blocked-explains a full org says why, and names who holds the place
 *
 * Seeds three students in one course and deletes them, dispatches included.
 */
import { Audit, mutateData, sbQuery, appReady } from '../audit-lib.mjs';

const ts = Date.now();
const tag = ts.toString(36).slice(-5);
const SUGG = `zs1-${tag}`, PICK = `zs2-${tag}`, HOLD = `zs3-${tag}`;
const NAMES = { [SUGG]: `מעורב ${ts}`, [PICK]: `לשליחה ${ts}`, [HOLD]: `תופס מקום ${ts}` };
const PRIV = `${SUGG}-priv`, SHARED = `${SUGG}-shared`, FULL = `${SUGG}-full`;
const ORG_PRIV = `ארגון פרטי ${ts}`, ORG_SHARED = `ארגון משותף ${ts}`, ORG_FULL = `ארגון תפוס ${ts}`;

const d0 = (await sbQuery('practicum_data', { select: 'data' }))[0].data;
const course = (d0.courses || []).find(c => c.id === 'hr-practicum-tashpaz')
  || (d0.courses || []).find(c => c?.type === 'practicum' && c?.year);
const courseId = course?.id, year = course?.year;

const slot = (id, status, studentId = null, prefRank = null) =>
  ({ id, courseId, status, studentId, prefRank, history: [] });
const stu = (id, over) => ({
  id, name: NAMES[id], email: `${id}@audit.local`, courseId, year,
  cvUrl: 'storage://candidate-uploads/x.pdf', cvUpdatedUrl: 'storage://candidate-uploads/x-new.pdf',
  submissionStatus: 'submitted', preparation: { passed: true }, ...over,
});

let seeded = false;
if (courseId) {
  await mutateData(data => ({
    ...data,
    employers: [
      ...(data.employers || []),
      // one the student brought — private to them, so the row offers place_direct
      { id: PRIV, name: ORG_PRIV, approvalStatus: 'approved', contactStatus: 'approved', addedBy: 'student',
        restrictedToStudentId: SUGG, courseIds: [courseId], positionsTotal: 1, positions: 1,
        contactPerson: 'איש קשר', contactPhone: '050-1112222', contactEmail: 'p@audit.local',
        vacancySlots: [slot(`${PRIV}-s1`, 'available')] },
      // one from the shared list with room — the row may send a CV here
      { id: SHARED, name: ORG_SHARED, approvalStatus: 'approved', contactStatus: 'approved', addedBy: 'admin',
        restrictedToStudentId: null, courseIds: [courseId], positionsTotal: 2, positions: 2,
        contactPerson: 'איש קשר', contactPhone: '050-3334444', contactEmail: 's@audit.local',
        vacancySlots: [slot(`${SHARED}-s1`, 'available'), slot(`${SHARED}-s2`, 'available')] },
      // and one whose only place is already held, so a chip must explain WHY it is blocked
      { id: FULL, name: ORG_FULL, approvalStatus: 'approved', contactStatus: 'approved', addedBy: 'admin',
        restrictedToStudentId: null, courseIds: [courseId], positionsTotal: 1, positions: 1,
        contactPerson: 'איש קשר', contactPhone: '050-5556666', contactEmail: 'f@audit.local',
        vacancySlots: [slot(`${FULL}-s1`, 'under_review', HOLD, 1)] },
    ],
    students: [
      ...(data.students || []),
      // mixed: an org they brought (rank 1) + one from the list (rank 2) → ours
      stu(SUGG, { firstChoiceOrg: ORG_PRIV, secondChoiceOrg: ORG_SHARED }),
      // sendable: list org with room (rank 1) + a blocked one (rank 2) → ours
      stu(PICK, { firstChoiceOrg: ORG_SHARED, secondChoiceOrg: ORG_FULL }),
      // the student holding the only place at the full org
      stu(HOLD, { firstChoiceOrg: ORG_FULL,
        preferences: [{ rank: 1, orgName: ORG_FULL, employerId: FULL, status: 'under_review', slotId: `${FULL}-s1`, interviewResult: 'pending' }] }),
    ],
  }));
  seeded = true;
}

const audit = new Audit({ name: 'strip-states-seeded' });
await audit.setup();

if (!seeded) {
  audit.recordCell({ id: 'SEEDED-setup', expected: 'a practicum course to seed into', observed: 'none found', pass: null });
} else {
  await audit.page.evaluate(([c, y]) => {
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c, year: y }));
    localStorage.setItem('practicum_v2_page', 'students');
  }, [courseId, year]);
  await audit.page.reload({ waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1500);

  const expandAll = () => audit.page.evaluate(async () => {
    document.querySelectorAll('[data-strip-expand="closed"]').forEach(b => b.click());
    await new Promise(r => setTimeout(r, 400));
  });

  // ── the turn filter, with rows guaranteed to be in that turn ──────────────
  const filter = await audit.page.evaluate(async () => {
    window.scrollTo(0, 0);
    const before = [...document.querySelectorAll('[data-placement-strip]')];
    const oursBefore = before.filter(s => s.getAttribute('data-turn') === 'ours').length;
    document.querySelector('[data-turn-filter="ours"]')?.click();
    await new Promise(r => setTimeout(r, 400));
    const turns = [...document.querySelectorAll('[data-placement-strip]')].map(s => s.getAttribute('data-turn'));
    document.querySelector('[data-turn-filter="all"]')?.click();
    await new Promise(r => setTimeout(r, 400));
    const restored = document.querySelectorAll('[data-placement-strip]').length;
    return { oursBefore, shown: turns.length, allOurs: turns.every(t => t === 'ours'), restored, total: before.length };
  });
  audit.recordCell({ id: 'SEEDED-turn-filter', tableRef: 'brief §whose turn filter',
    expected: 'the filter shows exactly the ours rows and then restores the list',
    observed: `${filter.oursBefore} ours → showed ${filter.shown} (allOurs=${filter.allOurs}), restored ${filter.restored}/${filter.total}`,
    pass: filter.oursBefore >= 2 && filter.shown === filter.oursBefore && filter.allOurs
       && filter.restored === filter.total });

  // ── the waiting queue, with people guaranteed to be waiting ───────────────
  const queue = await audit.page.evaluate(() => {
    window.scrollTo(0, 0);
    const q = document.querySelector('[data-waiting-queue]');
    if (!q) return { present: false };
    const rows = [...q.querySelectorAll('[data-waiting-row]')];
    return { present: true, count: +q.getAttribute('data-waiting-queue'), rows: rows.length,
      actions: rows.filter(r => r.querySelector('[data-waiting-action]')).length,
      top: Math.round(q.getBoundingClientRect().top) };
  });
  audit.recordCell({ id: 'SEEDED-queue-lists', tableRef: 'page design 2026-08-10, decision ג',
    expected: 'everyone waiting is listed, each with one action',
    observed: queue.present ? `${queue.count} waiting, ${queue.rows} rows, ${queue.actions} actions, top=${queue.top}px` : 'band absent',
    pass: queue.present && queue.rows === queue.count && queue.actions === queue.rows && queue.count >= 2 });

  // ── the mixed row: picking the LIST org must drop "אשר השמה" ──────────────
  await expandAll();
  const mixed = await audit.page.evaluate(async (name) => {
    const li = [...document.querySelectorAll('li')].find(l => l.textContent.includes(name));
    const strip = li?.querySelector('[data-placement-strip]');
    if (!strip) return { skip: 'seeded row not found' };
    const read = () => [...strip.querySelectorAll('[data-strip-action]')].map(b => b.getAttribute('data-strip-action'));
    const first = read();
    const listChip = [...strip.querySelectorAll('[data-org-chip]')]
      .find(c => c.getAttribute('data-org-available') === '1' && c.getAttribute('data-org-selected') !== '1');
    if (!listChip) return { skip: 'no second selectable org on the seeded row' };
    listChip.click();
    await new Promise(r => setTimeout(r, 350));
    return { first, after: read(), org: listChip.getAttribute('data-org-chip') };
  }, NAMES[SUGG]);
  audit.recordCell({ id: 'SEEDED-mixed-actions', tableRef: 'Yariv: an org from the list is never placed by a click',
    expected: 'suggested → place_direct + send_cv; after picking the list org → send_cv only',
    observed: mixed.skip || `[${mixed.first}] → ${mixed.org} → [${mixed.after}]`,
    pass: mixed.skip ? null : (mixed.first.includes('place_direct') && mixed.after.join(',') === 'send_cv') });

  // ── the send button names the org it will send to ─────────────────────────
  const pick = await audit.page.evaluate((name) => {
    const li = [...document.querySelectorAll('li')].find(l => l.textContent.includes(name));
    const strip = li?.querySelector('[data-placement-strip]');
    const btn = strip?.querySelector('[data-strip-action="send_cv"]');
    if (!btn) return { skip: 'no send button on the seeded row' };
    return { label: btn.textContent.trim(), target: btn.getAttribute('data-strip-target') || '' };
  }, NAMES[PICK]);
  audit.recordCell({ id: 'SEEDED-pick-names-target', tableRef: 'Yariv: "לא ברור לאיזה מעסיק זה יישלח"',
    expected: 'the button names the organization it will send to',
    observed: pick.skip || `"${pick.label}" → ${pick.target}`,
    pass: pick.skip ? null : pick.target.includes(ORG_SHARED) });

  // ── a blocked org says why, and names who is holding the place ────────────
  // Target the chip by the organization it is about, rather than "any blocked chip on
  // that row" — the row lookup was matching whichever element happened to carry the name.
  const blocked = await audit.page.evaluate((org) => {
    const chips = [...document.querySelectorAll(`[data-org-chip]`)].filter(c => c.getAttribute('data-org-chip') === org);
    const chip = chips.find(c => c.getAttribute('data-org-available') === '0');
    if (!chip) return { skip: `no blocked chip for ${org} (found ${chips.length} chip(s))` };
    const el = chip.querySelector('[data-org-blocked]');
    const reason = (el || chip).textContent.replace(/^\s*·\s*/, '').trim();
    // How many times the reason appears in the WHOLE chip. innerText line-counting was
    // the wrong ruler — the rank badge and the ✕/ⓘ marks are separate inline elements and
    // each shows up as its own "line". What duplication actually means is the same
    // sentence printed twice.
    const whole = chip.textContent;
    const times = reason ? whole.split(reason).length - 1 : 0;
    return { text: (el || chip).textContent.trim(), marked: !!el,
      available: chip.getAttribute('data-org-available'), times };
  }, ORG_FULL);
  audit.recordCell({ id: 'SEEDED-blocked-explains', tableRef: 'Yariv: "הבחירה הראשונה תפוסה על ידי סטודנט אחר"',
    expected: 'the blocked choice states why ONCE, names the holder, and is not selectable',
    observed: blocked.skip || `"${blocked.text}" (available=${blocked.available}, marked=${blocked.marked}, printed ${blocked.times}×)`,
    pass: blocked.skip ? null
      : blocked.available === '0' && blocked.marked && blocked.text.includes(NAMES[HOLD].slice(0, 8))
        // ONCE: the reason used to print twice — as the suffix AND again beneath it
        // ("לא צריך את ההכפלה", Yariv 2026-08-11).
        && blocked.times === 1 });
  // ── every per-chip action is INSIDE the chip it acts on ───────────────────
  // Yariv 2026-08-11, on his own board: the "↩︎ לא נשלח" under choice 1 rendered between
  // chips 1 and 2, so he read it as a HEADING over choices 2 and 3 — "זה לא מעוצב בצורה
  // ברורה ונראה יותר חלק מ‑1 — מבלבל". Geometry, not wording: an action floating between
  // two chips belongs to neither of them by eye. Measured, so it cannot drift back.
  const contained = await audit.page.evaluate(() => {
    const out = [];
    for (const chip of document.querySelectorAll('[data-org-chip]')) {
      const btn = chip.querySelector('[data-strip-unsend],[data-strip-drop]');
      if (!btn) continue;
      const c = chip.getBoundingClientRect(), b = btn.getBoundingClientRect();
      out.push({
        org: chip.getAttribute('data-org-chip'),
        inside: b.top >= c.top - 0.5 && b.bottom <= c.bottom + 0.5
             && b.left >= c.left - 0.5 && b.right <= c.right + 0.5,
      });
    }
    // and no action may sit outside the chip boxes — that is the old, ambiguous shape
    const strays = [...document.querySelectorAll('[data-strip-unsend],[data-strip-drop]')]
      .filter(b => !b.closest('[data-org-chip]')).length;
    return { out, strays };
  });
  audit.recordCell({ id: 'SEEDED-action-inside-its-chip', tableRef: 'Yariv 2026-08-11: which chip an action belongs to must be visible',
    expected: 'every per-chip action is drawn inside that chip, none floating between chips',
    observed: contained.out.length
      ? `${contained.out.map(x => `${x.org}:${x.inside ? 'inside' : 'OUTSIDE'}`).join(' · ')} · strays=${contained.strays}`
      : 'no per-chip action on screen',
    pass: contained.out.length ? (contained.out.every(x => x.inside) && contained.strays === 0) : null });

}

// cleanup — the three students, the three employers, any dispatch of theirs
try {
  await mutateData(data => ({
    ...data,
    students: (data.students || []).filter(s => ![SUGG, PICK, HOLD].includes(s.id)),
    employers: (data.employers || []).filter(e => ![PRIV, SHARED, FULL].includes(e.id)),
    dispatches: (data.dispatches || []).filter(x => ![SUGG, PICK, HOLD].includes(x.studentId)),
  }));
  audit.log('Cleanup: removed 3 seeded students + 3 employers');
} catch (e) { audit.log(`⚠ Cleanup failed: ${String(e.message).slice(0, 90)}`); }

await audit.teardown();
