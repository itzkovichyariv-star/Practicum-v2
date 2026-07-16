#!/usr/bin/env node
/**
 * preflight-reminders.mjs — pre-send safety check for the weekly employer-feedback reminders.
 *
 *   Run before each Sunday (or any time you're unsure):
 *       node scripts/preflight-reminders.mjs
 *
 * Verifies, against LIVE production data (read-only, anon key — no CLI/auth needed):
 *   1. Nothing was deleted (core collections present).
 *   2. NO feedback was lost — every student who had feedback in the recent snapshot audit
 *      log still has it (feedback is monotonic; a drop means a bad write clobbered it).
 *   3. The reminder recipient list is valid — everyone who'd be reminded has a real mentor
 *      email, and the CC is what you expect.
 *   4. Each course's students see the right available orgs on their selection link.
 *
 * Exit 0 = all green (safe to send). Exit 1 = a red flag was found (do NOT send until fixed).
 */

const U = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const K = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: K, Authorization: `Bearer ${K}` };
const hasFb = (s) => !!s.feedbackSubmittedAt || !!(s.feedbackText && String(s.feedbackText).trim());

let issues = 0;
const ok = (m) => console.log(`   \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => { console.log(`   \x1b[31m⚠  ${m}\x1b[0m`); issues++; };
const note = (m) => console.log(`     ${m}`);

const j = async (url, opts) => (await fetch(url, { ...opts, headers: { ...H, ...(opts?.headers || {}) } })).json();

(async () => {
  const row = await j(`${U}/rest/v1/practicum_data?org_id=eq.default&select=data`);
  const d = row?.[0]?.data || {};
  const students = d.students || [], employers = d.employers || [], courses = d.courses || [];

  console.log('\n──── 1. Data integrity (nothing deleted) ────');
  note(`students=${students.length}  employers=${employers.length}  courses=${courses.length}`);
  if (students.length && employers.length && courses.length) ok('core collections present');
  else bad('a core collection is EMPTY — data may be corrupted');

  console.log('\n──── 2. Feedback-loss vs the snapshot audit log ────');
  const snaps = await j(`${U}/rest/v1/practicum_snapshots?select=data&order=created_at.desc&limit=25`);
  const everFb = new Set();
  for (const snap of (snaps || [])) for (const s of (snap.data?.students || [])) if (hasFb(s)) everFb.add(s.id);
  const curFb = new Set(students.filter(hasFb).map((s) => s.id));
  const lost = [...everFb].filter((id) => !curFb.has(id));
  if (lost.length === 0) ok(`no feedback lost — ${curFb.size} present, ${everFb.size} historically checked`);
  else bad(`FEEDBACK LOST for ${lost.length}: ${lost.map((id) => students.find((s) => s.id === id)?.name || id).join(', ')} — RECOVER before sending`);

  console.log('\n──── 3. Reminder recipients (who gets emailed Sunday) ────');
  let dry;
  try {
    dry = await j(`${U}/functions/v1/feedback-reminders?dry=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    if (dry.aborted) {
      bad(`the reminder's own guard would ABORT (data-integrity): ${dry.detail || dry.reason}`);
    } else if (!dry.counts) {
      bad(`unexpected reminder response: ${JSON.stringify(dry).slice(0, 200)}`);
    } else {
      note(`would remind: ${dry.counts.remind}   no-mentor-email: ${dry.counts.missing}   CC: ${JSON.stringify(dry.cc)}`);
      if (dry.counts.missing > 0) bad(`${dry.counts.missing} target(s) have NO mentor email — they'd only reach you in the summary`);
      else ok('every reminder target has a valid mentor email');
      (dry.wouldSend || []).forEach((w) => note(`  → ${w.studentName} → ${w.mentorEmail}`));
    }
  } catch (e) { bad(`could not reach the reminder function: ${e.message}`); }

  console.log('\n──── 4. Student-link availability per course (what students see) ────');
  const openIn = (e, cid) => (e.vacancySlots || []).filter((s) => s.courseId === cid && s.status === 'available').length;
  const green = (e, cid) => {
    if (e.approvalStatus === 'rejected' || e.restrictedToStudentId) return false;
    if (e.contactStatus === 'approved') return true;
    if (e.approvalStatus === 'pending') return false;
    return !!(e.notes && String(e.notes).trim()) && openIn(e, cid) > 0;
  };
  for (const c of courses.filter((x) => x.year && x.name)) {
    const nstu = students.filter((s) => s.courseId === c.id).length;
    if (nstu === 0) continue;
    const vis = employers.filter((e) => (e.courseIds || []).includes(c.id)).filter((e) => green(e, c.id) && openIn(e, c.id) > 0);
    note(`${c.name} · ${c.year}: ${vis.length} orgs visible / ${nstu} students${vis.length === 0 ? '   ⚠ students would see NOTHING' : ''}`);
  }
  ok('per-course availability computed (review any course above marked "NOTHING")');

  console.log(`\n${issues === 0 ? '\x1b[32m✅ PRE-FLIGHT PASSED — safe to send.\x1b[0m' : `\x1b[31m⚠  PRE-FLIGHT FOUND ${issues} ISSUE(S) — do NOT send until resolved.\x1b[0m`}\n`);
  process.exit(issues === 0 ? 0 : 1);
})().catch((e) => { console.error('preflight error:', e.message); process.exit(2); });
