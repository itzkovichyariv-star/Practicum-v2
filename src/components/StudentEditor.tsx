import { useState, useEffect, type FormEvent } from 'react';
import { btnSmall, btnSecondary } from '../lib/design';
import type { Student, Course, Employer, Dispatch, EmployerApprovalRequest, PlacementSettings, PracticumData } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import { randomId, ensureFeedbackToken, buildFeedbackUrl } from '../lib/dataApi';
import { orgAvailability } from '../lib/orgAvailability';
import { buildWhatsAppUrl, buildMailtoUrl } from '../lib/placement';
import { openMailto } from '../lib/openMailto';
import { viewableCvUrl, resolveCvUrl } from '../lib/cvUrl';
import { showToast } from '../lib/toast';
import EvaluationForm from './EvaluationForm';
import { QuestionnaireView } from './CandidateEditor';
import Modal from './Modal';
import OrgHub from './OrgHub';
import { WhatsAppIcon, MailIcon, dispatchChip } from './icons';

type PlacementExtras = {
  allStudents: Student[];
  dispatches: Dispatch[];
  approvalRequests: EmployerApprovalRequest[];
  placementSettings: PlacementSettings | Record<string, any>;
  userName: string;
  onDataChange: (patch: Partial<PracticumData>) => Promise<void>;
};

type Props = {
  student: Student | null;
  courses: Course[];
  years: string[];
  employers: Employer[];
  defaultCourseId?: string;
  defaultYear?: string;
  onSave: (s: Student) => void;
  onAutoSave?: (s: Student) => Promise<void>;
  onDelete?: (id: string) => void;
  onClose: () => void;
  placementExtras?: PlacementExtras;
  /** Append a candidate-suggested org as a private (restricted) approved employer. */
  onApproveSuggestion?: (emp: Employer, ctx: { studentId: string; firstChoiceOrgName: string; courseId?: string; suggestionId?: string }) => Promise<void> | void;
};

export default function StudentEditor({
  student, courses, years, employers, defaultCourseId, defaultYear, onSave, onAutoSave, onDelete, onClose, placementExtras, onApproveSuggestion,
}: Props) {
  const isNew = !student;
  const [showEval, setShowEval] = useState(false);
  const [shownFeedbackUrl, setShownFeedbackUrl] = useState('');
  const [checkingFeedback, setCheckingFeedback] = useState(false);
  const [form, setForm] = useState<Student>({
    id: student?.id || randomId('s'),
    name: student?.name || '',
    phone: student?.phone || '',
    email: student?.email || '',
    city: student?.city || '',
    courseId: student?.courseId || (defaultCourseId !== '__all__' ? defaultCourseId : ''),
    year: student?.year || (defaultYear !== '__all__' ? defaultYear : ''),
    acceptedOrg: student?.acceptedOrg || '',
    hired: student?.hired || false,
    preparation: student?.preparation || { passed: false, date: '' },
    hoursReported: student?.hoursReported || 0,
    hoursApproved: student?.hoursApproved || 0,
    feedbackText: student?.feedbackText || '',
    notes: student?.notes || '',
    practicumCompleted: student?.practicumCompleted || false,
    fromCandidate: student?.fromCandidate || false,
    fromCandidateId: student?.fromCandidateId,
    cvUrl: student?.cvUrl || '',
    formUrl: student?.formUrl || '',
    cvUpdatedUrl: student?.cvUpdatedUrl || '',
    questionnaire: student?.questionnaire ?? null,
    firstChoiceOrg: student?.firstChoiceOrg || '',
    firstChoiceResult: student?.firstChoiceResult || 'pending',
    secondChoiceOrg: student?.secondChoiceOrg || '',
    secondChoiceResult: student?.secondChoiceResult || 'pending',
    // Third choice — the 3-request student model (2026-07-20) writes this from the
    // public /organizations page. It MUST be loaded into the form, or the editor
    // shows only 2 choices and buildPlacements (which reads form.thirdChoiceOrg)
    // silently drops the student's third request. Found live: הדר עוזירי chose
    // שיבא as her 3rd and it was invisible + would not have been built.
    thirdChoiceOrg: (student as any)?.thirdChoiceOrg || '',
    thirdChoiceResult: (student as any)?.thirdChoiceResult || 'pending',
    placementInterviewDate: student?.placementInterviewDate || '',
    placementInterviewTime: student?.placementInterviewTime || '',
    placementInterviewOrg: student?.placementInterviewOrg || '',
    feedbackToken: student?.feedbackToken || '',
    feedbackSubmittedAt: student?.feedbackSubmittedAt || '',
    placedAt: student?.placedAt || '',
    // Placement extension — carried through the form so PlacementPanel (fed `form`)
    // can see them and so a normal save never drops them.
    cvShareUrl: (student as any)?.cvShareUrl || '',
    preferences: student?.preferences || [],
    submissionStatus: student?.submissionStatus,
  });
  // ── Pending CV update detection ──────────────────────────────────────
  type SuggestedOrg = { name?: string; contactName?: string; contactRole?: string; email?: string; phone?: string; location?: string; notes?: string };
  const [pendingCv, setPendingCv] = useState<{ id: string; cv_file_path: string; uploaded_at: string; org_pref_1?: string | null; org_pref_2?: string | null; org_pref_3?: string | null; suggested_org?: SuggestedOrg | null } | null>(null);
  const [cvApplied, setCvApplied] = useState(false);
  const [suggestionDecided, setSuggestionDecided] = useState<null | 'approved' | 'rejected'>(null);
  // Org-assignment dropdowns are gated to student-available orgs by default;
  // this toggle bypasses the gate to allow a deliberate manual override.
  const [showAllOrgs, setShowAllOrgs] = useState(false);

  useEffect(() => {
    const email = student?.email?.trim().toLowerCase();
    // Show ANY not-yet-applied submission — including a RE-SUBMISSION after the student
    // already has an updated CV. The old code skipped when `cvUpdatedUrl` was set, so a
    // student who re-uploaded a corrected CV (or new org preferences) was silently
    // ignored: the coordinator kept sending the OLD CV with no signal a newer one
    // existed (verified live 2026-07-21). An unseen row = not yet applied — applyPendingCv
    // marks it seen, so a resolved submission won't re-appear.
    if (!email) return;
    supabase.from('cv_updates')
      .select('id, cv_file_path, uploaded_at, org_pref_1, org_pref_2, org_pref_3, suggested_org')
      .eq('email', email)
      .is('seen_at', null)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        // "Pending" = the latest submission differs from what's currently on the
        // student record — in EITHER the CV file OR the org preferences. An org-only
        // update deliberately reuses the current CV path (cv_updates needs one), so a
        // file-only guard would hide it; comparing orgs too surfaces it. Once the
        // coordinator adopts (fields match the row), it stops nagging — which is what
        // carries the guard even though anon can't write cv_updates.seen_at (RLS).
        const row = data?.[0];
        if (!row) return;
        const currentFile = (student?.cvUpdatedUrl || '').split('/').pop();
        const same = (a?: string | null, b?: string | null) => (a || '').trim() === (b || '').trim();
        const cvChanged = row.cv_file_path.split('/').pop() !== currentFile;
        const orgsChanged = !same(row.org_pref_1, student?.firstChoiceOrg)
          || !same(row.org_pref_2, student?.secondChoiceOrg)
          || !same(row.org_pref_3, (student as any)?.thirdChoiceOrg);
        if (cvChanged || orgsChanged) setPendingCv(row);
      });
  }, [student?.email, student?.cvUpdatedUrl, student?.firstChoiceOrg, student?.secondChoiceOrg, (student as any)?.thirdChoiceOrg]);

  // Full submission history for this candidate (every dated /cv-update submission).
  type CvRow = { id: string; uploaded_at: string; cv_file_path?: string | null; org_pref_1?: string | null; org_pref_2?: string | null; org_pref_3?: string | null; suggested_org?: SuggestedOrg | null };
  const [cvHistory, setCvHistory] = useState<CvRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showCvHistory, setShowCvHistory] = useState(false); // the CV strip's קו״ח-history toggle
  useEffect(() => {
    const email = student?.email?.trim().toLowerCase();
    if (!email) { setCvHistory([]); return; }
    let alive = true;
    supabase.from('cv_updates')
      .select('id, uploaded_at, cv_file_path, org_pref_1, org_pref_2, org_pref_3, suggested_org')
      .eq('email', email)
      .order('uploaded_at', { ascending: false })
      .limit(40) // cap history — a heavily re-tested email can have dozens of rows
      .then(({ data }) => { if (alive) setCvHistory((data || []) as CvRow[]); });
    return () => { alive = false; };
  }, [student?.email]);

  function openFeedbackView() {
    if (!form.feedbackText) return;
    const date = form.feedbackSubmittedAt ? new Date(form.feedbackSubmittedAt).toLocaleDateString('he-IL') : '';

    // Parse structured JSON (v2) or fall back to plain text display
    let d: any = null;
    try { const p = JSON.parse(form.feedbackText); if (p.v === 2) d = p; } catch {}

    const GROUPS = [
      { label: 'יחסי אנוש ותקשורת', items: ['יחסי אנוש ועבודת צוות','כישורי תקשורת כתובים','כישורי תקשורת בעל‑פה'] },
      { label: 'מקצועיות ואחריות',   items: ['אחריות ועמידה בזמנים','שליטה בתחום המקצועי','תרומה כללית לארגון'] },
      { label: 'יכולת ולמידה',       items: ['יוזמה ועצמאות בעבודה','יכולת למידה והסתגלות','כישורי ניתוח וחשיבה','התמודדות עם לחץ'] },
    ];

    function esc(s: string) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function stars(n: number | 'na' | undefined) {
      if (n == null) return '<span style="color:#bbb">לא מולא</span>';
      if (n === 'na') return '<span style="color:#999">לא רלוונטי</span>';
      return [1,2,3,4,5].map(i => `<span style="color:${i<=n?'#7a1e2b':'#ddd'};font-size:16px">●</span>`).join(' ') + ` <strong style="color:#7a1e2b">${n}</strong>`;
    }

    const criteriaHtml = d ? GROUPS.map(g => `
      <div class="section-sub">${g.label}</div>
      ${g.items.map(item => `
        <div class="crit-row">
          <div class="crit-label">${esc(item)}</div>
          <div class="crit-val">${stars(d.ratings?.[item])}</div>
        </div>`).join('')}
      ${d.groupNotes?.[g.label] ? `<div class="note-box"><strong>הסבר:</strong> ${esc(d.groupNotes[g.label])}</div>` : ''}
    `).join('') : `<pre style="white-space:pre-wrap;font-size:13px;line-height:1.8">${esc(form.feedbackText)}</pre>`;

    const overallHtml = d ? `
      <div style="display:flex;gap:32px;flex-wrap:wrap;margin-bottom:16px">
        <div><div class="field-label">ציון שביעות רצון</div>
          <div style="font-size:36px;font-weight:700;color:#7a1e2b">${esc(d.overallScore)}<span style="font-size:16px;font-weight:400;color:#888">/100</span></div>
        </div>
        <div><div class="field-label">המלצה כוללת</div>
          <div style="font-size:16px;font-weight:600;color:#7a1e2b">${esc(d.recommendation)}</div>
        </div>
        <div><div class="field-label">נקלט/ה לעבודה</div>
          <div style="font-size:16px;font-weight:600">${d.hired ? '✓ כן' : 'לא'}</div>
        </div>
      </div>
      ${d.strengths ? `<div class="open-box"><div class="field-label">חוזקות בולטות</div><p>${esc(d.strengths)}</p></div>` : ''}
      ${d.improvements ? `<div class="open-box"><div class="field-label">תחומים לשיפור</div><p>${esc(d.improvements)}</p></div>` : ''}
      ${d.additionalNotes ? `<div class="open-box"><div class="field-label">הערות נוספות</div><p>${esc(d.additionalNotes)}</p></div>` : ''}
    ` : '';

    const placementHtml = d ? `
      <div class="row"><span class="lbl">מנחה בארגון</span><span>${esc(d.mentor)}</span></div>
      ${d.mentorRole ? `<div class="row"><span class="lbl">תפקיד המנחה</span><span>${esc(d.mentorRole)}</span></div>` : ''}
      ${d.period ? `<div class="row"><span class="lbl">תקופת ההתנסות</span><span>${esc(d.period)}</span></div>` : ''}
    ` : '';

    const html = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
<title>משוב מעסיק — ${esc(form.name)}</title>
<style>
  body{font-family:Arial,sans-serif;direction:rtl;color:#1a1a1a;margin:0;background:#f4efe6}
  .wrap{max-width:700px;margin:32px auto;background:#fff;border-radius:12px;padding:40px 48px;box-shadow:0 4px 24px rgba(0,0,0,0.1)}
  .print-btn{display:inline-block;margin-bottom:20px;padding:10px 22px;background:#7a1e2b;color:#fff;border:none;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;letter-spacing:.04em}
  h1{font-family:Georgia,serif;font-size:24px;margin:0 0 3px;color:#3d0f14}
  .sub{font-size:13px;color:#888;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #e8e0d5}
  h2{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#7a1e2b;border-bottom:1px solid #e8e0d5;padding-bottom:6px;margin:28px 0 12px}
  .row{display:flex;gap:12px;padding:5px 0;border-bottom:1px solid #f0ebe3;font-size:14px}
  .lbl{color:#888;width:130px;flex-shrink:0;font-size:12px;font-weight:600;padding-top:2px}
  .section-sub{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:14px 0 6px}
  .crit-row{display:flex;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid #f5f0ee}
  .crit-label{flex:1;font-size:14px}
  .crit-val{display:flex;align-items:center;gap:4px}
  .note-box{background:#faf7f4;border-radius:6px;padding:8px 12px;font-size:13px;color:#555;margin:6px 0 10px;border:1px solid #ede8e0}
  .open-box{margin:10px 0;padding:10px 14px;background:#faf7f4;border-radius:8px;border:1px solid #ede8e0}
  .open-box p{margin:4px 0 0;font-size:14px;line-height:1.7;white-space:pre-wrap}
  .field-label{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#888;margin-bottom:3px}
  @media print{.print-btn{display:none}body{background:#fff}.wrap{box-shadow:none;margin:0;border-radius:0;padding:1.5cm}@page{size:A4;margin:1.2cm}}
</style></head><body>
<div class="wrap">
  <button class="print-btn" onclick="window.print()">🖨 הדפס / PDF</button>
  <h1>טופס הערכת סטודנט/ית — ${esc(form.name)}</h1>
  <div class="sub">${esc(form.acceptedOrg||'')}${date?' · תאריך מילוי: '+date:''} · פרקטיקום · אוניברסיטת אריאל</div>

  <h2>א — פרטי הסטודנט/ית</h2>
  <div class="row"><span class="lbl">שם מלא</span><span>${esc(form.name)}</span></div>
  <div class="row"><span class="lbl">ארגון מאכסן</span><span>${esc(form.acceptedOrg||'')}</span></div>

  ${placementHtml ? `<h2>ב — פרטי ההשמה</h2>${placementHtml}` : ''}

  <h2>ג — הערכת תפקוד</h2>
  ${criteriaHtml}

  ${d ? `<h2>ד — שביעות רצון כללית</h2>${overallHtml}` : ''}
</div>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function checkFeedbackStatus() {
    if (!form.id) return;
    setCheckingFeedback(true);
    const { data: row } = await supabase.from('practicum_data').select('data').eq('org_id', 'default').single();
    if (row) {
      const d = (row as any).data;
      const fresh = (d.students || []).find((s: any) => s.id === form.id);
      if (fresh) {
        setForm(f => ({
          ...f,
          feedbackSubmittedAt: fresh.feedbackSubmittedAt || f.feedbackSubmittedAt,
          feedbackText: fresh.feedbackText || f.feedbackText,
        }));
      }
    }
    setCheckingFeedback(false);
  }

  async function applyPendingCv() {
    if (!pendingCv) return;
    const storageUrl = `storage://candidate-uploads/${pendingCv.cv_file_path}`;
    // Adopt the WHOLE latest submission — the new CV AND the new org preferences —
    // so a re-submission REPLACES the old (Yariv 2026-07-21: "בקשה חדשה צריכה
    // להחליף את הישנה … וכמובן שקורות חיים חדשים צריכים להחליף ישנים"). The previous
    // values are never lost: every submission stays in cv_updates and is revealed by
    // the "היסטוריית הגשות קודמות" button + the /organizations request history. Only
    // overwrite an org rank the submission actually specifies (a CV-only re-upload
    // keeps the current preferences).
    setForm(f => ({
      ...f,
      cvUpdatedUrl: storageUrl,
      ...(pendingCv.org_pref_1 ? { firstChoiceOrg: pendingCv.org_pref_1 } : {}),
      ...(pendingCv.org_pref_2 ? { secondChoiceOrg: pendingCv.org_pref_2 } : {}),
      ...(pendingCv.org_pref_3 ? { thirdChoiceOrg: pendingCv.org_pref_3 } : {}),
    }));
    await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', pendingCv.id);
    setPendingCv(null);
    setCvApplied(true);
  }

  // Approve a candidate-suggested org: make it the student's 1st choice AND create it
  // as a private (restricted) approved employer so it's tracked for placement.
  async function approveSuggestion(suggested?: SuggestedOrg | null, cvRowId?: string) {
    const o = suggested || pendingCv?.suggested_org;
    if (!o?.name) return;
    const rowId = cvRowId || pendingCv?.id;
    const emp: Employer = {
      id: randomId('emp'),
      name: o.name,
      contactPerson: o.contactName || '',
      contactPhone: o.phone || '',
      contactEmail: o.email || '',
      location: o.location || '',
      notes: [o.contactRole ? `תפקיד איש הקשר: ${o.contactRole}` : '', o.notes || '', `(הצעת מועמד/ת: ${form.name || form.email || ''})`].filter(Boolean).join('\n'),
      approvalStatus: 'approved',
      restrictedToStudentId: form.id,
      addedBy: form.email || 'candidate',
      courseIds: form.courseId ? [form.courseId] : [],
      // A private org has one position for this candidate — gives the placement
      // build a slot to reserve when it becomes the first choice.
      positionsTotal: 1,
    } as Employer;
    // The parent persists employer + THIS student's firstChoiceOrg + dismisses the
    // suggestion in one save (mirrors the Employers-page approve). Previously we
    // only set firstChoiceOrg in local form state, which was never written unless
    // the coordinator separately hit Save — so "became first choice" was a lie.
    await onApproveSuggestion?.(emp, { studentId: form.id, firstChoiceOrgName: o.name, courseId: form.courseId, suggestionId: rowId });
    setForm(f => ({ ...f, firstChoiceOrg: o.name!, firstChoiceResult: 'pending' }));
    // Best-effort seen_at (RLS-blocked in prod today; dismissedSuggestionIds, set
    // by the parent, is the real hide mechanism the banners now honour).
    if (rowId) await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', rowId);
    setSuggestionDecided('approved');
    showToast(`✓ הצעת "${o.name}" אושרה — נקבעה כבחירה ראשונה`, 'success');
  }

  async function rejectSuggestion(cvRowId?: string) {
    const rowId = cvRowId || pendingCv?.id;
    if (rowId) await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', rowId);
    setSuggestionDecided('rejected');
  }

  function update<K extends keyof Student>(k: K, v: Student[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  // Org-assignment options: available orgs by default; incomplete ones appear
  // (marked) only when the bypass is on, or if already selected for this student.
  function gatedOrgOptions(selectedValue: string) {
    return employers
      .filter(e => {
        if (orgAvailability(e).available) return true;
        if (showAllOrgs) return true;
        return e.name === selectedValue || e.name === form.firstChoiceOrg || e.name === form.secondChoiceOrg || e.name === (form as any).thirdChoiceOrg;
      })
      .map(e => {
        const av = orgAvailability(e);
        return { value: e.name, label: av.available ? e.name : `${e.name} — ${av.badge || 'לא זמין'}` };
      });
  }

  // Change-check for a current preference slot vs the previous submission.
  function prefAt(row: CvRow | undefined, i: number): string {
    if (!row) return '';
    return (([row.org_pref_1, row.org_pref_2, row.org_pref_3][i] || '') as string).trim();
  }
  function updatePrep<K extends keyof NonNullable<Student['preparation']>>(k: K, v: any) {
    setForm(f => ({ ...f, preparation: { ...(f.preparation || {}), [k]: v } as any }));
  }

  // ── Stage-2 link (org-preference selection) — sendable from the student card ──
  function prefLink(): string {
    const base = `${window.location.origin}/cv-update/`;
    const p = new URLSearchParams();
    if ((form.email || '').trim()) p.set('email', form.email!.trim());
    if ((form.name || '').trim()) p.set('name', form.name!.trim());
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  }
  function prefLinkMessage(): string {
    return `שלום ${form.name || ''},\nלהמשך תהליך הפרקטיקום — נא להעלות קורות חיים מעודכנים ולבחור העדפות ארגון בקישור האישי:\n${prefLink()}`;
  }
  async function copyPrefLink() {
    try { await navigator.clipboard.writeText(prefLink()); showToast('✓ הקישור הועתק', 'success'); }
    catch { showToast(prefLink(), 'info'); }
  }
  function waPrefLink() {
    if (!(form.phone || '').trim()) { showToast('לא הוזן טלפון למועמד/ת', 'error'); return; }
    window.open(buildWhatsAppUrl(form.phone!, prefLinkMessage()), '_blank');
  }
  function mailPrefLink() {
    if (!(form.email || '').trim()) { showToast('לא הוזן מייל למועמד/ת', 'error'); return; }
    openMailto(buildMailtoUrl(form.email!, 'בחירת העדפות ארגון — פרקטיקום, אוניברסיטת אריאל', prefLinkMessage()));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { alert('שם הסטודנט/ית חסר'); return; }

    // Item 7: can't mark hired before org is set
    if (form.hired && !form.acceptedOrg) {
      alert('לא ניתן לסמן "נקלט/ה לעבודה" לפני שמוגדר ארגון מאכסן בפועל.\nהגדר/י ארגון בשדה "ארגון מאכסן בפועל" ושמור שוב.');
      return;
    }
    // Item 6: can't report hours before org is set
    if ((form.hoursReported || 0) > 0 && !form.acceptedOrg) {
      alert('לא ניתן לדווח שעות לפני שמוגדר ארגון מאכסן בפועל.');
      return;
    }
    // Item 6: can't complete practicum before org is set
    if (form.practicumCompleted && !form.acceptedOrg) {
      alert('לא ניתן לסיים פרקטיקום לפני שמוגדר ארגון מאכסן בפועל.');
      return;
    }
    // Item 8: can't complete practicum before 120 approved hours
    const minHours = 120;
    if (form.practicumCompleted && (form.hoursApproved || 0) < minHours) {
      alert(`לא ניתן לסיים פרקטיקום לפני מילוי מכסת ${minHours} שעות מאושרות.\nשעות מאושרות כרגע: ${form.hoursApproved || 0}`);
      return;
    }

    // Merge over the original student so placement fields the form doesn't track
    // (preferences, submissionStatus, vacancy data, …) are never clobbered on save.
    let saved: Student = { ...((student || {}) as Student), ...form };
    // Auto-stamp placedAt the first time acceptedOrg is recorded
    if (saved.acceptedOrg && !student?.acceptedOrg && !saved.placedAt) {
      saved = { ...saved, placedAt: new Date().toISOString().slice(0, 10) };
    }
    onSave(saved);
  }

  function openOutlookCompose() {
    if (!form.email) { alert('לא הוזן מייל'); return; }
    const subject = encodeURIComponent(`פרקטיקום — ${form.name}`);
    const body = encodeURIComponent(`שלום ${form.name},\n\n`);
    openMailto(`mailto:${encodeURIComponent(form.email)}?subject=${subject}&body=${body}`);
  }

  function openCall() {
    if (!form.phone) { alert('לא הוזן טלפון'); return; }
    // tel: opens the phone app on mobile / default dialer on desktop (Teams/FaceTime/etc)
    window.location.href = `tel:${form.phone.replace(/[^\d+]/g, '')}`;
  }

  function openWhatsApp() {
    if (!form.phone) { alert('לא הוזן טלפון'); return; }
    // normalize: IL numbers 05X → 9725X
    let n = form.phone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}`, '_blank');
  }

  /**
   * SYNCHRONOUS feedback URL when a verified token is already on the student —
   * returns it with zero awaiting so the caller can copy / open mail WITHIN the
   * click's user-gesture. (Browsers block clipboard writes and mailto popups if
   * they run after an async gap — the cause of "email doesn't respond / can't
   * copy" once token creation became an async DB round-trip.)
   */
  function readyFeedbackUrl(): string | null {
    return form.feedbackToken ? buildFeedbackUrl(form.feedbackToken) : null;
  }

  /**
   * Create + DB-verify a feedback token the FIRST time (student has none yet).
   * ensureFeedbackToken reads the cloud fresh, never regenerates an existing
   * token, and reads it back to confirm before returning. Because this awaits,
   * callers must NOT try to copy / open mail off its result in the same tick —
   * they reveal the link box and ask for a second click instead.
   * Returns the URL (also stored on the form + synced to the parent) or null.
   */
  async function createFeedbackUrl(): Promise<string | null> {
    const editorName = placementExtras?.userName || 'צוות הפרקטיקום';
    setCheckingFeedback(true);
    try {
      const res = await ensureFeedbackToken(form.id, editorName);
      if (!res.ok || !res.token || !res.url) {
        showToast('לא ניתן ליצור קישור משוב תקין — ' + (res.error || 'נסה/י שוב'), 'error');
        return null;
      }
      // Persist the confirmed token into the form + parent so every later click
      // is the synchronous (gesture-safe) path and no stale save can revert it.
      if (res.token !== form.feedbackToken) {
        const updated = { ...form, feedbackToken: res.token };
        setForm(updated);
        if (onAutoSave) await onAutoSave(updated);
      }
      return res.url;
    } finally {
      setCheckingFeedback(false);
    }
  }

  /**
   * Format a link for a plain-text (mailto) body so it can't break in transit:
   *  • U+200E (LRM) forces the URL to render left-to-right inside the RTL body,
   *    so the client can't reorder or clip the `?t=…` query.
   *  • The link sits alone on its own line, and a "copy this if it doesn't open"
   *    fallback repeats the raw URL — belt-and-suspenders across unknown clients.
   */
  function feedbackUrlBlock(u: string): string {
    const LRM = '\u200E';
    return `${LRM}${u}\n\nאם הקישור אינו נפתח בלחיצה — העתיקו את הכתובת הבאה והדביקו בדפדפן:\n${LRM}${u}`;
  }

  // Resolve the hosting employer from the student's free-text acceptedOrg. The
  // name can drift from the employer's exact name (e.g. "Icon Group" vs
  // "Icon Group/I digital"), which silently broke feedback sending. Match
  // exact → case-insensitive → prefix (either direction) so near-misses resolve.
  function resolveEmployerForOrg(orgName?: string) {
    if (!orgName) return undefined;
    const norm = (s?: string) => (s || '').trim().toLowerCase();
    const n = norm(orgName);
    return employers.find(e => e.name === orgName)
      || employers.find(e => norm(e.name) === n)
      || employers.find(e => { const en = norm(e.name); return !!en && (en.startsWith(n) || n.startsWith(en)); });
  }
  // Pull the first valid email out of a possibly-messy contact field (some
  // employers store "a@x.com/ b@y.com" or stray "mailto:" text).
  const firstEmail = (s?: string) => (s || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] || '';

  /**
   * First-ever feedback action on a student (no token yet): create + verify the
   * token, reveal the link in the box, and ask for a second click. We CANNOT
   * copy/open-mail here — createFeedbackUrl awaited, so the click's user-gesture
   * is spent and the browser would block the clipboard write / mailto popup. The
   * second click hits the synchronous (gesture-safe) path.
   */
  async function prepareLinkThenPrompt(againLabel: string) {
    const url = await createFeedbackUrl();
    if (!url) return;
    setShownFeedbackUrl(url);
    showToast(`✓ קישור המשוב מוכן והוצג למטה — לחצו שוב על "${againLabel}"`, 'success');
  }

  async function handleSendFeedbackEmail() {
    if (!form.acceptedOrg) { alert('לסטודנט/ית אין ארגון מאכסן מוגדר — מלא/י קודם את שדה "ארגון מאכסן בפועל".'); return; }
    const url = readyFeedbackUrl();
    if (!url) { await prepareLinkThenPrompt('שלח משוב למעסיק'); return; }
    setShownFeedbackUrl(url);
    const emp = resolveEmployerForOrg(form.acceptedOrg);
    const empEmail = firstEmail(emp?.contactEmail);
    const greeting = emp?.contactPerson ? `${emp.contactPerson} שלום,` : 'שלום,';
    const subject = encodeURIComponent(`בקשה למשוב — ${form.name}`);
    const body = encodeURIComponent(
      `${greeting}\n\n` +
      `בהמשך לפרקטיקום של ${form.name} בארגונכם, נשמח לקבל את משובכם.\n\n` +
      `למילוי טופס קצר (כ‑2 דקות) לחצו על הקישור:\n${feedbackUrlBlock(url)}\n\n` +
      `בתודה,\nצוות הפרקטיקום · אוניברסיטת אריאל`
    );
    if (!empEmail) {
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
      alert(emp
        ? `לא הוגדר מייל למעסיק "${emp.name}". הקישור הועתק — שלחו ידנית או הוסיפו מייל בדף המעסיקים (או נסו WhatsApp).`
        : `לא נמצא מעסיק בשם "${form.acceptedOrg}" ברשימת המעסיקים. ודאו שהשם תואם לרשומת המעסיק. הקישור הועתק.`);
      return;
    }
    // In-gesture (url came back synchronously) so the mail client actually opens.
    window.open(`mailto:${empEmail}?subject=${subject}&body=${body}`, '_blank');
  }

  async function handleSendFeedbackWhatsApp() {
    if (!form.acceptedOrg) { alert('לסטודנט/ית אין ארגון מאכסן מוגדר.'); return; }
    const url = readyFeedbackUrl();
    if (!url) { await prepareLinkThenPrompt('WhatsApp למעסיק'); return; }
    setShownFeedbackUrl(url);
    const emp = resolveEmployerForOrg(form.acceptedOrg);
    const empPhone = emp?.contactPhone || '';
    const msg = encodeURIComponent(
      `שלום,\nבהמשך לפרקטיקום של ${form.name} בארגונכם,\n` +
      `נשמח לקבל משוב קצר בקישור הבא:\n${url}`
    );
    if (!empPhone) {
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
      alert(emp
        ? `לא הוגדר טלפון למעסיק "${emp.name}". הקישור הועתק — שלחו ידנית או הוסיפו טלפון בדף המעסיקים (או נסו מייל).`
        : `לא נמצא מעסיק בשם "${form.acceptedOrg}" ברשימת המעסיקים. הקישור הועתק.`);
      return;
    }
    let n = empPhone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}?text=${msg}`, '_blank');
  }

  async function handleCopyFeedbackLink() {
    const url = readyFeedbackUrl();
    if (!url) {
      // First time: create the token, reveal the link box (the box itself is the
      // copy target); a second click copies within its own gesture.
      const created = await createFeedbackUrl();
      if (!created) return;
      setShownFeedbackUrl(created);
      showToast('✓ קישור המשוב מוכן והוצג למטה — לחצו "העתק"', 'success');
      return;
    }
    setShownFeedbackUrl(url);
    // In-gesture clipboard write (url is synchronous — no await before this).
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(url); copied = true; } catch {}
    }
    if (!copied) {
      // iOS/Safari fallback: temporary input, select, execCommand copy.
      const el = document.createElement('input');
      el.value = url;
      el.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(el);
      el.focus(); el.select();
      try { copied = document.execCommand('copy'); } catch {}
      document.body.removeChild(el);
    }
    showToast(copied ? '✓ קישור המשוב הועתק ללוח' : 'לא ניתן להעתיק — העתק ידנית מהתיבה למטה', copied ? 'success' : 'warn');
  }

  return (
    <>
    <Modal onClose={onClose} maxWidth="max-w-[820px]">
        <form onSubmit={handleSubmit} className="px-5 pb-7 md:px-10 md:pb-10">

          {/* ── Sticky cockpit header — name · one status pill · contact icons · ✕ ── */}
          <div className="sticky top-0 z-20 -mx-5 md:-mx-10 px-5 md:px-10 pt-6 pb-3 mb-3"
            style={{ background: 'var(--bg)', borderBottom: '1px solid var(--divider)' }}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="chapter-mark mb-1" style={{ fontSize: '10px' }}>{isNew ? 'סטודנט/ית חדש' : 'עריכת סטודנט/ית'}</div>
                <h2 className="serif text-[26px] md:text-[30px] leading-[1.1] tracking-tight truncate" style={{ color: 'var(--ink)' }}>
                  {form.name || (isNew ? 'הוסף שם' : '')}
                </h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!isNew && (() => { const st = cockpitStatus(form); return (
                  <span className="mono text-[10.5px] px-2.5 py-1 rounded-full font-semibold" style={{ background: 'var(--accent-soft)', color: st.tone }}>{st.label}</span>
                ); })()}
                {!isNew && (
                  <span className="inline-flex items-center gap-1">
                    <button type="button" onClick={openCall} disabled={!form.phone} title="התקשר" style={iconBtn(!!form.phone)}>📞</button>
                    <button type="button" onClick={openWhatsApp} disabled={!form.phone} title="WhatsApp" style={iconBtn(!!form.phone)}><WhatsAppIcon size={14} /></button>
                    <button type="button" onClick={openOutlookCompose} disabled={!form.email} title="מייל" style={iconBtn(!!form.email)}><MailIcon size={14} /></button>
                  </span>
                )}
                <button type="button" onClick={onClose} className="mono text-[11px] font-semibold opacity-60 hover:opacity-100 px-1" title="סגור">✕</button>
              </div>
            </div>
            {/* Passive stage stepper — current lit in maroon; tap = scroll is not wired (passive). */}
            {!isNew && (() => {
              const cur = cockpitStage(form);
              const curIdx = STAGE_ORDER.findIndex(s => s.key === cur);
              return (
                <div className="flex items-center gap-1 mt-2.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {STAGE_ORDER.map((s, i) => (
                    <span key={s.key} className="flex items-center gap-1 shrink-0">
                      <span className="text-[10.5px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
                        style={i === curIdx
                          ? { background: 'var(--accent)', color: '#fff', fontWeight: 700 }
                          : { color: i < curIdx ? 'var(--accent)' : 'var(--text-soft)', opacity: i < curIdx ? 0.9 : 0.6 }}>
                        {i < curIdx ? '✓ ' : ''}{s.label}
                      </span>
                      {i < STAGE_ORDER.length - 1 && <span className="text-[9px]" style={{ color: 'var(--divider)' }}>·</span>}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Next-action hint — one line, only when there's a clear next thing to do. */}
          {!isNew && (() => {
            const hint = pendingCv ? 'הגשה חדשה ממתינה — אמץ/י בקטע קורות חיים'
              : (!form.cvUpdatedUrl && form.preparation?.passed) ? 'שלח/י למועמד/ת קישור שלב 2 להעלאת קו״ח ובחירת ארגונים'
              : (form.cvUpdatedUrl && !form.acceptedOrg && ((form as any).preferences || []).every((p: any) => p.status === 'tentative') && ((form as any).preferences || form.firstChoiceOrg)) ? 'מוכן לשליחה — סמן/י ארגון ושלח/י קו״ח'
              : (form.acceptedOrg && (form.hoursApproved || 0) < 120 && !form.practicumCompleted) ? `שובץ/ה — מעקב שעות (${form.hoursApproved || 0}/120 מאושרות)`
              : '';
            if (!hint) return null;
            return (
              <div className="rounded-xl px-3.5 py-2.5 mb-4 text-[12.5px] font-semibold"
                style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', color: '#92400e' }}>
                → {hint}
              </div>
            );
          })()}

          <Accordion title="פרטים ועריכה" defaultOpen={isNew}
            hint={[courses.find(c => c.id === form.courseId)?.name, form.city, form.preparation?.passed ? 'עבר/ה הכנה' : ''].filter(Boolean).join(' · ') || undefined}>
            <SectionSub title="פרטים אישיים">
              <Field label="שם מלא"><Input value={form.name} onChange={v=>update('name',v)} required/></Field>
              <Field label="עיר מגורים"><Input value={form.city||''} onChange={v=>update('city',v)}/></Field>
              <Field label="טלפון"><Input type="tel" value={form.phone||''} onChange={v=>update('phone',v)}/></Field>
              <Field label="מייל"><Input type="email" value={form.email||''} onChange={v=>update('email',v)}/></Field>
            </SectionSub>

            <SectionSub title="הקשר — קורס ושנה">
              <Field label="קורס">
                <Select value={form.courseId||''}
                  onChange={v=>{ const c=courses.find(x=>x.id===v); setForm(f=>({ ...f, courseId: v, ...(c?.year ? { year: c.year } : {}) })); }}
                  options={courses.map(c=>({value:c.id,label:c.year?`${c.name} · ${c.year}`:c.name}))} placeholder="בחר קורס"/>
              </Field>
              <Field label="שנה אקדמית">
                <Select value={form.year||''} onChange={v=>update('year',v)} options={years.map(y=>({value:y,label:y}))} placeholder="בחר שנה"/>
              </Field>
            </SectionSub>

            <SectionSub title="הכנה לפרקטיקום">
              <Field label="עבר/ה הכנה">
                <Checkbox checked={!!form.preparation?.passed} onChange={v=>updatePrep('passed', v)} label="סומן שעבר/ה הכנה"/>
              </Field>
              <Field label="תאריך הכנה"><Input type="date" value={form.preparation?.date||''} onChange={v=>updatePrep('date', v)}/></Field>
            </SectionSub>
          </Accordion>

          {/* ── CV strip — ONE place for the CV: the current file (cvUpdatedUrl → cvUrl
              → red warn), open/copy, the pending-adopt banner, and a קו״ח-history toggle
              (the replaced original + every past submission's file). Absorbs the old
              green/red status box + the "CV מעודכן" section + the raw path field. ── */}
          <SectionSub title="קורות חיים">
            {(() => {
              const cur = (form as any).cvUpdatedUrl || (form as any).cvUrl || '';
              const usingUpdated = !!(form as any).cvUpdatedUrl;
              const copyCv = async () => {
                const u = resolveCvUrl(cur);
                if (!u) return;
                try { await navigator.clipboard.writeText(u); showToast('✓ קישור הקו״ח הועתק', 'success'); }
                catch { showToast(u, 'info'); }
              };
              return (
                <div className="col-span-full rounded-xl p-3"
                  style={cur
                    ? (usingUpdated
                      ? { background: 'rgba(5,150,105,0.12)', border: '1.5px solid rgba(5,150,105,0.5)' }
                      : { background: 'rgba(5,150,105,0.07)', border: '1px solid rgba(5,150,105,0.3)' })
                    : { background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.3)' }}>
                  {cur ? (
                    <>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-[12.5px] font-bold" style={{ color: '#065f46' }}>
                          ✓ קו"ח מעודכן — יישלח למעסיק
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button type="button" data-cv-open onClick={() => window.open(viewableCvUrl(cur), '_blank')} style={{ ...btnSmall(), padding: '5px 12px' }}>פתח ↗</button>
                          <button type="button" data-cv-copy onClick={copyCv} style={{ ...btnSmall(), padding: '5px 12px' }}>📋 העתק</button>
                        </div>
                      </div>
                      {usingUpdated && (form as any).cvUrl && (
                        <div className="text-[10.5px] mt-1" style={{ color: 'var(--text-soft)' }}>
                          קורות החיים הוחלפו בגרסה מעודכנת · הגרסאות הקודמות בהיסטוריה למטה.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mono text-[11px] font-semibold" style={{ color: '#b91c1c' }}>
                      ⚠ לא הועלה קו"ח — הדבק/י קישור קו״ח מעודכן למטה לפני שליחה למעסיק.
                    </div>
                  )}
                  {/* קו״ח history — the replaced original (line-through) + every past submission's file */}
                  {(((form as any).cvUpdatedUrl && (form as any).cvUrl) || cvHistory.some(r => r.cv_file_path)) && (
                    <div className="mt-2">
                      <button type="button" data-cv-history-toggle onClick={() => setShowCvHistory(s => !s)}
                        className="text-[11px] underline" style={{ color: 'var(--accent)' }}>
                        {showCvHistory ? 'הסתר היסטוריית קו״ח' : `היסטוריית קו״ח (${(usingUpdated && (form as any).cvUrl ? 1 : 0) + cvHistory.filter(r => r.cv_file_path).length})`}
                      </button>
                      {showCvHistory && (
                        <div className="mt-1.5 space-y-1 pt-1.5" style={{ borderTop: '1px dashed var(--divider)' }}>
                          {usingUpdated && (form as any).cvUrl && (
                            <div className="text-[12px] flex items-center gap-2" style={{ color: 'var(--text-soft)' }}>
                              <span style={{ textDecoration: 'line-through' }}>קו״ח מקורי (הוחלף)</span>
                              <button type="button" onClick={() => window.open(viewableCvUrl((form as any).cvUrl), '_blank')} className="text-[11px] underline" style={{ color: 'var(--accent)' }}>פתח ↗</button>
                            </div>
                          )}
                          {cvHistory.filter(r => r.cv_file_path).map(r => (
                            <div key={r.id} className="text-[12px] flex items-center gap-2" style={{ color: 'var(--text-soft)' }}>
                              <span>{(() => { try { return new Date(r.uploaded_at).toLocaleDateString('he-IL'); } catch { return ''; } })()}</span>
                              <span className="mono text-[10.5px]">{(r.cv_file_path || '').split('/').pop()}</span>
                              <button type="button" onClick={() => window.open(viewableCvUrl(`storage://candidate-uploads/${r.cv_file_path}`), '_blank')} className="text-[11px] underline" style={{ color: 'var(--accent)' }}>קו״ח ↗</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {pendingCv && (
              <div className="col-span-full flex items-center justify-between gap-3 p-3 rounded-xl"
                style={{ background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.35)' }}>
                <div>
                  <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: '#b45309' }}>
                    {(form as any).cvUpdatedUrl
                      ? `✦ הגשה חדשה יותר ממתינה — הועלתה ${new Date(pendingCv.uploaded_at).toLocaleDateString('he-IL')}`
                      : `✦ CV מעודכן ממתין — הועלה ${new Date(pendingCv.uploaded_at).toLocaleDateString('he-IL')}`}
                  </div>
                  <div className="text-[12px] mt-0.5" style={{ color: '#92400e' }}>
                    {pendingCv.cv_file_path.split('/').pop()}
                  </div>
                  {(form as any).cvUpdatedUrl && (
                    <div className="text-[12px] mt-1 font-bold" style={{ color: '#b45309' }}>
                      ⚠ המועמד/ת עדכן/ה קו״ח לאחר ההגשה הקודמת. "החל/י" יחליף את הקו״ח הנוכחי בגרסה זו.
                    </div>
                  )}
                  {(pendingCv.org_pref_1 || pendingCv.org_pref_2 || pendingCv.org_pref_3) && (
                    <div className="text-[12px] mt-1 font-semibold" style={{ color: '#92400e' }}>
                      ✦ העדפות ארגון: {[pendingCv.org_pref_1, pendingCv.org_pref_2, pendingCv.org_pref_3].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button type="button" onClick={() => {
                    const { data } = supabase.storage.from('candidate-uploads').getPublicUrl(pendingCv.cv_file_path);
                    const url = data.publicUrl;
                    const isWord = /\.(docx?|doc)$/i.test(url.split('?')[0]);
                    window.open(isWord ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}` : url, '_blank');
                  }} style={{
                    display: 'inline-block', padding: '7px 14px', fontSize: '12px', fontWeight: 600,
                    background: 'transparent', color: '#b45309', border: '1px solid #b45309',
                    borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>פתח ↗</button>
                  <button type="button" onClick={applyPendingCv} style={{
                    display: 'inline-block', padding: '7px 14px', fontSize: '12px', fontWeight: 600,
                    background: '#b45309', color: 'white', border: 'none',
                    borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>{(pendingCv.org_pref_1 || pendingCv.org_pref_2 || pendingCv.org_pref_3)
                    ? '✓ אמץ הגשה (קו״ח + העדפות)'
                    : '✓ אמץ כ‑CV מעודכן'}</button>
                </div>
              </div>
            )}
            {cvApplied && (
              <div className="col-span-full mono text-[11px] uppercase tracking-[0.14em] font-semibold py-1"
                style={{ color: '#15803d' }}>
                ✓ CV מעודכן נוסף — לחץ שמור כדי לשמור
              </div>
            )}

            {/* Candidate-suggested organization — private, requires approval, becomes 1st choice */}
            {pendingCv?.suggested_org?.name && !suggestionDecided && (
              <div className="col-span-full rounded-xl p-4" style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid rgba(122,30,43,0.4)' }}>
                <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold mb-2" style={{ color: 'var(--accent)' }}>
                  ⚠ הצעת ארגון מהמועמד/ת — דרוש אישור
                </div>
                <div className="text-[13px] leading-[1.7]" style={{ color: 'var(--ink)' }}>
                  <div><strong>{pendingCv.suggested_org.name}</strong>{pendingCv.suggested_org.location ? ` · ${pendingCv.suggested_org.location}` : ''}</div>
                  <div>איש/אשת קשר: {pendingCv.suggested_org.contactName || '—'}{pendingCv.suggested_org.contactRole ? ` (${pendingCv.suggested_org.contactRole})` : ''}</div>
                  <div dir="ltr" style={{ textAlign: 'right' }}>{[pendingCv.suggested_org.email, pendingCv.suggested_org.phone].filter(Boolean).join(' · ')}</div>
                  {pendingCv.suggested_org.notes && <div className="mt-1" style={{ opacity: 0.8, whiteSpace: 'pre-wrap' }}>{pendingCv.suggested_org.notes}</div>}
                </div>
                <div className="flex gap-2 mt-3">
                  <button type="button" onClick={() => approveSuggestion(pendingCv?.suggested_org, pendingCv?.id)} style={{
                    padding: '7px 14px', fontSize: '12px', fontWeight: 600,
                    background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer',
                  }}>✓ אשר — צור ארגון פרטי וקבע כבחירה ראשונה</button>
                  <button type="button" onClick={() => rejectSuggestion(pendingCv?.id)} style={{
                    padding: '7px 14px', fontSize: '12px', fontWeight: 600,
                    background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '999px', cursor: 'pointer',
                  }}>דחה</button>
                </div>
              </div>
            )}
            {suggestionDecided === 'approved' && (
              <div className="col-span-full mono text-[11px] uppercase tracking-[0.14em] font-semibold py-1" style={{ color: '#15803d' }}>
                ✓ הצעת הארגון אושרה — נקבעה כבחירה ראשונה · לחץ שמור כדי לשמור
              </div>
            )}
            {suggestionDecided === 'rejected' && (
              <div className="col-span-full mono text-[11px] uppercase tracking-[0.14em] font-semibold py-1" style={{ color: 'var(--text-soft)' }}>
                הצעת הארגון נדחתה
              </div>
            )}

          </SectionSub>

          <SectionSub title="בחירת ארגון ושליחה">
            {/* Latest submission's suggested org — approve to create it as a private,
                ranked employer (then it appears as an OrgHub card). Once approved or
                rejected it drops (it's a card / dismissed). The pending-CV banner above
                covers the freshest one; this catches an already-adopted submission whose
                banner is gone. */}
            {(() => {
              const latest = cvHistory[0];
              const sg = latest?.suggested_org;
              if (!sg?.name) return null;
              const approved = suggestionDecided === 'approved'
                || employers.some(e => (e as any).restrictedToStudentId === form.id && (e.name || '').trim() === (sg.name || '').trim());
              if (approved || suggestionDecided === 'rejected') return null;
              return (
                <div className="col-span-full rounded-lg p-2.5" style={{ background: 'rgba(122,30,43,0.05)', border: '1px dashed var(--accent)' }}>
                  <div className="text-[12px]" style={{ color: 'var(--ink)' }}>
                    🔆 הצעת ארגון מהמועמד/ת: <strong>{sg.name}</strong>
                    {sg.contactName ? <span style={{ color: 'var(--text-soft)' }}> · {sg.contactName}{sg.contactRole ? ` (${sg.contactRole})` : ''}</span> : null}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={() => approveSuggestion(sg, latest.id)}
                      style={{ padding: '5px 12px', fontSize: '11.5px', fontWeight: 600, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer' }}>
                      ✓ אשר כבחירה ראשונה
                    </button>
                    <button type="button" onClick={() => rejectSuggestion(latest.id)}
                      style={{ padding: '5px 12px', fontSize: '11.5px', fontWeight: 600, background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '999px', cursor: 'pointer' }}>
                      דחה
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Org world. Practicum → the unified OrgHub (ranked cards, re-rank,
                per-org interview result, checkbox-select → WhatsApp/Outlook send).
                Non-practicum → the simple choice fields (no placement workflow). */}
            {!isNew && placementExtras && (courses.find(c => c.id === form.courseId) as any)?.type === 'practicum' ? (
              <div className="col-span-full">
                <OrgHub
                  form={form}
                  employers={employers}
                  courses={courses}
                  extras={{
                    allStudents: placementExtras.allStudents,
                    dispatches: placementExtras.dispatches,
                    placementSettings: placementExtras.placementSettings as PlacementSettings,
                    userName: placementExtras.userName,
                    onDataChange: async (patch) => {
                      await placementExtras.onDataChange(patch);
                      // Keep the editor's form in step with OrgHub's persisted mutations
                      // (send → under_review, נקלט/נדחה, release) — incl. the compat
                      // legacy fields, so the coordinator-edit log + re-open stay correct.
                      const me = (patch.students || []).find(s => s.id === form.id) as Student | undefined;
                      if (me) setForm(f => ({
                        ...f,
                        preferences: me.preferences || [], submissionStatus: me.submissionStatus ?? f.submissionStatus,
                        acceptedOrg: me.acceptedOrg ?? f.acceptedOrg,
                        // Sync placedAt too — a placement done via OrgHub stamps it; without this
                        // a later שמור would re-stamp it to the save date (wrong placement date).
                        placedAt: (me as any).placedAt ?? f.placedAt,
                        firstChoiceOrg: (me as any).firstChoiceOrg ?? f.firstChoiceOrg, firstChoiceResult: (me as any).firstChoiceResult ?? f.firstChoiceResult,
                        secondChoiceOrg: (me as any).secondChoiceOrg ?? f.secondChoiceOrg, secondChoiceResult: (me as any).secondChoiceResult ?? f.secondChoiceResult,
                        thirdChoiceOrg: (me as any).thirdChoiceOrg ?? f.thirdChoiceOrg, thirdChoiceResult: (me as any).thirdChoiceResult ?? f.thirdChoiceResult,
                      }));
                    },
                  }}
                  showAllOrgs={showAllOrgs}
                  setShowAllOrgs={setShowAllOrgs}
                  onFormChange={(patch) => setForm(f => ({ ...f, ...patch }))}
                  submittedCaption={cvHistory[0] ? `הוגש ע״י המועמד/ת · ${new Date(cvHistory[0].uploaded_at).toLocaleDateString('he-IL')}` : null}
                />
              </div>
            ) : (
              <>
                <div className="col-span-full flex items-center justify-end">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-[12px]" style={{ color: showAllOrgs ? 'var(--accent)' : 'var(--text-soft)' }}>
                    <input type="checkbox" checked={showAllOrgs} onChange={e=>setShowAllOrgs(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                    ⚠ הצג גם ארגונים שאינם זמינים
                  </label>
                </div>
                <Field label="בחירה ראשונה — ארגון">
                  <Select value={form.firstChoiceOrg||''} onChange={v=>update('firstChoiceOrg',v)}
                    options={gatedOrgOptions(form.firstChoiceOrg||'')} placeholder="בחר ארגון" freeText/>
                </Field>
                <Field label="תוצאת ראיון — בחירה ראשונה">
                  <Select value={form.firstChoiceResult||'pending'} onChange={v=>update('firstChoiceResult', v as any)}
                    options={[{ value: 'pending', label: 'טרם רואיין' }, { value: 'passed', label: 'עבר' }, { value: 'failed', label: 'לא עבר' }]}/>
                </Field>
                <Field label="בחירה שנייה — ארגון">
                  <Select value={form.secondChoiceOrg||''} onChange={v=>update('secondChoiceOrg',v)}
                    options={gatedOrgOptions(form.secondChoiceOrg||'')} placeholder="בחר ארגון שני" freeText/>
                </Field>
                <Field label="תוצאת ראיון — בחירה שנייה">
                  <Select value={form.secondChoiceResult||'pending'} onChange={v=>update('secondChoiceResult', v as any)}
                    options={[{ value: 'pending', label: 'טרם רואיין' }, { value: 'passed', label: 'עבר' }, { value: 'failed', label: 'לא עבר' }]}/>
                </Field>
                <Field label="בחירה שלישית — ארגון">
                  <Select value={form.thirdChoiceOrg||''} onChange={v=>update('thirdChoiceOrg',v)}
                    options={gatedOrgOptions(form.thirdChoiceOrg||'')} placeholder="בחר ארגון שלישי" freeText/>
                </Field>
                <Field label="תוצאת ראיון — בחירה שלישית">
                  <Select value={form.thirdChoiceResult||'pending'} onChange={v=>update('thirdChoiceResult', v as any)}
                    options={[{ value: 'pending', label: 'טרם רואיין' }, { value: 'passed', label: 'עבר' }, { value: 'failed', label: 'לא עבר' }]}/>
                </Field>
              </>
            )}

            {/* Ask the STUDENT to update — sits UNDER the ranked list, clearly a
                different action from the per-org employer send above (which is the
                checkbox→WhatsApp/Outlook on each card). Sends the student their /cv-update
                link to re-upload a CV / re-pick orgs. */}
            {!isNew && (
              <div className="col-span-full rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap"
                style={{ background: 'rgba(122,30,43,0.03)', border: '1px dashed var(--divider)' }}>
                <span className="text-[11.5px]" style={{ color: 'var(--text-soft)' }}>📨 בקש/י מהמועמד/ת לעדכן קו״ח / לבחור ארגונים (קישור אישי):</span>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={copyPrefLink} style={{ ...btnSmall(), padding: '5px 12px', whiteSpace: 'nowrap' }}>📋 העתק קישור</button>
                  <button type="button" onClick={waPrefLink} disabled={!(form.phone || '').trim()} style={{ ...dispatchChip(!!(form.phone || '').trim()), padding: '5px 12px' }}><WhatsAppIcon /> WhatsApp</button>
                  <button type="button" onClick={mailPrefLink} disabled={!(form.email || '').trim()} style={{ ...dispatchChip(!!(form.email || '').trim()), padding: '5px 12px', color: (form.email || '').trim() ? 'var(--accent)' : 'var(--text-soft)' }}><MailIcon /> מייל</button>
                </div>
              </div>
            )}

            {/* Previous submissions (coordinator view) — Phase 3 folds this into the
                History accordion; kept here so nothing is lost in the interim. */}
            {cvHistory.length > 1 && (
              <div className="col-span-full p-3 rounded-lg" style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid var(--divider)' }}>
                <button type="button" onClick={() => setShowHistory(s => !s)} className="text-[11px] underline" style={{ color: 'var(--accent)' }}>
                  {showHistory ? 'הסתר היסטוריית הגשות' : `היסטוריית הגשות קודמות (${cvHistory.length - 1})`}
                </button>
                {showHistory && (
                  <div className="mt-2 space-y-1.5 pt-2" style={{ borderTop: '1px dashed var(--divider)' }}>
                    {cvHistory.slice(1).map(row => {
                      const ps = [0, 1, 2].map(i => prefAt(row, i)).filter(Boolean);
                      const fmt = (s: string) => { try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; } };
                      return (
                        <div key={row.id} className="text-[12px] flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-soft)' }}>
                          <span className="font-semibold">{fmt(row.uploaded_at)}</span>{' · '}
                          <span>{ps.length ? ps.map((p, idx) => `${idx + 1}. ${p}`).join('   ') : '—'}</span>
                          {row.suggested_org?.name ? <span>{`· הצעה: ${row.suggested_org.name}`}</span> : null}
                          {row.cv_file_path && (
                            <button type="button" onClick={() => window.open(viewableCvUrl(`storage://candidate-uploads/${row.cv_file_path}`), '_blank')}
                              className="text-[11px] underline" style={{ color: 'var(--accent)' }}>קו״ח ↗</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </SectionSub>

          <Accordion title="ראיון שיבוץ (רחל)"
            hint={form.feedbackSubmittedAt ? '✓ מעסיק מילא משוב' : (form.placementInterviewDate ? `ראיון ${form.placementInterviewDate}` : undefined)}>
            <Field label="תאריך ראיון שיבוץ"><Input type="date" value={form.placementInterviewDate||''} onChange={v=>update('placementInterviewDate',v)}/></Field>
            <Field label="שעת ראיון שיבוץ"><Input type="time" value={form.placementInterviewTime||''} onChange={v=>update('placementInterviewTime',v)}/></Field>
            <div className="col-span-full">
              <Field label="ארגון לראיון שיבוץ">
                <Select value={form.placementInterviewOrg||''} onChange={v=>update('placementInterviewOrg',v)}
                  options={employers.map(e=>({value:e.name,label:e.name}))}
                  placeholder="בחר ארגון"
                  freeText/>
              </Field>
            </div>
            {form.feedbackSubmittedAt ? (
              <div className="col-span-full p-3 rounded-lg flex flex-wrap items-center justify-between gap-2"
                style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid rgba(122,30,43,0.2)' }}>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>
                  ✓ המעסיק מילא משוב · {new Date(form.feedbackSubmittedAt).toLocaleDateString('he-IL')}
                </span>
                <button type="button"
                  onClick={async () => {
                    if (!confirm('לאפס את המשוב? קישור חדש ייוצר בלחיצה הבאה על "שלח משוב".')) return;
                    const updated = { ...form, feedbackSubmittedAt: '', feedbackText: '', feedbackToken: '' };
                    setForm(updated);
                    if (onAutoSave) { await onAutoSave(updated); setShownFeedbackUrl(''); }
                  }}
                  className="mono text-[10px] uppercase tracking-[0.13em] font-semibold px-2.5 py-1 rounded-full border shrink-0"
                  style={{ color: 'var(--accent)', borderColor: 'var(--accent)', background: 'transparent', cursor: 'pointer' }}>
                  ↺ אפס
                </button>
              </div>
            ) : (
              <div className="col-span-full flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const orgName = form.placementInterviewOrg || form.acceptedOrg;
                    if (!orgName) { alert('לא הוגדר ארגון לראיון שיבוץ'); return; }
                    const emp = employers.find(e => e.name === orgName);
                    if (!emp?.contactPhone) {
                      alert(`לא נמצא טלפון לארגון "${orgName}" — הוסף טלפון בדף המעסיקים`);
                      return;
                    }
                    let n = emp.contactPhone.replace(/[^\d]/g, '');
                    if (n.startsWith('0')) n = '972' + n.slice(1);
                    window.open(`https://wa.me/${n}`, '_blank');
                  }}
                  title="פתח WhatsApp עם ארגון הראיון לבקשת משוב"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <span className="text-[12px]" style={{ color: 'var(--text-soft)', textDecoration: 'underline dotted' }}>💬 ממתין למשוב מהמעסיק</span>
                </button>
                <button type="button" onClick={checkFeedbackStatus} disabled={checkingFeedback}
                  className="mono text-[10px] uppercase tracking-[0.13em] font-semibold px-2.5 py-1 rounded-full border"
                  style={{ color: 'var(--text-soft)', borderColor: 'var(--divider)', background: 'transparent', cursor: 'pointer', opacity: checkingFeedback ? 0.5 : 1 }}>
                  {checkingFeedback ? '...' : '↻ בדוק'}
                </button>
              </div>
            )}
          </Accordion>

          <Accordion title="השמה סופית ושעות" defaultOpen={!!form.acceptedOrg}
            hint={form.acceptedOrg ? `${form.acceptedOrg} · ${form.hoursApproved || 0}/120 ש׳` : undefined}>
            <Field label="ארגון מאכסן בפועל">
              <Select value={form.acceptedOrg||''} onChange={v=>update('acceptedOrg',v)}
                options={[...employers.map(e=>({value:e.name,label:e.name}))]}
                placeholder="לא שובץ עדיין"
                freeText/>
            </Field>
            <Field label="נקלט/ה לעבודה לאחר הפרקטיקום">
              <Checkbox checked={!!form.hired} onChange={v=>update('hired',v)} label="סומן כנקלט/ה"/>
            </Field>
            <Field label="שעות מדווחות"><Input type="number" value={String(form.hoursReported||0)} onChange={v=>update('hoursReported', Number(v)||0)}/></Field>
            <Field label="שעות מאושרות"><Input type="number" value={String(form.hoursApproved||0)} onChange={v=>update('hoursApproved', Number(v)||0)}/></Field>
            <Field label="סיים/סיימה פרקטיקום">
              <Checkbox checked={!!form.practicumCompleted} onChange={v=>update('practicumCompleted',v)} label="מילא/ה חובות שעות וסיים/סיימה פרקטיקום"/>
            </Field>
          </Accordion>

          <Accordion title="מסמכים וחוו״ד מעסיק"
            hint={form.feedbackText ? '✓ יש חוות דעת מעסיק' : (form.questionnaire ? 'שאלון מועמדות' : undefined)}>
            <FileField label="קו״ח מקורי" value={form.cvUrl||''} onChange={v=>update('cvUrl',v)}/>
            {/* Editable path for the current/updated CV — the CV strip above shows + sends it;
                this raw-path field lives here so the strip stays a clean single display. */}
            <FileField label="קו״ח מעודכן (קישור לעריכה)" value={form.cvUpdatedUrl||''} onChange={v=>update('cvUpdatedUrl',v)}/>
            <FileField label="טופס הגשת מועמדות" value={form.formUrl||''} onChange={v=>update('formUrl',v)}/>
            {form.questionnaire && (
              <div className="col-span-full">
                <QuestionnaireView q={form.questionnaire} candidateName={form.name} />
              </div>
            )}
            <div className="col-span-full">
              <div className="col-span-full">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="small-caps" style={{ letterSpacing: '0.12em' }}>חוות דעת מהארגון</span>
                  {form.feedbackText && (
                    <button type="button" onClick={() => openFeedbackView()} style={{
                      display: 'inline-block', padding: '4px 12px', fontSize: '12px', fontWeight: 600,
                      background: 'var(--accent)', color: 'white', border: 'none',
                      borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
                    }}>👁 צפה במשוב</button>
                  )}
                </div>
                {form.feedbackText ? (() => {
                  let d: any = null;
                  try { const p = JSON.parse(form.feedbackText); if (p.v === 2) d = p; } catch {}
                  return (
                    <div className="rounded-xl p-4" style={{ background: 'rgba(122,30,43,0.04)', border: '1px solid rgba(122,30,43,0.18)' }}>
                      {d ? (
                        <div className="space-y-1.5 text-[13px]" style={{ color: 'var(--ink)' }}>
                          {d.mentor && <div><span style={{ color: 'var(--text-soft)', fontSize: '11px' }}>מנחה: </span>{d.mentor}{d.mentorRole ? ` · ${d.mentorRole}` : ''}</div>}
                          {d.overallScore && <div><span style={{ color: 'var(--text-soft)', fontSize: '11px' }}>ציון: </span><strong style={{ color: 'var(--accent)' }}>{d.overallScore}/100</strong>{d.recommendation ? ` · ${d.recommendation}` : ''}</div>}
                          {d.strengths && <div><span style={{ color: 'var(--text-soft)', fontSize: '11px' }}>חוזקות: </span>{d.strengths}</div>}
                          {d.improvements && <div><span style={{ color: 'var(--text-soft)', fontSize: '11px' }}>שיפור: </span>{d.improvements}</div>}
                          <div className="mono text-[10px] uppercase tracking-[0.13em] pt-1" style={{ color: 'var(--text-soft)' }}>
                            לחץ "צפה במשוב" לתצוגה מלאה
                          </div>
                        </div>
                      ) : (
                        <pre className="text-[13px] leading-[1.7] whitespace-pre-wrap font-sans" style={{ color: 'var(--ink)' }}>{form.feedbackText}</pre>
                      )}
                    </div>
                  );
                })() : (
                  <Textarea rows={3} value={''} onChange={v=>update('feedbackText',v)}/>
                )}
              </div>
            </div>
            <div className="col-span-full text-[12px]" style={{ color: 'var(--text-soft)' }}>
              💡 הדבק קישור מ‑OneDrive או SharePoint. לחיצה על "פתח" תפתח את הקובץ בחלון חדש.
            </div>
          </Accordion>

          <Accordion title="הערות" hint={form.notes ? form.notes.slice(0, 40) : undefined}>
            <div className="col-span-full"><Field label="הערות פנימיות"><Textarea rows={3} value={form.notes||''} onChange={v=>update('notes',v)}/></Field></div>
          </Accordion>

          <div className="flex flex-wrap gap-3 pt-6 mt-6 border-t sticky bottom-0 -mx-5 md:-mx-10 px-5 md:px-10 pb-2"
            style={{ borderColor: 'var(--divider)', background: 'var(--bg)', zIndex: 15 }}>
            <button type="submit" style={{
              display: 'inline-block', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
              background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>{isNew ? 'צור' : 'שמור'} →</button>
            {/* Student-contact actions (📞/WhatsApp/מייל) live in the sticky header now. */}
            {!isNew && (
              <button type="button" onClick={() => setShowEval(true)} style={btnSecondary()}>🖨 טופס הערכה</button>
            )}
            {!isNew && !form.feedbackSubmittedAt && (
              <button type="button" onClick={handleSendFeedbackEmail} disabled={checkingFeedback}
                title="שלח למעסיק קישור למילוי משוב — פותח Outlook" style={{
                display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
                background: 'var(--accent)', color: 'white', border: 'none',
                borderRadius: '999px', cursor: checkingFeedback ? 'wait' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                opacity: checkingFeedback ? 0.6 : 1,
              }}>{checkingFeedback ? '⏳ מכין קישור…' : '📧 שלח משוב למעסיק'}</button>
            )}
            {!isNew && !form.feedbackSubmittedAt && (
              <button type="button" onClick={handleSendFeedbackWhatsApp} disabled={checkingFeedback}
                title="שלח קישור משוב ב‑WhatsApp" style={{
                display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
                background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)',
                borderRadius: '999px', cursor: checkingFeedback ? 'wait' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                opacity: checkingFeedback ? 0.6 : 1,
              }}>💬 WhatsApp למעסיק</button>
            )}
            {!isNew && (
              <button type="button" onClick={handleCopyFeedbackLink} disabled={checkingFeedback}
                title="העתק קישור משוב ללוח" style={{
                display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
                background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)',
                borderRadius: '999px', cursor: checkingFeedback ? 'wait' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                opacity: checkingFeedback ? 0.6 : 1,
              }}>🔗 העתק קישור</button>
            )}
            {!isNew && onDelete && (
              <button type="button"
                onClick={() => { if (confirm('למחוק סטודנט/ית זה/ו?')) onDelete(form.id); }}
                className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold mr-auto hover:opacity-70"
                style={{ color: 'var(--accent)', flexShrink: 0 }}>🗑 מחק</button>
            )}
            <button type="button" onClick={onClose}
              className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100"
              style={{ flexShrink: 0 }}>בטל</button>
          </div>

          {/* Always-visible feedback link — the guaranteed fallback if the
              clipboard copy fails (the copy toast points here). Rendered LTR so
              the URL is readable/selectable and can be hand-copied intact. */}
          {shownFeedbackUrl && (
            <div style={{ marginTop: '14px', padding: '12px 14px', borderRadius: '10px', background: 'rgba(122,30,43,0.05)', border: '1px solid var(--divider)' }}>
              <div className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold mb-2" style={{ color: 'var(--text-soft)' }}>
                קישור המשוב למעסיק · אם ההעתקה נכשלה — סמנ/י והעתק/י מכאן
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  readOnly
                  dir="ltr"
                  value={shownFeedbackUrl}
                  data-feedback-url
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ flex: 1, fontSize: '12.5px', fontFamily: 'monospace', padding: '8px 10px', borderRadius: '7px', border: '1px solid var(--divider)', background: '#fff', color: 'var(--ink)', direction: 'ltr', textAlign: 'left' }}
                />
                <button type="button" onClick={handleCopyFeedbackLink} disabled={checkingFeedback}
                  className="mono text-[11px] font-semibold" style={{ padding: '8px 12px', borderRadius: '7px', border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: checkingFeedback ? 'wait' : 'pointer', flexShrink: 0 }}>העתק</button>
              </div>
            </div>
          )}

        </form>

    </Modal>

    {/* Render EvaluationForm OUTSIDE the Modal so its position:fixed overlay
        is not nested inside another fixed element (Safari stacking context bug) */}
    {showEval && (
      <EvaluationForm
        student={form}
        courses={courses}
        employers={employers}
        onClose={() => setShowEval(false)}
      />
    )}

</>
  );
}

function SectionSub({ title, children }: { title: string; children: any }) {
  return (
    <div className="mb-7">
      <div className="chapter-mark mb-4" style={{ fontSize: '11px' }}>{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">{children}</div>
    </div>
  );
}

/**
 * Accordion — a collapsible section with a title, a live one-line hint (so the
 * coordinator sees what's inside without opening it), and a chevron. Subtle maroon.
 * Body is grid-laid like SectionSub. Used to fold the editor's secondary sections so
 * the two working surfaces (CV strip + org hub) stay the focus.
 */
function Accordion({ title, hint, defaultOpen, plain, children }: { title: string; hint?: string; defaultOpen?: boolean; plain?: boolean; children: any }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="mb-3 rounded-xl overflow-hidden" style={{ border: '1px solid var(--divider)' }}>
      <button type="button" data-accordion={title} aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-right"
        style={{ background: open ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer' }}>
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="chapter-mark" style={{ fontSize: '11px', color: 'var(--accent)' }}>{title}</span>
          {hint ? <span className="text-[11.5px] truncate" style={{ color: 'var(--text-soft)' }}>· {hint}</span> : null}
        </span>
        <span className="shrink-0 text-[12px]" style={{ color: 'var(--accent)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
      </button>
      {open && (plain
        ? <div className="px-4 pb-1 pt-2">{children}</div>
        : <div className="px-4 pb-4 pt-1"><div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">{children}</div></div>
      )}
    </div>
  );
}

// ── Cockpit derivations — a single status pill, the passive stepper, and the one
// next-action hint. Pure functions of the form so the header/footer stay in sync.
type StageKey = 'prep' | 'cv' | 'send' | 'interview' | 'placed' | 'hours';
function cockpitStatus(f: Student): { label: string; tone: string } {
  const prefs = (f as any).preferences as any[] | undefined;
  const anyUnderReview = (prefs || []).some(p => p.status === 'under_review');
  if (f.practicumCompleted) return { label: 'סיים/ה פרקטיקום', tone: '#059669' };
  if (f.acceptedOrg || (f as any).submissionStatus === 'placed') return { label: 'שובץ/ה', tone: '#059669' };
  if (anyUnderReview) return { label: 'קו״ח נשלח — בבדיקה', tone: '#b45309' };
  if (f.cvUpdatedUrl) return { label: 'מוכן לשליחה', tone: 'var(--accent)' };
  if (f.preparation?.passed) return { label: 'עבר/ה הכנה', tone: 'var(--accent)' };
  return { label: 'פעיל/ה', tone: 'var(--text-soft)' };
}
function cockpitStage(f: Student): StageKey {
  const prefs = (f as any).preferences as any[] | undefined;
  if ((f.hoursApproved || 0) > 0 || f.practicumCompleted) return 'hours';
  if (f.acceptedOrg || (f as any).submissionStatus === 'placed') return 'placed';
  if (f.placementInterviewDate || (prefs || []).some(p => p.status === 'under_review')) return 'interview';
  if (f.firstChoiceOrg || (prefs || []).length) return 'send';
  if (f.cvUpdatedUrl) return 'cv';
  return 'prep';
}
const STAGE_ORDER: { key: StageKey; label: string }[] = [
  { key: 'prep', label: 'הכנה' }, { key: 'cv', label: 'קו״ח' }, { key: 'send', label: 'העדפות ושליחה' },
  { key: 'interview', label: 'ראיון' }, { key: 'placed', label: 'שובץ' }, { key: 'hours', label: 'שעות' },
];
function iconBtn(enabled: boolean): React.CSSProperties {
  return {
    display: 'inline-grid', placeItems: 'center', width: 30, height: 30, borderRadius: '999px',
    border: '1px solid var(--divider)', background: 'transparent', color: 'var(--accent)',
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.35, fontSize: '13px',
  };
}

function FileField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const isHttpUrl = /^https?:\/\//i.test(value);
  const storageMatch = value.match(/^storage:\/\/([^/]+)\/(.+)$/);
  // Plain path (no prefix) — legacy records saved before the storage:// convention
  const isPlainPath = !isHttpUrl && !storageMatch && /\.(pdf|docx?|doc)$/i.test(value) && value.includes('/');
  const canOpen = isHttpUrl || !!storageMatch || isPlainPath;

  function openFileUrl(rawUrl: string) {
    const isWord = /\.(docx?|doc)$/i.test(rawUrl.split('?')[0]);
    if (isWord) {
      // Microsoft Office Online viewer — displays Word files in-browser without download
      window.open(`https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(rawUrl)}`, '_blank');
    } else {
      window.open(rawUrl, '_blank');
    }
  }

  function openFile() {
    if (isHttpUrl) { openFileUrl(value); return; }
    const bucket = storageMatch ? storageMatch[1] : 'candidate-uploads';
    const path = storageMatch ? storageMatch[2] : value;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    openFileUrl(data.publicUrl);
  }

  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || ''}
          className="input flex-1"
          style={{ padding: '12px 16px', fontSize: '13.5px', fontFamily: isHttpUrl ? 'ui-monospace, monospace' : undefined }}
        />
        {canOpen && (
          <button type="button" onClick={openFile}
            className="mono text-[11px] uppercase tracking-[0.14em] font-semibold px-4 rounded-lg shrink-0"
            style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
            פתח ↗
          </button>
        )}
      </div>
    </label>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      {children}
    </label>
  );
}

function Input({
  value, onChange, type = 'text', placeholder, required,
}: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="input"
      style={{ padding: '12px 16px', fontSize: '14.5px' }}
    />
  );
}

function Textarea({
  value, onChange, rows = 3,
}: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} className="input"
      style={{ padding: '12px 16px', fontSize: '14.5px', resize: 'vertical', minHeight: '72px' }} />
  );
}

function Checkbox({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2.5 cursor-pointer py-3">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="text-[14.5px]" style={{ color: 'var(--ink)' }}>{label}</span>
    </label>
  );
}

function Select({
  value, onChange, options, placeholder, freeText,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  freeText?: boolean;
}) {
  if (freeText) {
    // Combobox: input with datalist
    const listId = `dl-${Math.random().toString(36).slice(2, 8)}`;
    return (
      <>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          list={listId}
          className="input"
          style={{ padding: '12px 16px', fontSize: '14.5px' }}
        />
        <datalist id={listId}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </datalist>
      </>
    );
  }
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="input"
      style={{
        padding: '12px 16px',
        fontSize: '14.5px',
        appearance: 'none',
        WebkitAppearance: 'none',
        backgroundImage:
          'linear-gradient(45deg, transparent 50%, var(--accent) 50%), linear-gradient(135deg, var(--accent) 50%, transparent 50%)',
        backgroundPosition: 'calc(100% - 14px) center, calc(100% - 10px) center',
        backgroundSize: '5px 5px',
        backgroundRepeat: 'no-repeat',
        paddingLeft: '28px',
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
