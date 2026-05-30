import { useState, useEffect, type FormEvent } from 'react';
import { btnSmall, btnSecondary } from '../lib/design';
import type { Student, Course, Employer, Dispatch, EmployerApprovalRequest, PlacementSettings, PracticumData } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import { randomId, generateFeedbackUrl } from '../lib/dataApi';
import { orgAvailability } from '../lib/orgAvailability';
import { openMailto } from '../lib/openMailto';
import { showToast } from '../lib/toast';
import EvaluationForm from './EvaluationForm';
import Modal from './Modal';
import PlacementPanel from './PlacementPanel';

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
  onApproveSuggestion?: (emp: Employer) => Promise<void> | void;
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
    firstChoiceOrg: student?.firstChoiceOrg || '',
    firstChoiceResult: student?.firstChoiceResult || 'pending',
    secondChoiceOrg: student?.secondChoiceOrg || '',
    secondChoiceResult: student?.secondChoiceResult || 'pending',
    placementInterviewDate: student?.placementInterviewDate || '',
    placementInterviewTime: student?.placementInterviewTime || '',
    placementInterviewOrg: student?.placementInterviewOrg || '',
    feedbackToken: student?.feedbackToken || '',
    feedbackSubmittedAt: student?.feedbackSubmittedAt || '',
    placedAt: student?.placedAt || '',
    // Placement extension
    cvShareUrl: (student as any)?.cvShareUrl || '',
  });

  const prepPassed = !!form.preparation?.passed;

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
    if (!email || student?.cvUpdatedUrl) return; // skip if already has a CV
    supabase.from('cv_updates')
      .select('id, cv_file_path, uploaded_at, org_pref_1, org_pref_2, org_pref_3, suggested_org')
      .eq('email', email)
      .is('seen_at', null)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) setPendingCv(data[0]);
      });
  }, [student?.email]);

  // Full submission history for this candidate (every dated /cv-update submission).
  type CvRow = { id: string; uploaded_at: string; org_pref_1?: string | null; org_pref_2?: string | null; org_pref_3?: string | null; suggested_org?: SuggestedOrg | null };
  const [cvHistory, setCvHistory] = useState<CvRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    const email = student?.email?.trim().toLowerCase();
    if (!email) { setCvHistory([]); return; }
    let alive = true;
    supabase.from('cv_updates')
      .select('id, uploaded_at, org_pref_1, org_pref_2, org_pref_3, suggested_org')
      .eq('email', email)
      .order('uploaded_at', { ascending: false })
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
    setForm(f => ({ ...f, cvUpdatedUrl: storageUrl }));
    await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', pendingCv.id);
    setPendingCv(null);
    setCvApplied(true);
  }

  // Approve a candidate-suggested org: make it the student's 1st choice AND create it
  // as a private (restricted) approved employer so it's tracked for placement.
  async function approveSuggestion() {
    const o = pendingCv?.suggested_org;
    if (!o?.name) return;
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
    };
    await onApproveSuggestion?.(emp);
    setForm(f => ({ ...f, firstChoiceOrg: o.name!, firstChoiceResult: 'pending' }));
    if (pendingCv) await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', pendingCv.id);
    setSuggestionDecided('approved');
  }

  async function rejectSuggestion() {
    if (pendingCv) await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', pendingCv.id);
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
        return e.name === selectedValue || e.name === form.firstChoiceOrg || e.name === form.secondChoiceOrg;
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
  function changeTag(cur: CvRow, prev: CvRow | undefined, i: number): { label: string; color: string } | null {
    const org = prefAt(cur, i);
    if (!org || !prev) return null; // first submission → no diff
    if (prefAt(prev, i) === org) return { label: 'ללא שינוי', color: 'var(--text-soft)' };
    const wasAt = [0, 1, 2].findIndex(j => prefAt(prev, j) === org);
    if (wasAt >= 0) return { label: `שינה מיקום (היה #${wasAt + 1})`, color: '#b45309' };
    const replaced = prefAt(prev, i);
    return { label: replaced ? `חדש (במקום ${replaced})` : 'חדש', color: 'var(--accent)' };
  }

  function updatePrep<K extends keyof NonNullable<Student['preparation']>>(k: K, v: any) {
    setForm(f => ({ ...f, preparation: { ...(f.preparation || {}), [k]: v } as any }));
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

    let saved = form;
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

  /** Returns the feedback URL, generating and auto-saving a new token if needed. */
  async function ensureFeedbackUrl(): Promise<string> {
    if (form.feedbackToken) {
      return `${window.location.origin}/feedback?token=${encodeURIComponent(form.feedbackToken)}`;
    }
    const { token, url } = generateFeedbackUrl(form.id, window.location.origin);
    const updated = { ...form, feedbackToken: token };
    setForm(updated);
    // Auto-save immediately so the token is persisted before the email is sent
    if (onAutoSave) await onAutoSave(updated);
    return url;
  }

  async function handleSendFeedbackEmail() {
    if (!form.acceptedOrg) { alert('לסטודנט/ית אין ארגון מאכסן מוגדר — מלא/י קודם את שדה "ארגון מאכסן בפועל".'); return; }
    const url = await ensureFeedbackUrl();
    const emp = employers.find(e => e.name === form.acceptedOrg);
    const empEmail = emp?.contactEmail || '';
    const greeting = emp?.contactPerson ? `${emp.contactPerson} שלום,` : 'שלום,';
    const subject = encodeURIComponent(`בקשה למשוב — ${form.name}`);
    const body = encodeURIComponent(
      `${greeting}\n\n` +
      `בהמשך לפרקטיקום של ${form.name} בארגונכם, נשמח לקבל את משובכם.\n\n` +
      `לחצו על הקישור הבא למילוי טופס קצר (כ‑2 דקות):\n${url}\n\n` +
      `בתודה,\nצוות הפרקטיקום · אוניברסיטת אריאל`
    );
    setShownFeedbackUrl(url);
    if (!empEmail) {
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
      return;
    }
    window.open(`mailto:${empEmail}?subject=${subject}&body=${body}`, '_blank');
  }

  async function handleSendFeedbackWhatsApp() {
    if (!form.acceptedOrg) { alert('לסטודנט/ית אין ארגון מאכסן מוגדר.'); return; }
    const url = await ensureFeedbackUrl();
    const emp = employers.find(e => e.name === form.acceptedOrg);
    const empPhone = emp?.contactPhone || '';
    const msg = encodeURIComponent(
      `שלום,\nבהמשך לפרקטיקום של ${form.name} בארגונכם,\n` +
      `נשמח לקבל משוב קצר בקישור הבא:\n${url}`
    );
    setShownFeedbackUrl(url);
    if (!empPhone) {
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
      return;
    }
    let n = empPhone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}?text=${msg}`, '_blank');
  }

  async function handleCopyFeedbackLink() {
    const url = await ensureFeedbackUrl();
    setShownFeedbackUrl(url);
    // Try modern clipboard API; fall back to execCommand for iOS Safari
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(url); copied = true; } catch {}
    }
    if (!copied) {
      // iOS fallback: create a temporary input, select and copy
      const el = document.createElement('input');
      el.value = url;
      el.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(el);
      el.focus(); el.select();
      try { copied = document.execCommand('copy'); } catch {}
      document.body.removeChild(el);
    }
    if (copied) {
      showToast('✓ קישור המשוב הועתק ללוח', 'success');
    } else {
      // Clipboard not available — just show the URL so user can copy manually
      showToast('לא ניתן להעתיק — העתק ידנית מהתיבה למטה', 'warn');
    }
  }

  return (
    <>
    <Modal onClose={onClose} maxWidth="max-w-[820px]">
        <form onSubmit={handleSubmit} className="px-5 py-7 md:px-10 md:py-10">

          <div className="flex items-start justify-between gap-8 pb-6 border-b mb-8" style={{ borderColor: 'var(--divider)' }}>
            <div>
              <div className="chapter-mark mb-2">{isNew ? 'סטודנט/ית חדש' : 'עריכת סטודנט/ית'}</div>
              <h2 className="serif text-[32px] leading-[1.1] tracking-tight" style={{ color: 'var(--ink)' }}>
                {form.name || (isNew ? 'הוסף שם' : '')}
              </h2>
            </div>
            <button type="button" onClick={onClose} className="mono text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">סגור ✕</button>
          </div>

          <SectionSub title="פרטים אישיים">
            <Field label="שם מלא"><Input value={form.name} onChange={v=>update('name',v)} required/></Field>
            <Field label="עיר מגורים"><Input value={form.city||''} onChange={v=>update('city',v)}/></Field>
            <Field label="טלפון"><Input type="tel" value={form.phone||''} onChange={v=>update('phone',v)}/></Field>
            <Field label="מייל"><Input type="email" value={form.email||''} onChange={v=>update('email',v)}/></Field>
          </SectionSub>

          <SectionSub title="הקשר — קורס ושנה">
            <Field label="קורס">
              <Select value={form.courseId||''} onChange={v=>update('courseId',v)}
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

          {/* CV for dispatch — auto-uses cvUpdatedUrl or cvUrl (Supabase Storage links) */}
          {(form as any).cvUpdatedUrl || (form as any).cvUrl ? (
            <SectionSub title="📋 שיבוץ — קו&quot;ח לשליחה">
              <div className="col-span-full rounded-xl p-3" style={{ background: 'rgba(5,150,105,0.07)', border: '1px solid rgba(5,150,105,0.3)' }}>
                <div className="mono text-[11px] font-semibold mb-1" style={{ color: '#059669' }}>
                  ✓ {(form as any).cvUpdatedUrl ? 'קו"ח מעודכן (אחרי הכנה) — יצורף אוטומטית לשליחה למעסיק' : 'קו"ח מקורי — יצורף אוטומטית לשליחה למעסיק'}
                </div>
                <div className="mono text-[10.5px]" style={{ color: 'var(--text-soft)' }}>
                  הקישור מגיע מה-Supabase ומצורף להודעת WhatsApp/מייל ללא הגדרה נוספת.
                </div>
              </div>
            </SectionSub>
          ) : (
            <SectionSub title="📋 שיבוץ — קו&quot;ח לשליחה">
              <div className="col-span-full rounded-xl p-3" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.3)' }}>
                <div className="mono text-[11px] font-semibold" style={{ color: '#b91c1c' }}>
                  ⚠ לא הועלה קו"ח — יש להעלות קו"ח בקטע "מסמכים וחוו"ד" למטה לפני שליחה למעסיק.
                </div>
              </div>
            </SectionSub>
          )}

          <SectionSub title="CV מעודכן (חובה לפני בחירת ארגון)">
            {pendingCv && (
              <div className="col-span-full flex items-center justify-between gap-3 p-3 rounded-xl"
                style={{ background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.35)' }}>
                <div>
                  <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: '#b45309' }}>
                    ✦ CV מעודכן ממתין — הועלה {new Date(pendingCv.uploaded_at).toLocaleDateString('he-IL')}
                  </div>
                  <div className="text-[12px] mt-0.5" style={{ color: '#92400e' }}>
                    {pendingCv.cv_file_path.split('/').pop()}
                  </div>
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
                  }}>✓ אמץ כ‑CV מעודכן</button>
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
                  <button type="button" onClick={approveSuggestion} style={{
                    padding: '7px 14px', fontSize: '12px', fontWeight: 600,
                    background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer',
                  }}>✓ אשר — צור ארגון פרטי וקבע כבחירה ראשונה</button>
                  <button type="button" onClick={rejectSuggestion} style={{
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

            <div className="col-span-full">
              <FileField label="קורות חיים מעודכן — אחרי הכנה" value={form.cvUpdatedUrl||''} onChange={v=>update('cvUpdatedUrl',v)}/>
            </div>
          </SectionSub>

          <SectionSub title="בחירת ארגון">
            {cvHistory.length > 0 && (() => {
              const latest = cvHistory[0];
              const prev = cvHistory[1];
              const fmt = (s: string) => { try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; } };
              const latestPrefs = [0, 1, 2].map(i => prefAt(latest, i)).filter(Boolean);
              if (latestPrefs.length === 0 && !latest.suggested_org?.name) return null;
              return (
                <div className="col-span-full p-3 rounded-lg" style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid var(--divider)' }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
                      העדפות הארגון שהמועמד/ת הגיש/ה · {fmt(latest.uploaded_at)}
                    </span>
                    {!prev && <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>הגשה ראשונה</span>}
                  </div>
                  <ol className="mt-2 space-y-1">
                    {[0, 1, 2].map(i => {
                      const org = prefAt(latest, i);
                      if (!org) return null;
                      const tag = changeTag(latest, prev, i);
                      return (
                        <li key={i} className="text-[13px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--ink)' }}>
                          <span style={{ color: 'var(--text-soft)' }}>{i + 1}.</span>
                          <span>{org}</span>
                          {tag && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ color: tag.color, background: 'rgba(0,0,0,0.04)' }}>
                              {tag.label}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {latest.suggested_org?.name && (
                    <div className="mt-2 text-[12px]" style={{ color: 'var(--ink)' }}>
                      🔆 הצעת ארגון מהמועמד/ת: <strong>{latest.suggested_org.name}</strong>
                    </div>
                  )}
                  {cvHistory.length > 1 && (
                    <>
                      <button type="button" onClick={() => setShowHistory(s => !s)}
                        className="mt-2 text-[11px] underline" style={{ color: 'var(--accent)' }}>
                        {showHistory ? 'הסתר היסטוריית הגשות' : `היסטוריית הגשות קודמות (${cvHistory.length - 1})`}
                      </button>
                      {showHistory && (
                        <div className="mt-2 space-y-1.5 pt-2" style={{ borderTop: '1px dashed var(--divider)' }}>
                          {cvHistory.slice(1).map(row => {
                            const ps = [0, 1, 2].map(i => prefAt(row, i)).filter(Boolean);
                            return (
                              <div key={row.id} className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
                                <span className="font-semibold">{fmt(row.uploaded_at)}</span>
                                {' · '}
                                {ps.length ? ps.map((p, idx) => `${idx + 1}. ${p}`).join('   ') : '—'}
                                {row.suggested_org?.name ? `   · הצעה: ${row.suggested_org.name}` : ''}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
            <div className="col-span-full flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
                מוצגים ארגונים זמינים לסטודנטים (תיאור + מקומות פנויים).
              </span>
              <label className="inline-flex items-center gap-2 cursor-pointer text-[12px]" style={{ color: showAllOrgs ? 'var(--accent)' : 'var(--text-soft)' }}>
                <input type="checkbox" checked={showAllOrgs} onChange={e=>setShowAllOrgs(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                ⚠ הצג גם ארגונים שאינם זמינים (עקיפה ידנית)
              </label>
            </div>
            <Field label="בחירה ראשונה — ארגון">
              <Select value={form.firstChoiceOrg||''} onChange={v=>update('firstChoiceOrg',v)}
                options={gatedOrgOptions(form.firstChoiceOrg||'')}
                placeholder="בחר ארגון"
                freeText/>
            </Field>
            <Field label="תוצאת ראיון — בחירה ראשונה">
              <Select value={form.firstChoiceResult||'pending'} onChange={v=>update('firstChoiceResult', v as any)}
                options={[
                  { value: 'pending', label: 'טרם רואיין' },
                  { value: 'passed', label: 'עבר' },
                  { value: 'failed', label: 'לא עבר' },
                ]}/>
            </Field>
            <Field label="בחירה שנייה — ארגון">
              <Select value={form.secondChoiceOrg||''} onChange={v=>update('secondChoiceOrg',v)}
                options={gatedOrgOptions(form.secondChoiceOrg||'')}
                placeholder="בחר ארגון שני"
                freeText/>
            </Field>
            <Field label="תוצאת ראיון — בחירה שנייה">
              <Select value={form.secondChoiceResult||'pending'} onChange={v=>update('secondChoiceResult', v as any)}
                options={[
                  { value: 'pending', label: 'טרם רואיין' },
                  { value: 'passed', label: 'עבר' },
                  { value: 'failed', label: 'לא עבר' },
                ]}/>
            </Field>
          </SectionSub>

          <SectionSub title="ראיון שיבוץ (רחל — תיאום עם מעסיק)">
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
          </SectionSub>

          <SectionSub title="השמה סופית ושעות">
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
          </SectionSub>

          <SectionSub title="מסמכים וחוו״ד (קישורי OneDrive / SharePoint)">
            <FileField label="CV — קורות חיים" value={form.cvUrl||''} onChange={v=>update('cvUrl',v)}/>
            <FileField label="טופס הגשת מועמדות" value={form.formUrl||''} onChange={v=>update('formUrl',v)}/>
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
          </SectionSub>

          <SectionSub title="הערות">
            <div className="col-span-full"><Field label="הערות פנימיות"><Textarea rows={3} value={form.notes||''} onChange={v=>update('notes',v)}/></Field></div>
          </SectionSub>

          <div className="flex flex-wrap gap-3 pt-8 mt-8 border-t" style={{ borderColor: 'var(--divider)' }}>
            <button type="submit" style={{
              display: 'inline-block', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
              background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>{isNew ? 'צור' : 'שמור'} →</button>
            <button type="button" onClick={openCall} disabled={!form.phone} style={btnSmall(!form.phone)}>📞 התקשר</button>
            <button type="button" onClick={openWhatsApp} disabled={!form.phone} style={btnSmall(!form.phone)}>WhatsApp</button>
            <button type="button" onClick={openOutlookCompose} disabled={!form.email} style={btnSmall(!form.email)}>מייל (Outlook)</button>
            {!isNew && (
              <button type="button" onClick={() => setShowEval(true)} style={btnSecondary()}>🖨 טופס הערכה</button>
            )}
            {!isNew && !form.feedbackSubmittedAt && (
              <button type="button" onClick={handleSendFeedbackEmail}
                title="שלח למעסיק קישור למילוי משוב — פותח Outlook" style={{
                display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
                background: 'var(--accent)', color: 'white', border: 'none',
                borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}>📧 שלח משוב למעסיק</button>
            )}
            {!isNew && !form.feedbackSubmittedAt && (
              <button type="button" onClick={handleSendFeedbackWhatsApp}
                title="שלח קישור משוב ב‑WhatsApp" style={{
                display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
                background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)',
                borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}>💬 WhatsApp למעסיק</button>
            )}
            {!isNew && (
              <button type="button" onClick={handleCopyFeedbackLink}
                title="העתק קישור משוב ללוח" style={{
                display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
                background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)',
                borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
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

          {/* PlacementPanel — dispatch workflow for existing students in practicum courses */}
          {!isNew && placementExtras && (() => {
            const studentCourse = courses.find(c => c.id === form.courseId);
            if (!studentCourse || (studentCourse as any).type !== 'practicum') return null;
            const ps = placementExtras.placementSettings as PlacementSettings;
            return (
              <div style={{ borderTop: '2px solid var(--divider)', marginTop: '32px', paddingTop: '24px' }}>
                <PlacementPanel
                  student={form as Student & { cvShareUrl?: string | null; submissionStatus?: string; preferences?: any[] }}
                  allStudents={placementExtras.allStudents}
                  employers={employers}
                  courses={courses}
                  dispatches={placementExtras.dispatches}
                  approvalRequests={placementExtras.approvalRequests}
                  placementSettings={ps}
                  userName={placementExtras.userName}
                  onDataChange={placementExtras.onDataChange}
                />
              </div>
            );
          })()}
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
