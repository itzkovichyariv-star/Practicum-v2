/**
 * PlacementPanel — dispatch workflow for a single student.
 * Shown in the student detail view after the StudentEditor form.
 */

import { useState } from 'react';
import type {
  Student, Employer, Course, Dispatch, EmployerApprovalRequest, PlacementSettings, PracticumData,
  StudentPreference, VacancySlot,
} from '../lib/supabase';
import { randomId } from '../lib/dataApi';
import { renderTemplate, buildWhatsAppUrl, buildMailtoUrl, openVacancies, reconcileEmployerCapacity } from '../lib/placement';
import { btnPrimary, btnSecondary, btnSmall } from '../lib/design';
import { showToast } from '../lib/toast';

type Props = {
  student: Student;
  allStudents: Student[];
  employers: Employer[];
  courses: Course[];
  dispatches: Dispatch[];
  approvalRequests: EmployerApprovalRequest[];
  placementSettings: PlacementSettings;
  userName: string;
  onDataChange: (patch: Partial<PracticumData>) => Promise<void>;
};

function getAgingDays(sentAt: string): number {
  return Math.floor((Date.now() - new Date(sentAt).getTime()) / 86400000);
}

export default function PlacementPanel({
  student, allStudents, employers, courses, dispatches, approvalRequests, placementSettings, userName, onDataChange,
}: Props) {
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'placed' | 'rejected' | 'withdrawn' | 'mark_cancelled';
    prefIndex: number;
    pref: StudentPreference;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');

  const preferences: StudentPreference[] = (student as any).preferences || [];
  const submissionStatus = (student as any).submissionStatus as string | undefined;

  // CV link: prefer updated CV (post-prep), fall back to original uploaded CV.
  // These are Supabase Storage public URLs — no manual paste needed.
  const cvLink: string = student.cvUpdatedUrl || student.cvUrl || '';
  const hasCv = !!cvLink;

  // Find the student's course
  const course = courses.find(c => c.id === student.courseId);
  const agingThreshold = (course as any)?.reviewAgingThresholdDays ?? (placementSettings.defaultAgingThresholdDays ?? 14);

  // Orphan prefs: student placed but still has tentative/under_review prefs
  const isPlaced = submissionStatus === 'placed';
  const orphanPrefs = isPlaced
    ? preferences.filter(p => p.status === 'tentative' || p.status === 'under_review')
    : [];

  function getEmployer(employerId: string): Employer | undefined {
    return employers.find(e => e.id === employerId);
  }

  function getSlot(emp: Employer, slotId: string): VacancySlot | undefined {
    return ((emp as any).vacancySlots || []).find((s: any) => s.id === slotId);
  }

  function buildCtx(emp: Employer) {
    return {
      contactName: emp.contactPerson || emp.name,
      studentName: student.name,
      positionTitle: emp.name,
      adminName: userName,
      courseName: course?.name || '',
      cvLink,
      employerName: emp.name,
    };
  }

  function copyCvLink() {
    if (!cvLink) return;
    navigator.clipboard.writeText(cvLink).then(() => {
      setCopyMsg('✓ הועתק');
      setTimeout(() => setCopyMsg(''), 2000);
    });
  }

  async function handleDispatch(prefIndex: number, pref: StudentPreference, channel: 'whatsapp' | 'email') {
    if (!hasCv) {
      showToast('יש להעלות קורות חיים לסטודנט לפני שליחה', 'error');
      return;
    }
    const emp = getEmployer(pref.employerId);
    if (!emp) return;

    const ctx = buildCtx(emp);
    const now = new Date().toISOString();

    // Build the message
    let url = '';
    let messageSnapshot = '';
    if (channel === 'whatsapp') {
      messageSnapshot = renderTemplate(placementSettings.whatsappTemplate, ctx);
      url = buildWhatsAppUrl(emp.contactPhone || '', messageSnapshot);
    } else {
      const subject = renderTemplate(placementSettings.emailSubjectTemplate, ctx);
      const body = renderTemplate(placementSettings.emailBodyTemplate, ctx);
      messageSnapshot = `${subject}\n\n${body}`;
      url = buildMailtoUrl(emp.contactEmail || '', subject, body);
      if (body.length > 1800) {
        showToast('גוף המייל ארוך מדי — מומלץ להעתיק ידנית', 'warn');
      }
    }

    window.open(url, '_blank');

    // Update slot to under_review
    const slot = getSlot(emp, pref.slotId);
    const updatedSlots: VacancySlot[] = ((emp as any).vacancySlots || []).map((s: any) => {
      if (s.id !== pref.slotId) return s;
      return {
        ...s,
        status: 'under_review',
        history: [...(s.history || []), { at: now, from: s.status, to: 'under_review', by: 'admin', actorId: userName }],
      };
    });
    const updatedEmp = reconcileEmployerCapacity({ ...emp, vacancySlots: updatedSlots });

    // Update student preference status
    const updatedPrefs = preferences.map((p, i) =>
      i === prefIndex ? { ...p, status: 'under_review' as const } : p
    );
    const updatedStudent = { ...student, preferences: updatedPrefs } as any;

    // Create dispatch record
    const dispatch: Dispatch = {
      id: randomId('d'),
      studentId: student.id,
      employerId: emp.id,
      slotId: pref.slotId,
      channel,
      sentBy: userName,
      sentAt: now,
      messageSnapshot,
      result: 'pending',
      resultAt: null,
      resultBy: null,
    };

    const nextStudents = allStudents.map(s => s.id === student.id ? updatedStudent : s);
    const nextEmployers = employers.map(e => e.id === emp.id ? updatedEmp : e);
    await onDataChange({
      students: nextStudents,
      employers: nextEmployers,
      dispatches: [...dispatches, dispatch],
    });
    showToast(`✓ ${channel === 'whatsapp' ? 'WhatsApp' : 'מייל'} נשלח`, 'success');
  }

  async function handleResult(
    prefIndex: number,
    pref: StudentPreference,
    result: 'placed' | 'rejected' | 'withdrawn',
    openChannel?: 'whatsapp' | 'email',
  ) {
    const emp = getEmployer(pref.employerId);
    if (!emp) return;
    const now = new Date().toISOString();

    // Open withdrawal channel if requested
    if (openChannel && (result === 'withdrawn')) {
      const ctx = buildCtx(emp);
      let url = '';
      if (openChannel === 'whatsapp') {
        const msg = renderTemplate(placementSettings.whatsappWithdrawalTemplate, ctx);
        url = buildWhatsAppUrl(emp.contactPhone || '', msg);
      } else {
        const subject = renderTemplate(placementSettings.emailWithdrawalSubjectTemplate, ctx);
        const body = renderTemplate(placementSettings.emailWithdrawalBodyTemplate, ctx);
        url = buildMailtoUrl(emp.contactEmail || '', subject, body);
      }
      window.open(url, '_blank');
    }

    // Update slot
    const newSlotStatus = result === 'placed' ? 'placed' : 'available';
    const updatedSlots: VacancySlot[] = ((emp as any).vacancySlots || []).map((s: any) => {
      if (s.id !== pref.slotId) return s;
      const histEntry: any = {
        at: now,
        from: s.status,
        to: newSlotStatus,
        by: 'admin',
        actorId: userName,
      };
      if (result === 'withdrawn') {
        histEntry.reason = isPlaced ? 'withdrawn-after-placement' : 'withdrawn-manual';
      }
      return {
        ...s,
        status: newSlotStatus,
        studentId: result === 'placed' ? s.studentId : null,
        prefRank: result === 'placed' ? s.prefRank : null,
        history: [...(s.history || []), histEntry],
      };
    });

    const updatedEmp = reconcileEmployerCapacity({ ...emp, vacancySlots: updatedSlots });

    // Update preference
    const updatedPrefs = preferences.map((p, i) =>
      i === prefIndex ? { ...p, status: result === 'placed' ? 'placed' as const : result === 'rejected' ? 'rejected' as const : 'withdrawn' as const } : p
    );

    // Determine new submissionStatus
    const allPrefs = updatedPrefs;
    let newSubmissionStatus = (student as any).submissionStatus;
    if (result === 'placed') {
      newSubmissionStatus = 'placed';
    } else if (result === 'rejected' || result === 'withdrawn') {
      const stillActive = allPrefs.some(p => p.status === 'tentative' || p.status === 'under_review');
      const anyPlaced = allPrefs.some(p => p.status === 'placed');
      if (!stillActive && !anyPlaced) {
        newSubmissionStatus = 'exhausted';
      }
    }

    const updatedStudent = { ...student, preferences: updatedPrefs, submissionStatus: newSubmissionStatus } as any;

    // Update matching dispatch record
    const updatedDispatches = dispatches.map(d => {
      if (d.studentId === student.id && d.slotId === pref.slotId && d.result === 'pending') {
        return { ...d, result: result === 'placed' ? 'placed' : result === 'rejected' ? 'rejected' : 'withdrawn', resultAt: now, resultBy: userName };
      }
      return d;
    });

    const nextStudents = allStudents.map(s => s.id === student.id ? updatedStudent : s);
    const nextEmployers = employers.map(e => e.id === emp.id ? updatedEmp : e);
    await onDataChange({
      students: nextStudents,
      employers: nextEmployers,
      dispatches: updatedDispatches as Dispatch[],
    });

    const resultLabel = result === 'placed' ? 'שובץ!' : result === 'rejected' ? 'נדחה' : 'בוטל';
    showToast(`✓ ${resultLabel}`, 'success');
    setConfirmDialog(null);
  }

  // Release a not-yet-sent (tentative) preference: free its reserved vacancy and
  // drop the row — for when you decide to go with another org instead.
  async function handleRelease(prefIndex: number, pref: StudentPreference) {
    const emp = getEmployer(pref.employerId);
    const now = new Date().toISOString();
    let nextEmployers = employers;
    if (emp) {
      const updatedSlots = ((emp as any).vacancySlots || []).map((s: any) => {
        if (s.id !== pref.slotId) return s;
        return { ...s, status: 'available', studentId: null, prefRank: null, history: [...(s.history || []), { at: now, from: s.status, to: 'available', by: 'admin', actorId: userName, reason: 'released' }] };
      });
      const updatedEmp = reconcileEmployerCapacity({ ...emp, vacancySlots: updatedSlots });
      nextEmployers = employers.map(e => e.id === emp.id ? updatedEmp : e);
    }
    const updatedPrefs = preferences.filter((_, i) => i !== prefIndex).map((p, i) => ({ ...p, rank: i + 1 }));
    const updatedStudent = { ...student, preferences: updatedPrefs } as any;
    const nextStudents = allStudents.map(s => s.id === student.id ? updatedStudent : s);
    await onDataChange({ students: nextStudents, employers: nextEmployers });
    showToast('✓ ההעדפה הוסרה והמקום שוחרר', 'success');
  }

  const hasAnyUnderReview = preferences.some(p => p.status === 'under_review');
  const isExhausted = submissionStatus === 'exhausted';

  return (
    <div style={{ direction: 'rtl', marginTop: '24px' }}>
      <div className="serif text-[20px] mb-4" style={{ color: 'var(--ink)' }}>
        שליחת קורות חיים למעסיק
      </div>

      {/* CV section — uses Supabase Storage URLs (cvUpdatedUrl preferred, cvUrl fallback) */}
      <div className="rounded-xl p-4 mb-4" style={{ background: 'rgba(122,30,43,0.04)', border: `1px solid ${hasCv ? 'var(--divider)' : 'rgba(220,38,38,0.35)'}` }}>
        <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2 font-semibold" style={{ color: 'var(--text-soft)' }}>
          קורות חיים לשליחה
        </div>
        {hasCv ? (
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[13px]" style={{ color: 'var(--ink)' }}>
              {student.cvUpdatedUrl ? '✓ קו"ח מעודכן (אחרי הכנה)' : '✓ קו"ח מקורי'}
            </span>
            <button onClick={() => window.open(cvLink, '_blank')} style={btnSmall()}>פתח ↗</button>
            <button onClick={copyCvLink} style={btnSmall()}>
              {copyMsg || '📋 העתק קישור'}
            </button>
            <span className="mono text-[10.5px]" style={{ color: 'var(--text-soft)' }}>
              הקישור מצורף אוטומטית להודעה
            </span>
          </div>
        ) : (
          <div className="text-[13px]" style={{ color: '#b91c1c' }}>
            ⚠ לא הועלה קו"ח לסטודנט — יש להעלות בטופס הסטודנט לפני שליחה למעסיק.
          </div>
        )}
      </div>

      {/* Orphan banner */}
      {isPlaced && orphanPrefs.length > 0 && (
        <div className="rounded-xl p-4 mb-4" style={{ background: 'rgba(217,119,6,0.09)', border: '1px solid rgba(217,119,6,0.4)' }}>
          <div className="font-semibold mb-2" style={{ color: '#92400e' }}>
            ⚠ הסטודנט שובץ אך יש מועמדויות פתוחות אצל מעסיקים נוספים
          </div>
          <div className="text-[13px]" style={{ color: '#92400e' }}>
            יש לסיים כל מועמדות פתוחה — שלח הודעת ביטול → סמן כבוטל.
          </div>
        </div>
      )}

      {/* Per-preference list */}
      {preferences.length === 0 && !isExhausted && (
        <div className="text-[13px] py-3" style={{ color: 'var(--text-soft)' }}>
          לסטודנט אין העדפות מוגדרות. יש להגיש טופס שיבוץ.
        </div>
      )}

      {preferences.map((pref, idx) => {
        const emp = getEmployer(pref.employerId);
        if (!emp) return null;
        const slot = getSlot(emp, pref.slotId);
        const isPending = (emp as any).approvalStatus === 'pending';
        const sentDispatch = dispatches.filter(d => d.studentId === student.id && d.slotId === pref.slotId && d.result === 'pending').slice(-1)[0];
        const agingDays = sentDispatch ? getAgingDays(sentDispatch.sentAt) : 0;
        const isAging = sentDispatch && agingDays > agingThreshold;
        const isOrphan = isPlaced && (pref.status === 'tentative' || pref.status === 'under_review');

        const statusLabel: Record<string, string> = {
          tentative: 'ממתין לשליחה',
          under_review: 'בבדיקה אצל מעסיק',
          placed: 'שובץ',
          rejected: 'נדחה',
          withdrawn: 'בוטל',
        };

        return (
          <div key={idx}
            className="rounded-xl p-4 mb-3"
            style={{
              border: isPending ? '1px solid rgba(217,119,6,0.4)' : isOrphan ? '1px solid rgba(217,119,6,0.4)' : '1px solid var(--divider)',
              background: isPending ? 'rgba(217,119,6,0.05)' : isOrphan ? 'rgba(217,119,6,0.05)' : 'rgba(0,0,0,0.02)',
            }}>

            {/* Header */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="font-semibold text-[14px]" style={{ color: 'var(--ink)' }}>
                העדפה {pref.rank} — {emp.name}
              </span>
              {(() => {
                // Live remaining vacancies at this org — drops when a CV is sent, rises on reject/withdraw.
                const open = openVacancies(emp);
                return (
                  <span className="mono text-[10.5px] px-2 py-0.5 rounded-full"
                    style={{ background: open > 0 ? 'rgba(5,150,105,0.08)' : 'rgba(180,60,60,0.08)', color: open > 0 ? '#059669' : '#b03030' }}
                    title="מקומות פנויים בארגון (מתעדכן עם שליחה/ביטול)">
                    {open > 0 ? `נותרו ${open} מקומות` : 'אין מקומות פנויים'}
                  </span>
                );
              })()}
              {isPending && (
                <span className="mono text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(217,119,6,0.15)', color: '#b45309' }}>ממתין לאישור</span>
              )}
              <span className="mono text-[11px] px-2 py-0.5 rounded-full"
                style={{
                  background: pref.status === 'placed' ? 'rgba(5,150,105,0.1)' : pref.status === 'under_review' ? 'rgba(37,99,235,0.1)' : pref.status === 'rejected' || pref.status === 'withdrawn' ? 'rgba(180,60,60,0.1)' : 'rgba(0,0,0,0.06)',
                  color: pref.status === 'placed' ? '#059669' : pref.status === 'under_review' ? '#1d4ed8' : pref.status === 'rejected' || pref.status === 'withdrawn' ? '#b03030' : 'var(--text-soft)',
                }}>
                {statusLabel[pref.status] || pref.status}
              </span>
              {isAging && (
                <span className="mono text-[10.5px] px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.3)', animation: 'pulse 2s infinite' }}>
                  ⏱ ממתין {agingDays} ימים
                </span>
              )}
              {sentDispatch && !isAging && agingDays > 0 && (
                <span className="mono text-[10.5px]" style={{ color: 'var(--text-soft)' }}>
                  נשלח לפני {agingDays} ימים
                </span>
              )}
            </div>

            {/* Actions based on status */}
            {(pref.status === 'tentative' || (isOrphan && pref.status === 'under_review')) && !isPlaced && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleDispatch(idx, pref, 'whatsapp')}
                  disabled={!hasCv}
                  title={hasCv ? undefined : 'יש להזין קישור שיתוף לקו"ח לפני שליחה'}
                  style={{
                    ...btnSmall(!hasCv),
                    background: hasCv ? '#25D366' : undefined,
                    color: hasCv ? 'white' : undefined,
                    borderColor: hasCv ? '#25D366' : undefined,
                  }}>
                  📱 WhatsApp
                </button>
                <button
                  onClick={() => handleDispatch(idx, pref, 'email')}
                  disabled={!hasCv}
                  title={hasCv ? undefined : 'יש להזין קישור שיתוף לקו"ח לפני שליחה'}
                  style={{
                    ...btnSmall(!hasCv),
                    background: hasCv ? '#2563eb' : undefined,
                    color: hasCv ? 'white' : undefined,
                    borderColor: hasCv ? '#2563eb' : undefined,
                  }}>
                  ✉ מייל
                </button>
                {pref.status === 'tentative' && (
                  <button
                    onClick={() => handleRelease(idx, pref)}
                    title="הסר העדפה זו ושחרר את המקום שהשתריין"
                    style={{ ...btnSmall(), color: 'var(--text-soft)' }}>
                    ✕ הסר ושחרר מקום
                  </button>
                )}
                {!hasCv && (
                  <span className="mono text-[11px]" style={{ color: '#b91c1c' }}>
                    יש להעלות קו"ח בטופס הסטודנט
                  </span>
                )}
              </div>
            )}

            {pref.status === 'under_review' && !isOrphan && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setConfirmDialog({ type: 'placed', prefIndex: idx, pref })}
                  style={{ ...btnSmall(), background: '#059669', color: 'white', borderColor: '#059669' }}>
                  ✅ נקלט
                </button>
                <button
                  onClick={() => setConfirmDialog({ type: 'rejected', prefIndex: idx, pref })}
                  style={{ ...btnSmall(), background: '#dc2626', color: 'white', borderColor: '#dc2626' }}>
                  ❌ נדחה
                </button>
                <button
                  onClick={() => setConfirmDialog({ type: 'withdrawn', prefIndex: idx, pref })}
                  style={btnSmall()}>
                  🚫 בטל מועמדות
                </button>
              </div>
            )}

            {/* Orphan (placed student with open slots) */}
            {isOrphan && (
              <div className="flex flex-wrap gap-2 mt-1">
                <button
                  onClick={() => setConfirmDialog({ type: 'withdrawn', prefIndex: idx, pref })}
                  style={{ ...btnSmall(), background: 'rgba(217,119,6,0.1)', borderColor: '#b45309', color: '#92400e' }}>
                  📱 שלח הודעת ביטול — WhatsApp
                </button>
                <button
                  onClick={() => setConfirmDialog({ type: 'withdrawn', prefIndex: idx, pref })}
                  style={{ ...btnSmall(), background: 'rgba(217,119,6,0.1)', borderColor: '#b45309', color: '#92400e' }}>
                  ✉ שלח הודעת ביטול — Email
                </button>
                <button
                  onClick={() => setConfirmDialog({ type: 'mark_cancelled', prefIndex: idx, pref })}
                  style={btnSmall()}>
                  ✓ סמן כבוטל
                </button>
              </div>
            )}

            {pref.status === 'placed' && (
              <div className="mono text-[11px] font-semibold" style={{ color: '#059669' }}>
                ✅ שובץ
              </div>
            )}

            {(pref.status === 'rejected' || pref.status === 'withdrawn') && (
              <div className="mono text-[11px]" style={{ color: 'var(--text-soft)' }}>
                {pref.status === 'rejected' ? '❌ נדחה על ידי המעסיק' : '🚫 בוטל'}
              </div>
            )}
          </div>
        );
      })}

      {/* Exhausted state */}
      {(isExhausted || preferences.filter(p => p.status === 'rejected' || p.status === 'withdrawn').length === preferences.length && preferences.length > 0) && (
        <div className="rounded-xl p-4 mt-3" style={{ background: 'rgba(122,30,43,0.04)', border: '1px solid var(--divider)' }}>
          <div className="text-[13px] mb-2" style={{ color: 'var(--text-soft)' }}>
            כל ההעדפות נוצלו. ניתן להוסיף העדפות חדשות.
          </div>
          <div className="mono text-[11.5px]" style={{ color: 'var(--text-soft)' }}>
            ➕ לחץ על "ערוך" בטופס הסטודנט להוספת העדפות נוספות.
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmDialog && (() => {
        const { type, prefIndex, pref } = confirmDialog;
        const emp = getEmployer(pref.employerId);
        const isWithdrawal = type === 'withdrawn';
        const isMarkCancelled = type === 'mark_cancelled';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="rounded-2xl border p-6 max-w-[420px] w-full mx-4"
              style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', direction: 'rtl' }}>
              <div className="serif text-[20px] mb-3" style={{ color: 'var(--ink)' }}>
                {type === 'placed' ? '✅ אישור שיבוץ'
                  : type === 'rejected' ? '❌ אישור דחייה'
                  : isMarkCancelled ? '✓ סמן כבוטל'
                  : '🚫 ביטול מועמדות'}
              </div>
              <div className="text-[13.5px] mb-5" style={{ color: 'var(--text-soft)' }}>
                {type === 'placed'
                  ? `לסמן שיבוץ של ${student.name} אצל ${emp?.name}?`
                  : type === 'rejected'
                  ? `לסמן שהמעסיק ${emp?.name} דחה את ${student.name}?`
                  : isMarkCancelled
                  ? `לסמן ביטול מועמדות אצל ${emp?.name} ללא פתיחת ערוץ תקשורת?`
                  : `לבטל את מועמדות ${student.name} אצל ${emp?.name}?`}
              </div>
              {isWithdrawal && (
                <div className="flex flex-col gap-2 mb-4">
                  <button
                    onClick={() => handleResult(prefIndex, pref, 'withdrawn', 'whatsapp')}
                    style={{ ...btnPrimary(), background: '#25D366', width: '100%', textAlign: 'center' }}>
                    📱 פתח WhatsApp + סמן בוטל
                  </button>
                  <button
                    onClick={() => handleResult(prefIndex, pref, 'withdrawn', 'email')}
                    style={{ ...btnPrimary(), background: '#2563eb', width: '100%', textAlign: 'center' }}>
                    ✉ פתח מייל + סמן בוטל
                  </button>
                </div>
              )}
              <div className="flex gap-3 justify-between">
                <button onClick={() => setConfirmDialog(null)} style={btnSecondary()}>ביטול</button>
                {!isWithdrawal && (
                  <button
                    onClick={() => {
                      if (isMarkCancelled) handleResult(prefIndex, pref, 'withdrawn');
                      else handleResult(prefIndex, pref, type as 'placed' | 'rejected');
                    }}
                    style={btnPrimary()}>
                    {type === 'placed' ? 'אשר שיבוץ →' : type === 'rejected' ? 'אשר דחייה →' : 'סמן כבוטל →'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
