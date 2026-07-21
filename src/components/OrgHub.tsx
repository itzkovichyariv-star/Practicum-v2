/**
 * OrgHub — the coordinator's single ranked-org surface for a student.
 *
 * Replaces FOUR fragments the old editor spread the org world across: the
 * submitted-preferences list, the three בחירה ראשונה/שנייה/שלישית fields (+ their
 * תוצאת ראיון dropdowns), the "build placements" box, and the embedded
 * PlacementPanel. Everything is now ONE card per org, in the student's chosen rank
 * order, coordinator-re-rankable, each card carrying its own תוצאת ראיון BOUND TO THE
 * ORG (Phase 0 data model) so re-ranking never detaches a result.
 *
 * Design (docs/design/2026-07-21-student-editor-redesign.md), Yariv's refinements:
 *  • Maroon palette (`--accent` #7a1e2b), subtle — NO blue.
 *  • Send = CHECK an org (one or several) → WhatsApp / Outlook, ranked-only.
 *  • Admin can re-rank (▲▼).
 *
 * The old explicit "build" step is gone: the list is the UNION of preferences[] and
 * the legacy choice fields (buildUnifiedOrgList), so a chosen org is a card at once;
 * sending materialises the preference and takes a place in the same action.
 *
 * Two save models coexist (per the spec): org identity / rank / interview-result edits
 * are LOCAL to the form (persisted on the editor's שמור, via onFormChange), while the
 * placement actions (send, נקלט/נדחה, השמה ישירה, release) persist IMMEDIATELY through
 * onDataChange — exactly as the old PlacementPanel did.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  Student, Employer, Course, Dispatch, PlacementSettings, PracticumData, VacancySlot,
} from '../lib/supabase';
import { randomId } from '../lib/dataApi';
import {
  renderTemplate, buildWhatsAppUrl, buildMailtoUrl, reconcileEmployerCapacity, countSlotsByStatus,
  buildUnifiedOrgList, reorderUnifiedList, applyUnifiedList, type UnifiedOrgPref, type InterviewResult,
} from '../lib/placement';
import { orgAvailability } from '../lib/orgAvailability';
import { resolveCvUrl } from '../lib/cvUrl';
import { btnSmall, btnSecondary, btnPrimary } from '../lib/design';
import { showToast } from '../lib/toast';
import { WhatsAppIcon, MailIcon, dispatchChip } from './icons';

export type OrgHubExtras = {
  allStudents: Student[];
  dispatches: Dispatch[];
  placementSettings: PlacementSettings;
  userName: string;
  onDataChange: (patch: Partial<PracticumData>) => Promise<void>;
};

type Props = {
  form: Student;
  employers: Employer[];
  courses: Course[];
  extras: OrgHubExtras;
  showAllOrgs: boolean;
  setShowAllOrgs: (v: boolean) => void;
  /** Patch the editor's local form (org identity / rank / interview-result — saved on שמור). */
  onFormChange: (patch: Partial<Student>) => void;
  /** Thin caption: "הוגש ע״י המועמד/ת · DATE". */
  submittedCaption?: string | null;
};

const RESULT_OPTS: { value: InterviewResult; label: string }[] = [
  { value: 'pending', label: 'טרם רואיין' },
  { value: 'passed', label: 'עבר' },
  { value: 'failed', label: 'לא עבר' },
];

const STATUS_LABEL: Record<string, string> = {
  tentative: 'ממתין לשליחה',
  under_review: 'בבדיקה אצל מעסיק',
  placed: 'שובץ',
  rejected: 'נדחה',
  withdrawn: 'בוטל',
};

function agingDays(sentAt: string): number {
  return Math.floor((Date.now() - new Date(sentAt).getTime()) / 86400000);
}

export default function OrgHub({
  form, employers, courses, extras, showAllOrgs, setShowAllOrgs, onFormChange, submittedCaption,
}: Props) {
  const { allStudents, dispatches, placementSettings, userName } = extras;
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'placed' | 'rejected' | 'withdrawn' | 'mark_cancelled' | 'place_direct';
    orgName: string;
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // orgNames checked to send
  const [sendSheet, setSendSheet] = useState(false);
  const [draftOrg, setDraftOrg] = useState<string | null>(null); // "➕ הוסף ארגון" input open

  const course = courses.find(c => c.id === form.courseId);
  const cvRef = form.cvUpdatedUrl || form.cvUrl || '';
  const cvLink = resolveCvUrl(cvRef);
  const hasUpdatedCv = !!form.cvUpdatedUrl;

  // The unified card list — prefs ∪ legacy choices, rank order.
  const cards = buildUnifiedOrgList(form, employers);

  // ── Fuzzy employer resolution (mirrors StudentEditor.resolveEmployerForOrg) ──
  function resolveEmployer(orgName: string): Employer | undefined {
    if (!orgName) return undefined;
    const norm = (s?: string) => (s || '').trim().toLowerCase();
    const n = norm(orgName);
    return employers.find(e => e.name === orgName)
      || employers.find(e => norm(e.name) === n)
      || employers.find(e => { const en = norm(e.name); return !!en && (en.startsWith(n) || n.startsWith(en)); });
  }
  function getSlot(emp: Employer, slotId: string | null): VacancySlot | undefined {
    if (!slotId) return undefined;
    return ((emp as any).vacancySlots || []).find((s: any) => s.id === slotId);
  }

  // ── Local (form) edits — persisted on the editor's שמור ─────────────────────
  // Every write goes through applyUnifiedList so preferences[] AND the legacy
  // firstChoiceOrg/second/third + *Result stay in sync (compat shim → reports,
  // /cv-update pre-fill, and the coordinator-edit log all keep working).
  function writeList(next: UnifiedOrgPref[]) {
    const s = applyUnifiedList(form, next);
    onFormChange({
      preferences: s.preferences,
      firstChoiceOrg: s.firstChoiceOrg, firstChoiceResult: s.firstChoiceResult,
      secondChoiceOrg: s.secondChoiceOrg, secondChoiceResult: s.secondChoiceResult,
      thirdChoiceOrg: s.thirdChoiceOrg, thirdChoiceResult: s.thirdChoiceResult,
    } as Partial<Student>);
  }
  function setResult(orgName: string, result: InterviewResult) {
    writeList(cards.map(c => c.orgName === orgName ? { ...c, interviewResult: result } : c));
  }
  function renameOrg(oldName: string, newName: string) {
    const nm = newName.trim();
    if (!nm) return; // never rename to empty — that would silently drop the card
    // Refuse renaming onto another card's org (orgName is the identity key for every
    // placement action — a duplicate would let an action hit the WRONG card and could
    // free a sent slot). addOrg already blocks this; renameOrg must too.
    if (cards.some(c => c.orgName !== oldName && c.orgName.trim().toLowerCase() === nm.toLowerCase())) {
      showToast('הארגון כבר קיים בדירוג', 'warn'); return;
    }
    writeList(cards.map(c => c.orgName === oldName
      ? { ...c, orgName: nm, employerId: resolveEmployer(nm)?.id ?? null }
      : c));
  }
  function moveOrg(orgName: string, dir: -1 | 1) {
    const i = cards.findIndex(c => c.orgName === orgName);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cards.length) return;
    const order = cards.map(c => c.orgName);
    [order[i], order[j]] = [order[j], order[i]];
    writeList(reorderUnifiedList(cards, order));
  }
  function addOrg(name: string) {
    const nm = name.trim();
    if (!nm) { setDraftOrg(null); return; }
    if (cards.some(c => c.orgName.trim().toLowerCase() === nm.toLowerCase())) { setDraftOrg(null); return; }
    writeList([...cards, { rank: cards.length + 1, orgName: nm, employerId: resolveEmployer(nm)?.id ?? null, interviewResult: 'pending', status: 'tentative', slotId: null }]);
    setDraftOrg(null);
  }

  // Org options for the combobox — available orgs by default; incomplete ones only
  // when the bypass is on or already this card's value.
  function gatedOrgOptions(selectedValue: string) {
    return employers
      .filter(e => orgAvailability(e).available || showAllOrgs || e.name === selectedValue)
      .map(e => {
        const av = orgAvailability(e);
        return { value: e.name, label: av.available ? e.name : `${e.name} — ${av.badge || 'לא זמין'}` };
      });
  }

  // ── Placement actions — persist IMMEDIATELY (onDataChange), like PlacementPanel ─
  // They operate on a MATERIALISED student: preferences[] rebuilt from the full
  // unified list so every card has a stable index and legacy edits are baked in.
  function materialise(): { student: any; prefs: any[] } {
    const s = applyUnifiedList(form, cards);
    return { student: s, prefs: s.preferences };
  }
  function buildCtx(emp: Employer) {
    return {
      contactName: emp.contactPerson || emp.name, studentName: form.name,
      positionTitle: emp.name, adminName: userName, courseName: course?.name || '',
      cvLink, employerName: emp.name,
    };
  }

  // Send the CV to one-or-more checked orgs through a single channel, folded into ONE
  // persist (atomic) + a channel window per org. Sending TAKES a place; preconditions:
  // an updated CV, a resolved employer, and a free course-scoped place at each org.
  async function dispatchMany(orgNames: string[], channel: 'whatsapp' | 'email') {
    setSendSheet(false);
    if (!hasUpdatedCv) { showToast('אין קו"ח מעודכן לסטודנט/ית — לא ניתן לשלוח', 'error'); return; }
    // Resolve against the CURRENT cards (by identity), not the raw `selected` name set —
    // a card that was renamed/removed after being checked drops out here, so we never
    // send to a stale name (which would otherwise reserve a slot no preference owns).
    const targets = cards.filter(c => orgNames.includes(c.orgName) && c.status === 'tentative');
    if (targets.length === 0) { setSelected(new Set()); showToast('לא נשלח — אין ארגון תקף שנבחר', 'error'); return; }
    const { student } = materialise();
    let nextStudent = student;
    let nextEmployers = employers;
    const newDispatches: Dispatch[] = [];
    const opened: string[] = [];
    const skipped: string[] = [];
    const usedEmployerIds = new Set<string>(); // one place per employer per batch (no double-book)
    let openedIdx = 0;

    for (const card of targets) {
      const orgName = card.orgName;
      const emp = resolveEmployer(orgName);
      if (!emp) { skipped.push(`${orgName} (לא זוהה מעסיק)`); continue; }
      if (usedEmployerIds.has(emp.id)) { skipped.push(`${orgName} (אותו מעסיק כבר נשלח)`); continue; }
      const pref = (nextStudent.preferences as any[]).find(p => p.orgName === orgName);
      const empLive = nextEmployers.find(e => e.id === emp.id) || emp;
      const already = pref?.slotId ? getSlot(empLive, pref.slotId) : null;
      const target: any = already
        || ((empLive as any).vacancySlots || []).find((s: any) => s.status === 'available' && s.courseId === form.courseId);
      if (!target) { skipped.push(`${orgName} (אין מקום פנוי)`); continue; }

      const ctx = buildCtx(empLive);
      const now = new Date().toISOString();
      let url = '', messageSnapshot = '';
      if (channel === 'whatsapp') {
        messageSnapshot = renderTemplate(placementSettings.whatsappTemplate || '', ctx);
        url = buildWhatsAppUrl(empLive.contactPhone || '', messageSnapshot);
      } else {
        const subject = renderTemplate(placementSettings.emailSubjectTemplate || '', ctx);
        const body = renderTemplate(placementSettings.emailBodyTemplate || '', ctx);
        messageSnapshot = `${subject}\n\n${body}`;
        url = buildMailtoUrl(empLive.contactEmail || '', subject, body);
      }

      // Open the channel FIRST and only commit if it actually opened. The first open is
      // in-gesture (reliable); mobile blocks the 2nd+ popup — for those, skip the org
      // rather than reserve a place + log a dispatch for a CV we never sent.
      const w = window.open(url, '_blank');
      if (!w && openedIdx > 0) { skipped.push(`${orgName} (חלון נחסם — שלח/י בנפרד)`); continue; }
      openedIdx++;
      usedEmployerIds.add(emp.id);

      const updatedSlots: VacancySlot[] = ((empLive as any).vacancySlots || []).map((s: any) => s.id !== target.id ? s : ({
        ...s, status: 'under_review', studentId: form.id, prefRank: pref?.rank ?? null,
        history: [...(s.history || []), { at: now, from: s.status, to: 'under_review', by: 'admin', actorId: userName }],
      }));
      const updatedEmp = reconcileEmployerCapacity({ ...empLive, vacancySlots: updatedSlots });
      nextEmployers = nextEmployers.map(e => e.id === updatedEmp.id ? updatedEmp : e);
      nextStudent = {
        ...nextStudent,
        preferences: (nextStudent.preferences as any[]).map(p => p.orgName === orgName ? { ...p, employerId: emp.id, slotId: target.id, status: 'under_review' } : p),
      };
      newDispatches.push({
        id: randomId('d'), studentId: form.id, employerId: emp.id, slotId: target.id, channel,
        sentBy: userName, sentAt: now, messageSnapshot, result: 'pending', resultAt: null, resultBy: null,
      });
      opened.push(orgName);
    }

    if (opened.length === 0) {
      showToast(skipped.length ? `לא נשלח — ${skipped.join(', ')}` : 'לא נשלח', 'error');
      return;
    }
    const nextStudents = allStudents.map(s => s.id === form.id ? nextStudent : s);
    await extras.onDataChange({ students: nextStudents, employers: nextEmployers, dispatches: [...dispatches, ...newDispatches] });
    setSelected(new Set());
    showToast(`✓ ${channel === 'whatsapp' ? 'WhatsApp' : 'מייל'} נשלח ל‑${opened.length} ארגון${opened.length > 1 ? 'ים' : ''}${skipped.length ? ` · דילוג: ${skipped.join(', ')}` : ''}`, skipped.length ? 'warn' : 'success');
  }

  async function handleResult(orgName: string, result: 'placed' | 'rejected' | 'withdrawn', openChannel?: 'whatsapp' | 'email') {
    const { student } = materialise();
    const pref = (student.preferences as any[]).find(p => p.orgName === orgName);
    if (!pref) { setConfirmDialog(null); return; }
    const emp = resolveEmployer(orgName);
    if (!emp) { setConfirmDialog(null); return; }
    const now = new Date().toISOString();
    const empLive = employers.find(e => e.id === emp.id) || emp;
    const isPlacedNow = student.submissionStatus === 'placed';

    if (openChannel && result === 'withdrawn') {
      const ctx = buildCtx(empLive);
      let url = '';
      if (openChannel === 'whatsapp') url = buildWhatsAppUrl(empLive.contactPhone || '', renderTemplate(placementSettings.whatsappWithdrawalTemplate, ctx));
      else url = buildMailtoUrl(empLive.contactEmail || '', renderTemplate(placementSettings.emailWithdrawalSubjectTemplate, ctx), renderTemplate(placementSettings.emailWithdrawalBodyTemplate, ctx));
      window.open(url, '_blank');
    }

    const newSlotStatus = result === 'placed' ? 'placed' : 'available';
    const updatedSlots: VacancySlot[] = ((empLive as any).vacancySlots || []).map((s: any) => {
      if (s.id !== pref.slotId) return s;
      const h: any = { at: now, from: s.status, to: newSlotStatus, by: 'admin', actorId: userName };
      if (result === 'withdrawn') h.reason = isPlacedNow ? 'withdrawn-after-placement' : 'withdrawn-manual';
      return { ...s, status: newSlotStatus, studentId: result === 'placed' ? s.studentId : null, prefRank: result === 'placed' ? s.prefRank : null, history: [...(s.history || []), h] };
    });
    const updatedEmp = reconcileEmployerCapacity({ ...empLive, vacancySlots: updatedSlots });
    const updatedPrefs = (student.preferences as any[]).map(p => p.orgName === orgName
      ? { ...p, status: result === 'placed' ? 'placed' : result === 'rejected' ? 'rejected' : 'withdrawn' } : p);

    let newSubmissionStatus = student.submissionStatus;
    if (result === 'placed') newSubmissionStatus = 'placed';
    else if (!updatedPrefs.some(p => p.status === 'tentative' || p.status === 'under_review') && !updatedPrefs.some(p => p.status === 'placed')) newSubmissionStatus = 'exhausted';

    const updatedStudent: any = { ...student, preferences: updatedPrefs, submissionStatus: newSubmissionStatus };
    if (result === 'placed') { updatedStudent.acceptedOrg = empLive.name; if (!updatedStudent.placedAt) updatedStudent.placedAt = now.slice(0, 10); }

    const updatedDispatches = dispatches.map(d => (d.studentId === form.id && d.slotId === pref.slotId && d.result === 'pending')
      ? { ...d, result: result === 'placed' ? 'placed' : result === 'rejected' ? 'rejected' : 'withdrawn', resultAt: now, resultBy: userName } : d);

    const nextStudents = allStudents.map(s => s.id === form.id ? updatedStudent : s);
    const nextEmployers = employers.map(e => e.id === updatedEmp.id ? updatedEmp : e);
    await extras.onDataChange({ students: nextStudents, employers: nextEmployers, dispatches: updatedDispatches as Dispatch[] });
    showToast(`✓ ${result === 'placed' ? 'שובץ!' : result === 'rejected' ? 'נדחה' : 'בוטל'}`, 'success');
    setConfirmDialog(null);
  }

  // Path 2 (student-suggested private org): approval IS the placement — no CV sent.
  async function handlePlaceDirect(orgName: string) {
    const { student } = materialise();
    const pref = (student.preferences as any[]).find(p => p.orgName === orgName);
    const emp = resolveEmployer(orgName);
    if (!pref || !emp) { setConfirmDialog(null); return; }
    if (!form.courseId) { showToast('לא הוגדר קורס לסטודנט/ית', 'error'); setConfirmDialog(null); return; }
    const now = new Date().toISOString();
    const empLive = employers.find(e => e.id === emp.id) || emp;
    const isRestricted = (empLive as any).restrictedToStudentId === form.id;
    const existing = pref.slotId ? getSlot(empLive, pref.slotId) : null;
    let target: any = existing || ((empLive as any).vacancySlots || []).find((s: any) => s.status === 'available' && s.courseId === form.courseId);
    let updatedSlots: VacancySlot[];
    if (target) {
      updatedSlots = ((empLive as any).vacancySlots || []).map((s: any) => s.id !== target.id ? s : ({ ...s, status: 'placed', studentId: form.id, prefRank: pref.rank, history: [...(s.history || []), { at: now, from: s.status, to: 'placed', by: 'admin', actorId: userName, reason: 'placed-direct' }] }));
    } else if (isRestricted) {
      const newSlot: any = { id: `${empLive.id}-direct-${randomId('x')}`, courseId: form.courseId, status: 'placed', studentId: form.id, prefRank: pref.rank, history: [{ at: now, from: 'available', to: 'placed', by: 'admin', actorId: userName, reason: 'placed-direct-mint' }] };
      target = newSlot;
      updatedSlots = [...((empLive as any).vacancySlots || []), newSlot];
    } else {
      showToast('אין כרגע מקום פנוי בארגון זה עבור הקורס', 'error'); setConfirmDialog(null); return;
    }
    const updatedEmp = reconcileEmployerCapacity({ ...empLive, vacancySlots: updatedSlots });
    const updatedPrefs = (student.preferences as any[]).map(p => p.orgName === orgName ? { ...p, status: 'placed', slotId: target.id } : p);
    const updatedStudent: any = { ...student, preferences: updatedPrefs, submissionStatus: 'placed', acceptedOrg: empLive.name, placedAt: (form as any).placedAt || now.slice(0, 10) };
    const nextStudents = allStudents.map(s => s.id === form.id ? updatedStudent : s);
    const nextEmployers = employers.map(e => e.id === updatedEmp.id ? updatedEmp : e);
    await extras.onDataChange({ students: nextStudents, employers: nextEmployers });
    showToast(`✓ ${form.name} שובץ/ה ל"${empLive.name}" (השמה ישירה)`, 'success');
    setConfirmDialog(null);
  }

  // Release a not-yet-sent (tentative) org: free any reserved slot and drop the card.
  async function handleRelease(orgName: string) {
    const { student } = materialise();
    const pref = (student.preferences as any[]).find(p => p.orgName === orgName);
    const emp = resolveEmployer(orgName);
    const now = new Date().toISOString();
    let nextEmployers = employers;
    if (emp && pref?.slotId) {
      const empLive = employers.find(e => e.id === emp.id) || emp;
      const updatedSlots = ((empLive as any).vacancySlots || []).map((s: any) => s.id !== pref.slotId ? s : ({ ...s, status: 'available', studentId: null, prefRank: null, history: [...(s.history || []), { at: now, from: s.status, to: 'available', by: 'admin', actorId: userName, reason: 'released' }] }));
      const updatedEmp = reconcileEmployerCapacity({ ...empLive, vacancySlots: updatedSlots });
      nextEmployers = employers.map(e => e.id === updatedEmp.id ? updatedEmp : e);
    }
    const remaining = cards.filter(c => c.orgName !== orgName);
    const updatedStudent = applyUnifiedList(student, remaining);
    const nextStudents = allStudents.map(s => s.id === form.id ? updatedStudent : s);
    await extras.onDataChange({ students: nextStudents, employers: nextEmployers });
    // Keep the editor's form in step (release persisted immediately).
    writeList(remaining);
    showToast('✓ ההעדפה הוסרה' + (pref?.slotId ? ' והמקום שוחרר' : ''), 'success');
  }

  const isPlaced = form.submissionStatus === 'placed';
  const selectableCards = cards.filter(c => c.status === 'tentative');
  const toggleSel = (orgName: string) => setSelected(prev => {
    const n = new Set(prev); n.has(orgName) ? n.delete(orgName) : n.add(orgName); return n;
  });

  return (
    <div style={{ direction: 'rtl' }}>
      {/* CV-for-send guard note (the strip above owns the CV; here we only warn) */}
      {!hasUpdatedCv && (
        <div className="rounded-xl p-3 mb-3" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.3)' }}>
          <div className="text-[12.5px] font-semibold" style={{ color: '#b91c1c' }}>
            ⚠ אין קו"ח מעודכן — שליחת קו"ח לארגון תיחסם עד להעלאה (בקטע קו"ח למעלה).
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="chapter-mark" style={{ fontSize: '11px' }}>ארגונים מדורגים ושליחה</div>
        <label className="inline-flex items-center gap-2 cursor-pointer text-[11.5px]" style={{ color: showAllOrgs ? 'var(--accent)' : 'var(--text-soft)' }}>
          <input type="checkbox" checked={showAllOrgs} onChange={e => setShowAllOrgs(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
          הצג גם ארגונים שאינם זמינים
        </label>
      </div>
      {submittedCaption && (
        <div className="text-[11.5px] mb-3" style={{ color: 'var(--text-soft)' }}>{submittedCaption}</div>
      )}

      {cards.length === 0 && (
        <div className="text-[13px] py-3" style={{ color: 'var(--text-soft)' }}>
          לא נבחרו ארגונים עדיין. הוסף/י ארגון לדירוג למטה, או שלח/י למועמד/ת קישור לבחירת העדפות.
        </div>
      )}

      {cards.map((card, idx) => {
        const emp = resolveEmployer(card.orgName);
        const cap = emp ? countSlotsByStatus(emp, form.courseId) : null;
        const inProcess = cap ? cap.tentative + cap.under_review : 0;
        const sent = card.status === 'under_review';
        const isTentative = card.status === 'tentative';
        const isSuggested = !!emp && (emp as any).restrictedToStudentId === form.id;
        const isPending = !!emp && (emp as any).approvalStatus === 'pending';
        const sentDispatch = dispatches.filter(d => d.studentId === form.id && d.slotId === card.slotId && d.result === 'pending').slice(-1)[0];
        const aging = sentDispatch ? agingDays(sentDispatch.sentAt) : 0;
        const agingThreshold = (course as any)?.reviewAgingThresholdDays ?? (placementSettings.defaultAgingThresholdDays ?? 14);
        const isAging = !!sentDispatch && aging > agingThreshold;
        const isOrphan = isPlaced && (card.status === 'tentative' || card.status === 'under_review');
        const canSend = hasUpdatedCv && !!emp && (!!card.slotId || (cap ? cap.available > 0 : false));
        const blockedReason = !emp ? 'לא זוהה מעסיק — עדכן/י שם ארגון'
          : !hasUpdatedCv ? 'אין קו"ח מעודכן' : (cap && cap.available <= 0 && !card.slotId) ? 'אין מקום פנוי בקורס' : '';

        return (
          <div key={card.orgName + idx} className="rounded-xl p-3.5 mb-3"
            data-org-card={idx}
            style={{
              border: isPending || isOrphan ? '1px solid rgba(217,119,6,0.4)' : selected.has(card.orgName) ? '1.5px solid var(--accent)' : '1px solid var(--divider)',
              background: isPending || isOrphan ? 'rgba(217,119,6,0.05)' : selected.has(card.orgName) ? 'var(--accent-soft)' : 'rgba(0,0,0,0.015)',
            }}>

            {/* Row 1 — rank + re-rank, org identity, capacity, status */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="mono text-[12px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>#{card.rank}</span>
              {isTentative && (
                <span className="inline-flex flex-col shrink-0" style={{ lineHeight: 0.9 }}>
                  <button type="button" data-move-up={idx} onClick={() => moveOrg(card.orgName, -1)} disabled={idx === 0}
                    title="העלה בדירוג" style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? 'var(--divider)' : 'var(--text-soft)', fontSize: 11, padding: '0 2px' }}>▲</button>
                  <button type="button" data-move-down={idx} onClick={() => moveOrg(card.orgName, 1)} disabled={idx === cards.length - 1}
                    title="הורד בדירוג" style={{ background: 'none', border: 'none', cursor: idx === cards.length - 1 ? 'default' : 'pointer', color: idx === cards.length - 1 ? 'var(--divider)' : 'var(--text-soft)', fontSize: 11, padding: '0 2px' }}>▼</button>
                </span>
              )}
              {/* Org identity — editable combobox while not-yet-sent, else locked text. */}
              {isTentative ? (
                <OrgCombo value={card.orgName} options={gatedOrgOptions(card.orgName)} onCommit={v => renameOrg(card.orgName, v)} />
              ) : (
                <span className="font-semibold text-[14px]" style={{ color: 'var(--ink)' }}>{card.orgName}</span>
              )}
              {!emp && (
                <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(217,119,6,0.12)', color: '#b45309' }}>לא זוהה מעסיק</span>
              )}
              {cap && (
                <span className="inline-flex items-center gap-2 mono text-[10px] px-2 py-0.5 rounded-full" title="קיבולת הארגון בקורס זה"
                  style={{ background: 'rgba(0,0,0,0.035)', border: '1px solid var(--divider)', color: 'var(--text-soft)' }}>
                  <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{cap.total} מק׳</span>
                  <span style={{ color: '#059669' }}>●{cap.placed} שובצו</span>
                  <span style={{ color: '#b45309' }}>●{inProcess} בתהליך</span>
                  <span style={{ color: cap.available > 0 ? '#059669' : '#b03030' }}>●{cap.available} פנויים</span>
                </span>
              )}
              {isPending && <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(217,119,6,0.15)', color: '#b45309' }}>ממתין לאישור</span>}
              <span className="mono text-[10.5px] px-2 py-0.5 rounded-full" style={statusPill(card.status)}>{STATUS_LABEL[card.status] || card.status}</span>
              {isAging && <span className="mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.3)' }}>⏱ {aging} ימים</span>}
            </div>

            {/* Row 2 — interview result (bound to THIS org), always editable */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>תוצאת ראיון:</span>
              <span className="inline-flex rounded-full overflow-hidden" style={{ border: '1px solid var(--divider)' }}>
                {RESULT_OPTS.map(o => {
                  const active = (card.interviewResult || 'pending') === o.value;
                  const tone = o.value === 'passed' ? '#059669' : o.value === 'failed' ? '#b03030' : 'var(--accent)';
                  return (
                    <button key={o.value} type="button" data-result={`${idx}:${o.value}`} onClick={() => setResult(card.orgName, o.value)}
                      style={{ padding: '4px 11px', fontSize: '11.5px', fontWeight: active ? 700 : 500, border: 'none', cursor: 'pointer',
                        background: active ? tone : 'transparent', color: active ? '#fff' : 'var(--text-soft)' }}>{o.label}</button>
                  );
                })}
              </span>
            </div>

            {/* Row 3 — status-driven actions */}
            {(isTentative && !isPlaced) && (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" role="checkbox" aria-checked={selected.has(card.orgName)} data-send-cv={idx}
                  disabled={!canSend} onClick={() => canSend && toggleSel(card.orgName)}
                  title={canSend ? 'בחר/י לשליחת קו"ח — פעולה זו תופסת מקום' : blockedReason}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', padding: 0, cursor: canSend ? 'pointer' : 'not-allowed', opacity: canSend ? 1 : 0.55 }}>
                  <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 5, border: `2px solid ${selected.has(card.orgName) ? 'var(--accent)' : canSend ? 'var(--accent)' : 'var(--divider)'}`, background: selected.has(card.orgName) ? 'var(--accent)' : 'transparent', color: '#fff', fontSize: 13, flexShrink: 0 }}>{selected.has(card.orgName) ? '✓' : ''}</span>
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>שלח קו"ח <span style={{ color: 'var(--text-soft)', fontWeight: 400 }}>· תופס מקום</span></span>
                </button>
                {isSuggested && (
                  <button type="button" data-place-direct={idx} onClick={() => setConfirmDialog({ type: 'place_direct', orgName: card.orgName })}
                    title="הסטודנט/ית כבר במגעים מתקדמים — אישורך מהווה שיבוץ (השמה), ללא שליחת קו״ח"
                    style={{ ...btnSmall(), color: '#15803d', borderColor: '#15803d' }}>✓ כבר במגעים — אשר שיבוץ</button>
                )}
                <button type="button" data-release={idx} onClick={() => handleRelease(card.orgName)}
                  title={card.slotId ? 'הסר וגם שחרר את המקום שנתפס' : 'הסר ארגון זה מהדירוג'}
                  style={{ ...btnSmall(), color: 'var(--text-soft)' }}>{card.slotId ? '✕ הסר ושחרר מקום' : '✕ הסר'}</button>
                {blockedReason && <span className="mono text-[11px]" style={{ color: '#b91c1c' }}>{blockedReason}</span>}
              </div>
            )}

            {sent && !isOrphan && (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" role="checkbox" aria-checked data-sent-cv={idx}
                  onClick={() => setConfirmDialog({ type: 'withdrawn', orgName: card.orgName })}
                  title="בטל שליחה ושחרר את המקום"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                  <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 5, border: '2px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 13, flexShrink: 0 }}>✓</span>
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>קו"ח נשלח <span style={{ color: 'var(--text-soft)', fontWeight: 400 }}>· ממתין לתשובה</span></span>
                </button>
                <button type="button" data-accept={idx} onClick={() => setConfirmDialog({ type: 'placed', orgName: card.orgName })} style={{ ...btnSmall(), color: '#15803d', borderColor: '#15803d' }}>✓ נקלט</button>
                <button type="button" data-reject={idx} onClick={() => setConfirmDialog({ type: 'rejected', orgName: card.orgName })} style={btnSmall()}>✕ נדחה</button>
              </div>
            )}

            {isOrphan && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setConfirmDialog({ type: 'withdrawn', orgName: card.orgName })} style={{ ...btnSmall(), background: 'rgba(217,119,6,0.1)', borderColor: '#b45309', color: '#92400e' }}>📱 שלח הודעת ביטול</button>
                <button type="button" onClick={() => setConfirmDialog({ type: 'mark_cancelled', orgName: card.orgName })} style={btnSmall()}>✓ סמן כבוטל</button>
              </div>
            )}

            {card.status === 'placed' && <div className="mono text-[11px] font-semibold" style={{ color: '#059669' }}>✅ שובץ</div>}
            {(card.status === 'rejected' || card.status === 'withdrawn') && (
              <div className="mono text-[11px]" style={{ color: 'var(--text-soft)' }}>{card.status === 'rejected' ? '❌ נדחה על ידי המעסיק' : '🚫 בוטל'}</div>
            )}
          </div>
        );
      })}

      {/* Add-org row */}
      <div className="mt-1">
        {draftOrg === null ? (
          <button type="button" data-add-org onClick={() => setDraftOrg('')} style={{ ...btnSmall(), color: 'var(--accent)' }}>➕ הוסף ארגון לדירוג</button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Controlled by draftOrg (the single source) so the הוסף button works — an
                OrgCombo keeps its value in its own state, which the button couldn't read. */}
            <span className="inline-flex" style={{ minWidth: 200, flex: '1 1 200px' }}>
              <input value={draftOrg} autoFocus data-add-input list="orghub-add-dl"
                onChange={e => setDraftOrg(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOrg(draftOrg); } }}
                placeholder="בחר/י או הקלד/י שם ארגון" className="input" style={{ padding: '8px 12px', fontSize: '13.5px', width: '100%' }} />
              <datalist id="orghub-add-dl">{gatedOrgOptions('').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
            </span>
            <button type="button" data-add-confirm onClick={() => addOrg(draftOrg)} style={{ ...btnSmall(), color: 'var(--accent)', borderColor: 'var(--accent)' }}>הוסף</button>
            <button type="button" onClick={() => setDraftOrg(null)} style={{ ...btnSmall(), color: 'var(--text-soft)' }}>ביטול</button>
          </div>
        )}
      </div>

      {/* Sticky multi-select send bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap mt-3 p-3 rounded-xl" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)' }}>
          <span className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>נבחרו {selected.size} ארגונים לשליחת קו"ח</span>
          <div className="flex gap-2">
            <button type="button" data-send-selected onClick={() => setSendSheet(true)} style={{ ...btnPrimary(), padding: '9px 18px' }}>שלח קו"ח →</button>
            <button type="button" onClick={() => setSelected(new Set())} style={{ ...btnSmall(), color: 'var(--text-soft)' }}>נקה</button>
          </div>
        </div>
      )}

      {/* Channel bottom-sheet (portal, not a clipping popover) */}
      {sendSheet && createPortal((
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setSendSheet(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full sm:max-w-[380px] rounded-t-2xl sm:rounded-2xl border p-5"
            style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 -8px 40px rgba(0,0,0,0.2)', direction: 'rtl' }}>
            <div className="serif text-[18px] mb-1" style={{ color: 'var(--ink)' }}>שליחת קו"ח ל‑{selected.size} ארגונים</div>
            <div className="text-[12px] mb-4" style={{ color: 'var(--text-soft)' }}>הפעולה תופסת מקום בכל ארגון נבחר ותפתח את הערוץ.</div>
            <div className="flex gap-2">
              <button type="button" data-dispatch="whatsapp" onClick={() => dispatchMany([...selected], 'whatsapp')} style={{ ...dispatchChip(true), flex: 1, justifyContent: 'center', padding: '11px' }}><WhatsAppIcon /> WhatsApp</button>
              <button type="button" data-dispatch="email" onClick={() => dispatchMany([...selected], 'email')} style={{ ...dispatchChip(true), flex: 1, justifyContent: 'center', padding: '11px', color: 'var(--accent)' }}><MailIcon /> מייל</button>
            </div>
            <button type="button" onClick={() => setSendSheet(false)} className="mono text-[11px] mt-3 w-full text-center" style={{ color: 'var(--text-soft)', background: 'none', border: 'none', cursor: 'pointer' }}>ביטול</button>
          </div>
        </div>
      ), document.body)}

      {/* Confirm dialog (port of PlacementPanel's) */}
      {confirmDialog && (() => {
        const { type, orgName } = confirmDialog;
        const emp = resolveEmployer(orgName);
        const isWithdrawal = type === 'withdrawn';
        const isMarkCancelled = type === 'mark_cancelled';
        return createPortal((
          <div className="fixed inset-0 z-[320] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="rounded-2xl border p-6 max-w-[420px] w-full mx-4" style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', direction: 'rtl' }}>
              <div className="serif text-[20px] mb-3" style={{ color: 'var(--ink)' }}>
                {type === 'placed' ? '✅ אישור שיבוץ' : type === 'place_direct' ? '✅ שיבוץ ישיר (השמה)' : type === 'rejected' ? '❌ אישור דחייה' : isMarkCancelled ? '✓ סמן כבוטל' : '🚫 ביטול מועמדות'}
              </div>
              <div className="text-[13.5px] mb-5" style={{ color: 'var(--text-soft)' }}>
                {type === 'placed' ? `לסמן שיבוץ של ${form.name} אצל ${emp?.name || orgName}?`
                  : type === 'place_direct' ? `${form.name} כבר במגעים מתקדמים עם ${emp?.name || orgName}. לאשר שיבוץ ישיר — ללא שליחת קו"ח? פעולה זו מסמנת השמה ותופסת מקום.`
                  : type === 'rejected' ? `לסמן שהמעסיק ${emp?.name || orgName} דחה את ${form.name}?`
                  : isMarkCancelled ? `לסמן ביטול מועמדות אצל ${emp?.name || orgName} ללא פתיחת ערוץ תקשורת?`
                  : `לבטל את מועמדות ${form.name} אצל ${emp?.name || orgName}?`}
              </div>
              {isWithdrawal && (
                <div className="flex flex-col gap-2 mb-4">
                  <button type="button" onClick={() => handleResult(orgName, 'withdrawn', 'whatsapp')} style={{ ...btnPrimary(), background: '#25D366', width: '100%', textAlign: 'center' }}>📱 פתח WhatsApp + סמן בוטל</button>
                  <button type="button" onClick={() => handleResult(orgName, 'withdrawn', 'email')} style={{ ...btnPrimary(), width: '100%', textAlign: 'center' }}>✉ פתח מייל + סמן בוטל</button>
                </div>
              )}
              <div className="flex gap-3 justify-between">
                <button type="button" onClick={() => setConfirmDialog(null)} style={btnSecondary()}>ביטול</button>
                {!isWithdrawal && (
                  <button type="button" onClick={() => {
                    if (type === 'place_direct') handlePlaceDirect(orgName);
                    else if (isMarkCancelled) handleResult(orgName, 'withdrawn');
                    else handleResult(orgName, type as 'placed' | 'rejected');
                  }} style={btnPrimary()}>
                    {type === 'placed' ? 'אשר שיבוץ →' : type === 'place_direct' ? 'אשר שיבוץ ישיר →' : type === 'rejected' ? 'אשר דחייה →' : 'סמן כבוטל →'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ), document.body);
      })()}
    </div>
  );
}

function statusPill(status: string): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    placed: ['rgba(5,150,105,0.1)', '#059669'],
    under_review: ['rgba(217,119,6,0.1)', '#b45309'],
    rejected: ['rgba(180,60,60,0.1)', '#b03030'],
    withdrawn: ['rgba(180,60,60,0.1)', '#b03030'],
    tentative: ['rgba(0,0,0,0.06)', 'var(--text-soft)'],
  };
  const [bg, color] = map[status] || map.tentative;
  return { background: bg, color };
}

// Small combobox (input + datalist) — mirrors StudentEditor's freeText Select.
function OrgCombo({ value, options, onCommit, placeholder, autoFocus }: {
  value: string; options: { value: string; label: string }[]; onCommit: (v: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [v, setV] = useState(value);
  const listId = `orgdl-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <span className="inline-flex" style={{ minWidth: 200, flex: '1 1 200px' }}>
      <input value={v} autoFocus={autoFocus} onChange={e => setV(e.target.value)}
        onBlur={() => { const t = v.trim(); if (!t) { setV(value); return; } if (t !== value.trim()) onCommit(t); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
        placeholder={placeholder} list={listId} className="input"
        style={{ padding: '8px 12px', fontSize: '13.5px', width: '100%' }} />
      <datalist id={listId}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
    </span>
  );
}
