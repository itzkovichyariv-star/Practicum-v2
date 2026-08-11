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

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type {
  Student, Employer, Course, Dispatch, PlacementSettings, PracticumData, VacancySlot,
} from '../lib/supabase';
import { randomId } from '../lib/dataApi';
import {
  renderTemplate, buildWhatsAppUrl, buildMailtoUrl, reconcileEmployerCapacity, countSlotsByStatus,
  buildUnifiedOrgList, reorderUnifiedList, applyUnifiedList, normalizeOrgName, type UnifiedOrgPref, type InterviewResult,
} from '../lib/placement';
import { orgAvailability } from '../lib/orgAvailability';
import { resolveCvUrl } from '../lib/cvUrl';
import { btnSmall, btnSecondary, btnPrimary } from '../lib/design';
import { showToast } from '../lib/toast';
import { WhatsAppIcon, MailIcon, dispatchChip } from './icons';
import { openMailto } from '../lib/openMailto';
import { planDispatch, applyDispatch, unsendOrg, placeDirect } from '../lib/dispatch';
import { SILENCE_DAYS } from '../lib/placementStatus';

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
  // Set after a compose window was opened; nothing is written until it resolves.
  const [pendingSend, setPendingSend] = useState<{
    channel: 'whatsapp' | 'email';
    orgNames: string[];
    skipped: string[];
    commit: () => Promise<void>;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'placed' | 'rejected' | 'withdrawn' | 'mark_cancelled' | 'place_direct' | 'never_sent';
    orgName: string;
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // orgNames checked to send
  const [sendSheet, setSendSheet] = useState(false);
  const [draftOrg, setDraftOrg] = useState<string | null>(null); // "➕ הוסף ארגון" input open
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);

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
    const nm = normalizeOrgName(newName).trim();
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
    // Re-ranking is delicate (an accidental click loses the previous order), so confirm.
    const other = cards[j]?.orgName || '';
    if (!window.confirm(`לשנות דירוג — "${orgName}" ${dir < 0 ? 'למעלה, לפני' : 'למטה, אחרי'} "${other}"?`)) return;
    const order = cards.map(c => c.orgName);
    [order[i], order[j]] = [order[j], order[i]];
    writeList(reorderUnifiedList(cards, order));
  }
  function addOrg(name: string) {
    const nm = normalizeOrgName(name).trim();
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
  // Placement actions persist async, then the parent syncs `form` back. Read the LATEST
  // committed form through a ref so a rapid send → נקלט doesn't materialise from a stale
  // render closure (which would miss the just-assigned slotId and leave the slot orphaned).
  function materialise(): { student: any; prefs: any[] } {
    const f = formRef.current;
    const s = applyUnifiedList(f, buildUnifiedOrgList(f, employers));
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
  async function dispatchMany(orgNames: string[], channel: 'whatsapp' | 'email', allowResend = false) {
    setSendSheet(false);
    const { student } = materialise();
    // WHAT would be sent is decided by the shared planner (lib/dispatch), so the card and
    // the students-list row can never disagree about slots, templates or skip rules.
    const plan = planDispatch({
      student, employers, orgNames, channel, courseId: form.courseId,
      courseName: course?.name || '', cvLink, userName, settings: placementSettings, allowResend,
      newId: () => randomId('d'), origin: typeof window !== 'undefined' ? window.location.origin : '',
    });
    if (plan.blockedReason) { setSelected(new Set()); showToast(plan.blockedReason, 'error'); return; }

    // Open the channel FIRST, per org. WhatsApp is https, so a null window really does
    // mean the popup was blocked. mailto cannot be verified — iOS reports nothing either
    // way — so nothing here is committed until the coordinator confirms below.
    const opened: typeof plan.entries = [];
    const skipped = [...plan.skipped];
    for (const e of plan.entries) {
      const ok = e.channel === 'whatsapp' ? !!window.open(e.url, '_blank') : openMailto(e.url);
      if (!ok) { skipped.push(`${e.orgName} (חלון נחסם — שלח/י בנפרד)`); continue; }
      opened.push(e);
    }
    if (opened.length === 0) {
      showToast(skipped.length ? `לא נשלח — ${skipped.join(', ')}` : 'לא נשלח', 'error');
      return;
    }

    setPendingSend({
      channel,
      orgNames: opened.map(e => e.orgName),
      skipped,
      commit: async () => {
        const res = applyDispatch({
          student, employers, dispatches, entries: opened, userName, newId: () => randomId('d'),
        });
        const nextStudents = allStudents.map(s => s.id === form.id ? res.student : s);
        await extras.onDataChange({ students: nextStudents, employers: res.employers, dispatches: res.dispatches });
        setSelected(new Set());
        showToast(`✓ נרשם: קו״ח נשלחו ל‑${opened.length} ארגון${opened.length > 1 ? 'ים' : ''}`, 'success');
      },
    });
  }

  /**
   * The message never actually went — free the place and put the org back on the list as
   * not-yet-sent, so it can be sent again. Until now the only exit from a sent org was
   * 'בוטל', which is terminal and forced re-adding the organization from scratch
   * (Yariv 2026-08-09, after a CV was recorded as sent that Outlook never opened).
   */
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

    // Resolve the target slot robustly: the pref's slotId if present, else the slot this
    // student actually holds at the employer (ground truth from the employers prop). A
    // rapid send→נקלט could run before the form's slotId synced back; the held-slot
    // fallback stops that from marking placement without freeing/occupying the slot.
    const slotId = pref.slotId
      || ((empLive as any).vacancySlots || []).find((s: any) => s.studentId === form.id && (s.status === 'under_review' || s.status === 'placed'))?.id
      || null;
    const newSlotStatus = result === 'placed' ? 'placed' : 'available';
    const updatedSlots: VacancySlot[] = ((empLive as any).vacancySlots || []).map((s: any) => {
      if (s.id !== slotId) return s;
      const h: any = { at: now, from: s.status, to: newSlotStatus, by: 'admin', actorId: userName };
      if (result === 'withdrawn') h.reason = isPlacedNow ? 'withdrawn-after-placement' : 'withdrawn-manual';
      return { ...s, status: newSlotStatus, studentId: result === 'placed' ? (s.studentId || form.id) : null, prefRank: result === 'placed' ? s.prefRank : null, history: [...(s.history || []), h] };
    });
    const updatedEmp = reconcileEmployerCapacity({ ...empLive, vacancySlots: updatedSlots });
    const updatedPrefs = (student.preferences as any[]).map(p => p.orgName === orgName
      ? { ...p, slotId: slotId ?? p.slotId, status: result === 'placed' ? 'placed' : result === 'rejected' ? 'rejected' : 'withdrawn' } : p);

    let newSubmissionStatus = student.submissionStatus;
    if (result === 'placed') newSubmissionStatus = 'placed';
    else if (!updatedPrefs.some(p => p.status === 'tentative' || p.status === 'under_review') && !updatedPrefs.some(p => p.status === 'placed')) newSubmissionStatus = 'exhausted';

    const updatedStudent: any = { ...student, preferences: updatedPrefs, submissionStatus: newSubmissionStatus };
    if (result === 'placed') { updatedStudent.acceptedOrg = empLive.name; if (!updatedStudent.placedAt) updatedStudent.placedAt = now.slice(0, 10); }

    const updatedDispatches = dispatches.map(d => (d.studentId === form.id && d.slotId === slotId && d.result === 'pending')
      ? { ...d, result: result === 'placed' ? 'placed' : result === 'rejected' ? 'rejected' : 'withdrawn', resultAt: now, resultBy: userName } : d);

    const nextStudents = allStudents.map(s => s.id === form.id ? updatedStudent : s);
    const nextEmployers = employers.map(e => e.id === updatedEmp.id ? updatedEmp : e);
    await extras.onDataChange({ students: nextStudents, employers: nextEmployers, dispatches: updatedDispatches as Dispatch[] });
    showToast(`✓ ${result === 'placed' ? 'שובץ!' : result === 'rejected' ? 'נדחה' : 'בוטל'}`, 'success');
    setConfirmDialog(null);
  }

  async function markNeverSent(orgName: string) {
    const { student } = materialise();
    const res = unsendOrg({ student, employers, dispatches, orgName, userName, mode: 'never_sent' });
    const nextStudents = allStudents.map(s => s.id === form.id ? res.student : s);
    await extras.onDataChange({ students: nextStudents, employers: res.employers, dispatches: res.dispatches });
    setConfirmDialog(null);
    showToast(`↩︎ ${orgName} חזר לרשימה — המקום שוחרר`, 'success');
  }


  // Path 2 (student-suggested private org): approval IS the placement — no CV sent.
  // The placement itself lives in lib/dispatch.placeDirect, because the students LIST runs
  // it too. It used to exist only here, and the row's button — which promised in its own
  // confirmation that the place would be taken — merely opened this card and did nothing.
  // One function now, so a fix to one is a fix to both.
  async function handlePlaceDirect(orgName: string) {
    const { student } = materialise();
    const res = placeDirect({ student, employers, orgName, userName, newSlotId: () => `${resolveEmployer(orgName)?.id || 'emp'}-direct-${randomId('x')}` });
    if (!res.ok) { showToast(res.error || 'לא ניתן לאשר השמה', 'error'); setConfirmDialog(null); return; }
    await extras.onDataChange({
      students: allStudents.map(s => s.id === form.id ? res.student : s),
      employers: res.employers,
    });
    showToast(`✓ ${form.name} שובץ/ה ל"${orgName}" (השמה ישירה)`, 'success');
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

      <div className="chapter-mark mb-2" style={{ fontSize: '11px' }}>ארגונים מדורגים ושליחה</div>
      {submittedCaption && (
        <div className="text-[11.5px] mb-1" style={{ color: 'var(--text-soft)' }}>{submittedCaption}</div>
      )}
      {cards.filter(c => c.status === 'tentative').length > 1 && (
        <div className="text-[11.5px] mb-3 flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
          <span style={{ fontWeight: 700 }}>▲▼</span> לשינוי דירוג הארגונים — השתמש/י בחיצים (כל שינוי מבקש אישור).
        </div>
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
        // The course's own threshold when it sets one, else the shared default (14 —
        // Yariv 2026-08-11). The row's classifier resolves it exactly the same way, so the
        // card and the list can never disagree about whether an employer is late.
        const agingThreshold = Number((course as any)?.reviewAgingThresholdDays) || SILENCE_DAYS;
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
              {isTentative && cards.length > 1 && (() => {
                const arrow = (enabled: boolean): React.CSSProperties => ({
                  display: 'inline-grid', placeItems: 'center', width: 26, height: 22,
                  border: `1px solid ${enabled ? 'var(--accent)' : 'var(--divider)'}`, borderRadius: 6,
                  background: enabled ? 'var(--accent-soft)' : 'transparent',
                  color: enabled ? 'var(--accent)' : 'var(--divider)', fontSize: 12, fontWeight: 700,
                  cursor: enabled ? 'pointer' : 'default', lineHeight: 1,
                });
                return (
                  <span className="inline-flex flex-col shrink-0 gap-0.5">
                    <button type="button" data-move-up={idx} onClick={() => moveOrg(card.orgName, -1)} disabled={idx === 0}
                      title="העלה בדירוג" style={arrow(idx !== 0)}>▲</button>
                    <button type="button" data-move-down={idx} onClick={() => moveOrg(card.orgName, 1)} disabled={idx === cards.length - 1}
                      title="הורד בדירוג" style={arrow(idx !== cards.length - 1)}>▼</button>
                  </span>
                );
              })()}
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
                {/* Outlook didn't open, or they never replied — reopen the same message and
                    keep the place. The send is re-confirmed like any other. */}
                <button type="button" data-resend={idx}
                  onClick={() => { setSelected(new Set([card.orgName])); setSendSheet(true); }}
                  title="פתח שוב את ההודעה לאותו מעסיק — המקום נשמר"
                  style={btnSmall()}>↻ שלח שוב</button>
                {/* The exit that was missing: the message never went, so free the place and
                    put the org back on the list instead of closing it off as 'בוטל'. */}
                <button type="button" data-never-sent={idx}
                  onClick={() => setConfirmDialog({ type: 'never_sent', orgName: card.orgName })}
                  title="ההודעה לא נשלחה בפועל — שחרר את המקום והחזר לרשימה"
                  style={{ ...btnSmall(), color: '#b45309', borderColor: '#b45309' }}>↩︎ לא נשלח</button>
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

      {/* Portalled to <body>, exactly like the send sheet above. Rendered inside the
          editor's own tree it was clipped by the modal's stacking context — present in
          the DOM but invisible, so a send looked like it did nothing at all. */}
      {pendingSend && createPortal((
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(26,22,18,0.6)' }}>
          <div role="dialog" aria-modal="true" data-send-confirm
            style={{ background: 'var(--bg)', border: '1px solid var(--divider)', borderRadius: 16, maxWidth: 460, width: '100%', padding: '22px 24px', textAlign: 'right', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
            <div className="serif" style={{ fontSize: 22, color: 'var(--ink)', marginBottom: 8 }}>
              {pendingSend.channel === 'whatsapp' ? 'נפתח WhatsApp' : 'נפתח חלון מייל'}
            </div>
            <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-soft)', margin: 0 }}>
              המערכת פותחת את ההודעה — היא <b>לא שולחת בעצמה</b>.
              אשר/י רק אחרי שההודעה נשלחה בפועל אל <b>{pendingSend.orgNames.join(', ')}</b>.
            </p>
            <div style={{ marginTop: 10, padding: '8px 11px', borderRadius: 8, background: 'rgba(185,28,28,0.08)', color: '#b91c1c', fontWeight: 600, fontSize: 12.5 }}>
              ⚠ אישור תופס את המקום בארגון. אם לא נשלח — בחר/י "לא נשלח", והמקום יישאר פנוי.
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 18, flexWrap: 'wrap' }}>
              <button type="button" data-send-confirm-yes
                onClick={async () => { const p = pendingSend; setPendingSend(null); await p.commit(); }}
                style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 9, border: 'none', background: '#15803d', color: '#fff', cursor: 'pointer' }}>
                ✓ נשלח — סמן ותפוס מקום
              </button>
              <button type="button" data-send-confirm-no
                onClick={() => { setPendingSend(null); setSelected(new Set()); showToast('לא נרשמה שליחה — המקום נשאר פנוי', 'info'); }}
                style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 9, border: '1px solid var(--divider-strong)', background: 'transparent', color: 'var(--text-soft)', cursor: 'pointer' }}>
                לא נשלח
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

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

      {/* Secondary toggle — at the BOTTOM (it's not the main thing): reveal orgs that
          aren't currently available, for a deliberate manual override. */}
      <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] mt-2" style={{ color: showAllOrgs ? 'var(--accent)' : 'var(--text-soft)' }}>
        <input type="checkbox" checked={showAllOrgs} onChange={e => setShowAllOrgs(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
        הצג גם ארגונים שאינם זמינים
      </label>

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
                {type === 'placed' ? '✅ אישור שיבוץ' : type === 'place_direct' ? '✅ שיבוץ ישיר (השמה)' : type === 'rejected' ? '❌ אישור דחייה' : isMarkCancelled ? '✓ סמן כבוטל' : type === 'never_sent' ? '↩︎ ההודעה לא נשלחה' : '🚫 ביטול מועמדות'}
              </div>
              <div className="text-[13.5px] mb-5" style={{ color: 'var(--text-soft)' }}>
                {type === 'placed' ? `לסמן שיבוץ של ${form.name} אצל ${emp?.name || orgName}?`
                  : type === 'place_direct' ? `${form.name} כבר במגעים מתקדמים עם ${emp?.name || orgName}. לאשר שיבוץ ישיר — ללא שליחת קו"ח? פעולה זו מסמנת השמה ותופסת מקום.`
                  : type === 'rejected' ? `לסמן שהמעסיק ${emp?.name || orgName} דחה את ${form.name}?`
                  : type === 'never_sent' ? `הקו״ח ל${emp?.name || orgName} לא נשלחו בפועל? המקום בארגון ישוחרר, והארגון יחזור לרשימה כ"טרם נשלח" כדי שאפשר יהיה לשלוח שוב. לא נשלחת שום הודעה.`
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
                    else if (type === 'never_sent') markNeverSent(orgName);
                    else if (isMarkCancelled) handleResult(orgName, 'withdrawn');
                    else handleResult(orgName, type as 'placed' | 'rejected');
                  }} style={btnPrimary()} data-confirm-action={type}>
                    {type === 'placed' ? 'אשר שיבוץ →'
                      : type === 'place_direct' ? 'אשר שיבוץ ישיר →'
                      : type === 'rejected' ? 'אשר דחייה →'
                      : type === 'never_sent' ? 'שחרר והחזר לרשימה →'
                      : 'סמן כבוטל →'}
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
