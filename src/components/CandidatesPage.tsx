import { useMemo, useState } from 'react';
import { btnPrimary, btnSmall, btnSecondary } from '../lib/design';
import { supabase } from '../lib/supabase';
import type { Candidate } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear, outlookCalendarUrl } from './pageShared';
import { saveSnapshot, randomId } from '../lib/dataApi';
import { showToast } from '../lib/toast';
import type { Student } from '../lib/supabase';
import CandidateEditor from './CandidateEditor';
import { RowActions, Popover, RefreshButton, StatusDot, type DotStatus } from './StudentsPage';
import SubmissionsInbox from './SubmissionsInbox';
import ExcelImport from './ExcelImport';
// email sending is via Outlook (mailto:) — no direct API imports needed
import { openMailto } from '../lib/openMailto';

export default function CandidatesPage({ data, context, userName, onRefresh }: PageProps) {
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<'all' | 'pending' | 'passed' | 'failed' | 'submitted' | 'notsubmitted'>('all');
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMsgModal, setShowMsgModal] = useState(false);
  const [msgSubject, setMsgSubject] = useState('');
  const [msgBody, setMsgBody] = useState('');

  // Email confirmation state — no email goes out without user review
  type EmailConfirm = {
    type: 'acceptance' | 'rejection';
    recipients: Array<{ id: string; name: string; email: string }>;
    subject: string;
    body: string;
  };
  const [emailConfirm, setEmailConfirm] = useState<EmailConfirm | null>(null);

  // Per-recipient draft queue. Opening many mailto: links in one synchronous
  // loop makes the OS mail app race — every window ends up with the LAST
  // recipient's content. So we open drafts ONE AT A TIME, each from its own
  // click (its own user gesture), which also dodges the popup blocker.
  type Draft = { name: string; email: string; url: string };
  const [draftQueue, setDraftQueue] = useState<{ drafts: Draft[]; index: number } | null>(null);

  const EMAIL_TEMPLATES = {
    acceptance: {
      subject: 'ברכות — התקבלת לתכנית הפרקטיקום',
      body: `שלום {{שם}},

ברכות חמות! שמחנו לבשר כי עברת בהצלחה את ראיון הקבלה לתכנית הפרקטיקום במשאבי אנוש, אוניברסיטת אריאל.

📌 השלבים הקרובים:

1. סדנת הכנה לפרקטיקום
הסדנה תתקיים בתאריך {{תאריך_סדנה}}. פרטים נוספים יישלחו בנפרד.

2. הגשת קורות חיים ובחירת ארגון
לאחר הסדנה אתה/את מתבקש/ת להעלות קורות חיים מעודכנים ולציין את העדפותיך לארגון — הכל דרך הקישור המצורף:
{{קישור_קוח}}

תהליך השיבוץ יחל רק לאחר הגשת קורות החיים המעודכנים והעדפותיך — אנא הקפד/י לבצע זאת בסמוך לסיום הסדנה.

לצפייה מראש ברשימת הארגונים ותיאוריהם: {{קישור_ארגונים}}

לכל ארגון מצורף תיאור המפרט את תחומי פעילותו ואת סוג הניסיון שתצבור/י בו — אנא קרא/י בעיון לפני הבחירה.

שים/י לב: מאחר שהארגון עתיד לראיין אותך בהמשך התהליך, ומאחר שישנם מועמדים נוספים, איננו יכולים להבטיח שיבוץ בהתאם להעדפה.

3. הצעת ארגון מטעמך (אופציונלי)
אם יש ברשותך קשר עם ארגון שבו מנהלת משאבי אנוש המעוניינת לקלוט מתמחה/ת — תוכל/י להוסיף את פרטיו בטופס הקישור לעיל, ומנחה התכנית יבחן את אישורו.

לכל שאלה, נשמח לענות.

בברכה,
צוות הפרקטיקום · אוניברסיטת אריאל`,
    },
    rejection: {
      subject: 'תוצאת ראיון — תכנית הפרקטיקום',
      body: `שלום {{שם}},

תודה רבה על התעניינותך בתכנית הפרקטיקום ועל הזמן שהשקעת בתהליך.

לאור מספר המקומות המצומצם בתכנית, לצערנו לא נוכל לקלוט אותך במחזור הנוכחי. אם יתפנה מקום, נשמח לשקול את מועמדותך מחדש.

גם אם לא נצליח לקלוט אותך הפעם — אם תרצה/י להתייעץ בנוגע לקידום הקריירה שלך במשאבי אנוש, אתה/את מוזמן/ת לתאם פגישה עם ד״ר יריב איצקוביץ, מנחה התכנית.

אנו מודים לך על הגשת המועמדות ומאחלים לך הצלחה רבה בהמשך.

בברכה,
צוות הפרקטיקום · אוניברסיטת אריאל`,
    },
  } as const;

  function openEmailConfirm(type: 'acceptance' | 'rejection', recipients: Array<{ id: string; name: string; email: string }>) {
    if (!recipients.length) { showToast('לאף אחד מהנבחרים אין מייל', 'error'); return; }

    let body: string = EMAIL_TEMPLATES[type].body;

    // For acceptance emails: substitute {{תאריך_סדנה}} from the course settings.
    // We look up the first recipient's course (all selected candidates should share a course).
    if (type === 'acceptance') {
      const firstCand = all.find(c => c.id === recipients[0].id);
      const course = courses.find(c => c.id === firstCand?.courseId);
      const workshopDate = (course as any)?.workshopDate || '';
      body = body.replace(/\{\{תאריך_סדנה\}\}/g, workshopDate || '⚠️ תאריך טרם נקבע');
    }

    setEmailConfirm({ type, recipients, subject: EMAIL_TEMPLATES[type].subject, body });
  }

  // Build a personalized mailto: for ONE recipient (TO, not BCC) — name and
  // their own /cv-update link prefilled.
  function buildDraftUrl(r: { name: string; email: string }, subject: string, body: string, orgsLink: string): string {
    const cvLink = `${window.location.origin}/cv-update/?email=${encodeURIComponent(r.email)}&name=${encodeURIComponent(r.name)}`;
    const personalBody = body
      .replace(/\{\{שם\}\}/g, r.name || '')
      .replace(/\{\{קישור_קוח\}\}/g, cvLink)
      .replace(/\{\{קישור_ארגונים\}\}/g, orgsLink);
    return `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(personalBody)}`;
  }

  function sendConfirmedEmail() {
    if (!emailConfirm) return;
    const { type, recipients, subject, body } = emailConfirm;
    const orgsLink = `${window.location.origin}/organizations`;

    // One personalized draft per recipient. We open the FIRST now (inside this
    // click's gesture) and hand the rest to the draft queue, which opens them
    // one-at-a-time on their own clicks. Opening them all in a synchronous loop
    // makes the OS mail app race so every window gets the LAST recipient — the
    // exact "two drafts, same person" bug this replaces.
    const drafts: Draft[] = recipients.map(r => ({ name: r.name, email: r.email, url: buildDraftUrl(r, subject, body, orgsLink) }));
    if (!drafts.length) return;
    openMailto(drafts[0].url);

    // Optimistically mark every selected recipient as "email sent".
    const next = [...all];
    const field = type === 'acceptance' ? 'acceptanceEmailSent' : 'rejectionEmailSent';
    for (const r of recipients) {
      const i = next.findIndex(c => c.id === r.id);
      if (i >= 0) next[i] = { ...next[i], [field]: true };
    }
    persistAndRefresh(next, drafts.length === 1 ? '✉ טיוטה נפתחה ב‑Outlook' : `✉ טיוטה 1 מתוך ${drafts.length} נפתחה ב‑Outlook`);
    setEmailConfirm(null);

    if (drafts.length > 1) {
      setDraftQueue({ drafts, index: 1 }); // prompt to open the rest, one click each
    } else {
      showToast('✓ טיוטה מותאמת אישית נפתחה ב‑Outlook', 'success');
    }
  }

  function openNextDraft() {
    if (!draftQueue) return;
    const d = draftQueue.drafts[draftQueue.index];
    if (d) openMailto(d.url);
    const nextIndex = draftQueue.index + 1;
    if (nextIndex >= draftQueue.drafts.length) {
      setDraftQueue(null);
      showToast(`✓ כל ${draftQueue.drafts.length} הטיוטות המותאמות אישית נפתחו`, 'success');
    } else {
      setDraftQueue({ ...draftQueue, index: nextIndex });
    }
  }

  const all = data.candidates || [];
  const courses = data.courses || [];

  const years = useMemo(() => {
    const set = new Set<string>();
    courses.forEach(c => c.year && set.add(normalizeYear(c.year)));
    all.forEach(c => c.year && set.add(normalizeYear(c.year)));
    (data.academicYears || []).forEach(y => set.add(normalizeYear(y)));
    return Array.from(set).sort().reverse();
  }, [courses, all, data.academicYears]);

  const scoped = useMemo(() => all.filter(c => sameContext(c, context, courses)), [all, context, courses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter(c => {
      const hasDocs = !!(c.cvUrl && c.applicationUrl);
      const result = c.interviewResult || 'pending';
      if (stage === 'submitted') return hasDocs;
      if (stage === 'notsubmitted') return !hasDocs && result === 'pending';
      if (stage !== 'all' && result !== stage) return false;
      if (!q) return true;
      const hay = [c.name, c.phone, c.email].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  }, [scoped, search, stage]);

  const counts = useMemo(() => ({
    total: scoped.length,
    pending: scoped.filter(c => !c.interviewResult || c.interviewResult === 'pending').length,
    passed: scoped.filter(c => c.interviewResult === 'passed').length,
    failed: scoped.filter(c => c.interviewResult === 'failed').length,
    submitted: scoped.filter(c => !!(c.cvUrl && c.applicationUrl)).length,
    notsubmitted: scoped.filter(c => !(c.cvUrl && c.applicationUrl) && (!c.interviewResult || c.interviewResult === 'pending')).length,
  }), [scoped]);

  async function persistAndRefresh(next: Candidate[], msg: string) {
    setSaving(true); setSaveMsg(null);
    const res = await saveSnapshot({ ...data, candidates: next }, { name: userName });
    setSaving(false);
    if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
    setSaveMsg(msg);
    showToast(msg + ' · נשמר בענן ☁️', 'success');
    (data.candidates as Candidate[]) = next;
    onRefresh();
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function handleSave(c: Candidate) {
    // Require interview summary before pass/fail
    if ((c.interviewResult === 'passed' || c.interviewResult === 'failed') && !c.interviewSummary?.trim()) {
      showToast('יש למלא סיכום ראיון לפני סימון תוצאה', 'error');
      return;
    }
    // Auto-convert to student if interview passed and not yet converted
    const shouldAutoConvert = c.interviewResult === 'passed' && !c.convertedToStudentId;

    // REVERSE: if candidate was previously converted but result is now NOT 'passed',
    // remove the linked student record.
    const previous = all.find(x => x.id === c.id);
    const shouldReverse =
      previous?.convertedToStudentId &&
      c.interviewResult !== 'passed';

    if (shouldReverse) {
      if (!confirm(
        `המועמד/ת סומן/ה בעבר כ"עבר" והועבר/ה לסטודנטים.\n\n` +
        `שינוי התוצאה כעת ל‑"${c.interviewResult === 'failed' ? 'לא התקבל' : 'ממתין'}" יסיר את רשומת הסטודנט/ית המקושרת.\n\n` +
        `להמשיך?`
      )) return;

      const nextStudents = (data.students || []).filter(s => s.id !== previous!.convertedToStudentId);
      const clearedCandidate: Candidate = { ...c, convertedToStudentId: undefined };
      const idx = all.findIndex(x => x.id === c.id);
      const nextCandidates = [...all];
      nextCandidates[idx] = clearedCandidate;

      setSaving(true); setSaveMsg(null);
      const res = await saveSnapshot(
        { ...data, students: nextStudents, candidates: nextCandidates },
        { name: userName },
        { action: 'שינוי סטטוס → הוסר מסטודנטים', entity: 'מועמד', target: c.name }
      );
      setSaving(false);
      setEditing(null); setCreating(false);
      if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); return; }
      (data.students as any) = nextStudents;
      (data.candidates as Candidate[]) = nextCandidates;
      onRefresh();
      setSaveMsg('✓ הוסר מרשימת הסטודנטים');
      setTimeout(() => setSaveMsg(null), 3500);
      return;
    }

    if (shouldAutoConvert) {
      const conversionNotes = [
        c.evalScore != null ? `ציון ראיון: ${c.evalScore}` : '',
        c.preferredArea ? `תחום מבוקש: ${c.preferredArea}` : '',
        c.interviewSummary ? `סיכום ראיון: ${c.interviewSummary}` : '',
      ].filter(Boolean).join('\n');
      const newStudent: Student = {
        id: randomId('s'),
        name: c.name,
        phone: c.phone || '',
        email: c.email || '',
        courseId: c.courseId,
        year: c.year,
        cvUrl: c.cvUrl || '',
        formUrl: c.applicationUrl || '',
        preparation: { passed: false },
        fromCandidate: true,
        fromCandidateId: c.id,
        notes: conversionNotes || undefined,
      };
      const updatedCand: Candidate = { ...c, convertedToStudentId: newStudent.id };
      const idx = all.findIndex(x => x.id === c.id);
      const nextCandidates = idx >= 0 ? [...all] : [...all, updatedCand];
      if (idx >= 0) nextCandidates[idx] = updatedCand;
      const nextStudents = [...(data.students || []), newStudent];

      setSaving(true); setSaveMsg(null);
      const res = await saveSnapshot(
        { ...data, students: nextStudents, candidates: nextCandidates },
        { name: userName },
        { action: 'עבר ראיון → הועבר לסטודנטים', entity: 'מועמד', target: c.name }
      );
      setSaving(false);
      setEditing(null); setCreating(false);
      if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); return; }
      (data.students as Student[]) = nextStudents;
      (data.candidates as Candidate[]) = nextCandidates;
      onRefresh();
      setSaveMsg('✓ עבר ראיון והועבר לסטודנטים');
      setTimeout(() => setSaveMsg(null), 3500);

      // Offer acceptance email — user must confirm before it sends
      if (c.email) {
        openEmailConfirm('acceptance', [{ id: updatedCand.id, name: c.name, email: c.email }]);
      }
      return;
    }

    const idx = all.findIndex(x => x.id === c.id);
    const next = idx >= 0 ? [...all] : [...all, c];
    if (idx >= 0) next[idx] = c;
    setEditing(null); setCreating(false);
    await persistAndRefresh(next, idx >= 0 ? '✓ עודכן' : '✓ נוסף');

    // Offer rejection email — user must confirm before it sends
    const prevResult = previous?.interviewResult;
    const nowFailed  = c.interviewResult === 'failed';
    const wasntFailed = !prevResult || prevResult !== 'failed';
    const alreadySent = previous?.rejectionEmailSent;
    if (nowFailed && wasntFailed && !alreadySent && c.email) {
      openEmailConfirm('rejection', [{ id: c.id, name: c.name, email: c.email }]);
    }
  }

  async function handleDelete(id: string) {
    setEditing(null);
    await persistAndRefresh(all.filter(c => c.id !== id), '✓ נמחק');
  }

  async function handleAcceptSubmissionIntoCandidates(sub: any) {
    // Find course by name+year; fall back to name-only if year doesn't match
    const subYear = sub.year || '';
    const nameMatch = (c: typeof courses[0]) =>
      (c.name || '').replace(/\s+/g, '').toLowerCase() === (sub.course_name || '').replace(/\s+/g, '').toLowerCase();
    const course =
      courses.find(c => nameMatch(c) && c.year === subYear) ||
      courses.find(c => nameMatch(c));
    // Parse booked slot out of notes (format: "בחר מועד ראיון: YYYY-MM-DD HH:MM–HH:MM")
    const slotMatch = (sub.notes || '').match(/בחר מועד ראיון:\s*(\d{4}-\d{2}-\d{2})\s*(\d{1,2}:\d{2}(?:[–\-]\d{1,2}:\d{2})?)/);
    const interviewDate = slotMatch?.[1] || '';
    const interviewTime = slotMatch?.[2] || '';

    // ── Always read candidates fresh from Supabase ───────────────────────────
    // Prevents race condition: onRefresh() from a previous intake may complete
    // AFTER the next intake begins, causing the app to regress to a stale list
    // and then overwrite a recently-saved candidate on the next save.
    const { data: freshRow } = await supabase
      .from('practicum_data')
      .select('data')
      .eq('org_id', 'default')
      .single();
    const currentCandidates: Candidate[] = (freshRow as any)?.data?.candidates || [];
    function normN(n: string) { return (n || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
    const byEmail = sub.email
      ? currentCandidates.find((c: Candidate) => c.email && c.email.toLowerCase() === sub.email!.toLowerCase())
      : undefined;
    const byExactName = !byEmail
      ? currentCandidates.find((c: Candidate) => normN(c.name) === normN(sub.name))
      : undefined;
    const subLastToken = normN(sub.name).split(' ').pop() || '';
    const bySimilarName = !byEmail && !byExactName && subLastToken.length > 2
      ? currentCandidates.find((c: Candidate) => {
          const t = normN(c.name).split(' ').pop() || '';
          return t === subLastToken && normN(c.name) !== normN(sub.name);
        })
      : undefined;

    let existingRecord: Candidate | undefined = byEmail || byExactName;
    if (!existingRecord && bySimilarName) {
      // Use showToast instead of confirm() — Safari resets React state on confirm()
      // Auto-merge by email match, otherwise create new record (admin can merge manually)
      existingRecord = undefined; // create new, admin can merge manually if needed
      showToast(`נמצא מועמד דומה: ${bySimilarName.name} — נוצרה רשומה חדשה ל-${sub.name}`, 'success');
    }

    if (existingRecord) {
      // Update existing record
      const updated: Candidate = {
        ...existingRecord,
        cvUrl: sub.cv_file_path ? `storage://candidate-uploads/${sub.cv_file_path}` : existingRecord.cvUrl,
        applicationUrl: sub.application_file_path ? `storage://candidate-uploads/${sub.application_file_path}` : existingRecord.applicationUrl,
        interviewDate: interviewDate || existingRecord.interviewDate,
        interviewTime: interviewTime || existingRecord.interviewTime,
        submittedAt: sub.submitted_at,
        applicationDate: existingRecord.applicationDate || sub.submitted_at?.slice(0, 10) || '',
      };
      const nextCandidates = currentCandidates.map((c: Candidate) => c.id === existingRecord!.id ? updated : c);
      setSaving(true);
      const res = await saveSnapshot(
        { ...data, candidates: nextCandidates },
        { name: userName },
        { action: 'עודכן מטופס הרשמה', entity: 'מועמד', target: sub.name }
      );
      setSaving(false);
      if (res.ok) { (data.candidates as Candidate[]) = nextCandidates; onRefresh(); }
      showToast(`✓ עודכן מועמד קיים: ${existingRecord.name}`, 'success');
    } else {
      // Create new candidate
      const newCandidate: Candidate = {
        id: randomId('cand'),
        name: sub.name,
        phone: sub.phone || '',
        email: sub.email || '',
        city: sub.city || '',
        courseId: course?.id || (courses[0]?.id || ''),
        year: sub.year || normalizeYear('תשפ״ז'),
        applicationDate: sub.submitted_at?.slice(0, 10) || '',
        cvUrl: sub.cv_file_path ? `storage://candidate-uploads/${sub.cv_file_path}` : '',
        applicationUrl: sub.application_file_path ? `storage://candidate-uploads/${sub.application_file_path}` : '',
        submittedAt: sub.submitted_at,
        interviewDate,
        interviewTime,
        interviewResult: 'pending',
        notes: sub.notes || '',
        questionnaire: sub.questionnaire || null,
      };
      const nextCandidates = [...currentCandidates, newCandidate];
      setSaving(true);
      const res = await saveSnapshot(
        { ...data, candidates: nextCandidates },
        { name: userName },
        { action: 'נקלט מטופס הרשמה', entity: 'מועמד', target: sub.name }
      );
      setSaving(false);
      if (res.ok) {
        (data.candidates as Candidate[]) = nextCandidates;
        onRefresh();
        showToast(`✓ נקלט מועמד חדש: ${sub.name}`, 'success');
      } else {
        showToast('שגיאה בשמירה: ' + (res.error || 'לא ידוע'), 'error');
      }
    }
  }

  async function handleRevertToSubmission(c: Candidate) {
    // Find the matching processed submission (by email first, then name)
    let subId: string | null = null;
    if (c.email) {
      const { data: subs } = await supabase
        .from('candidate_submissions')
        .select('id')
        .eq('processed', true)
        .ilike('email', c.email)
        .order('submitted_at', { ascending: false })
        .limit(1);
      subId = subs?.[0]?.id ?? null;
    }
    if (!subId && c.name) {
      const { data: subs } = await supabase
        .from('candidate_submissions')
        .select('id')
        .eq('processed', true)
        .ilike('name', c.name)
        .order('submitted_at', { ascending: false })
        .limit(1);
      subId = subs?.[0]?.id ?? null;
    }
    if (subId) {
      await supabase.from('candidate_submissions').update({ processed: false }).eq('id', subId);
    }
    const nextCandidates = all.filter(x => x.id !== c.id);
    await persistAndRefresh(nextCandidates, `↩ ${c.name} הוחזר לתיבת ההגשות`);
  }

  async function handleConvertToStudent(c: Candidate) {
    if (!confirm(`להעביר את ${c.name} לרשימת הסטודנטים? הפרטים והמסמכים יועתקו, והמועמד יסומן כמועבר.`)) return;
    const conversionNotes = [
      c.evalScore != null ? `ציון ראיון: ${c.evalScore}` : '',
      c.preferredArea ? `תחום מבוקש: ${c.preferredArea}` : '',
      c.interviewSummary ? `סיכום ראיון: ${c.interviewSummary}` : '',
    ].filter(Boolean).join('\n');
    const newStudent: Student = {
      id: randomId('s'),
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      courseId: c.courseId,
      year: c.year,
      cvUrl: c.cvUrl || '',
      formUrl: c.applicationUrl || '',
      preparation: { passed: false },
      fromCandidate: true,
      fromCandidateId: c.id,
      notes: conversionNotes || undefined,
    };
    const nextStudents = [...(data.students || []), newStudent];
    const nextCandidates = all.map(x => x.id === c.id ? { ...x, convertedToStudentId: newStudent.id } : x);
    setSaving(true); setSaveMsg(null);
    const nextData = { ...data, students: nextStudents, candidates: nextCandidates };
    const res = await saveSnapshot(nextData, { name: userName }, {
      action: 'הועבר לסטודנטים', entity: 'מועמד', target: c.name,
    });
    setSaving(false);
    if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); return; }
    setEditing(null);
    (data.students as Student[]) = nextStudents;
    (data.candidates as Candidate[]) = nextCandidates;
    onRefresh();
    setSaveMsg('✓ הועבר לסטודנטים');
    setTimeout(() => setSaveMsg(null), 3000);
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-10 pt-14 pb-28">
      <section className="pt-4 pb-14 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">V · מועמדים</div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>מועמדים</h1>
            <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
              {counts.total === 0
                ? 'אין מועמדים בהקשר הנוכחי.'
                : `${counts.total} מועמדים · ${counts.pending} ממתינים · ${counts.passed} עברו · ${counts.failed} לא עברו`}
            </p>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <button onClick={() => setCreating(true)} style={btnPrimary()}>+ מועמד/ת חדש/ה →</button>
            <button onClick={() => setShowImport(s => !s)}
              className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
              style={{ color: 'var(--accent)' }}>
              📊 {showImport ? 'סגור ייבוא' : 'ייבוא מ‑Excel'}
            </button>
          </div>
        </div>
      </section>

      {showImport && (
        <div className="mb-8">
          <ExcelImport kind="candidates" data={data} userName={userName} onDone={() => { setShowImport(false); onRefresh(); }} />
        </div>
      )}

      <SubmissionsInbox onAcceptIntoCandidates={handleAcceptSubmissionIntoCandidates} />

      <div className="mono text-[12px] uppercase tracking-[0.16em] flex items-center gap-4 flex-wrap mb-10" style={{ color: 'var(--text-soft)' }}>
        <RefreshButton onRefresh={onRefresh} />
        {saveMsg && <span style={{ color: 'var(--accent)' }}>· {saveMsg}</span>}
        {saving && <span className="opacity-75">· שומר...</span>}
      </div>

      {/* Ramzor tab bar */}
      <div className="ramzor-bar mb-4">
        {([
          ['all',          'הכל',          counts.total,         null   ],
          ['submitted',    'הגישו מסמכים', counts.submitted,     'amber'],
          ['notsubmitted', 'טרם הגישו',   counts.notsubmitted,  'gray' ],
          ['pending',      'ממתינים',      counts.pending,       'gray' ],
          ['passed',       'עברו',         counts.passed,        'green'],
          ['failed',       'לא עברו',      counts.failed,        'red'  ],
        ] as const).map(([key, label, n, dot]) => {
          const active = stage === key;
          const borderCol = dot ? `var(--tl-${dot})` : 'var(--accent)';
          return (
            <button key={key} onClick={() => setStage(key)}
              className={`ramzor-tab${active ? ' active' : ''}`}
              style={{ borderColor: active ? borderCol : 'transparent' }}>
              {dot && <StatusDot status={dot as DotStatus} size={7} />}
              <span className="mono text-[11px] uppercase tracking-[0.13em] font-semibold">{label}</span>
              <span className="serif text-[18px] leading-none">{n}</span>
            </button>
          );
        })}
      </div>
      {/* Status legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 mb-5 text-[12px]" style={{ color: 'var(--text-soft)' }}>
        {([
          ['green', 'עבר ראיון / הועבר לסטודנטים'],
          ['amber', 'הגיש/ה מסמכים'],
          ['gray',  'טרם הגיש/ה מסמכים'],
          ['red',   'לא התקבל/ה'],
        ] as const).map(([color, label]) => (
          <span key={color} className="flex items-center gap-1.5">
            <StatusDot status={color} size={7} />
            <span>{label}</span>
          </span>
        ))}
      </div>

      {/* Quick action strip for passed/failed groups */}
      {(stage === 'passed' || stage === 'failed') && filtered.length > 0 && (
        <div className="mb-4 flex items-center gap-3 p-3 rounded-xl flex-wrap"
          style={{
            background: stage === 'passed' ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.06)',
            border: `1px solid ${stage === 'passed' ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.25)'}`,
          }}>
          <span className="mono text-[11.5px] font-semibold" style={{ color: 'var(--ink)' }}>
            {filtered.length} מועמדים {stage === 'passed' ? 'שעברו ראיון' : 'שלא עברו'} בפילטר הנוכחי
          </span>
          <button
            onClick={() => {
              const ids = new Set(filtered.map(c => c.id));
              setSelectedIds(ids);
              const people = filtered.filter(c => c.email).map(c => ({ id: c.id, name: c.name, email: c.email! }));
              if (people.length === 0) { showToast('אין מועמדים עם מייל בקבוצה', 'error'); return; }
              openEmailConfirm(stage === 'passed' ? 'acceptance' : 'rejection', people);
            }}
            style={{
              display: 'inline-block', padding: '7px 14px', fontSize: '12px', fontWeight: 600,
              background: stage === 'passed' ? '#16a34a' : '#dc2626',
              color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
            {stage === 'passed' ? '✉ שלח הודעת קבלה לקבוצה' : '✉ שלח הודעת דחייה לקבוצה'}
          </button>
        </div>
      )}

      <div className="mb-4 flex gap-3 items-center flex-wrap">
        <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="חפש לפי שם, טלפון, מייל..."
          className="input flex-1"
          style={{ padding: '8px 14px', fontSize: '14px' }}/>
        {/* Select all / deselect all */}
        <button
          onClick={() => {
            const allFilteredIds = new Set(filtered.map(c => c.id));
            const allSelected = filtered.every(c => selectedIds.has(c.id));
            setSelectedIds(allSelected ? new Set() : allFilteredIds);
          }}
          className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
          style={{ color: filtered.every(c => selectedIds.has(c.id)) && filtered.length > 0 ? 'var(--accent)' : 'var(--text-soft)', whiteSpace: 'nowrap' }}
        >
          {filtered.every(c => selectedIds.has(c.id)) && filtered.length > 0 ? '✕ בטל הכל' : '☑ בחר הכל'}
        </button>
        {selectedIds.size > 0 && (
          <button onClick={() => setShowMsgModal(true)} style={btnSmall()}>📧 מייל Outlook</button>
        )}
        {selectedIds.size > 0 && (
          <button
            style={btnSmall()}
            onClick={() => {
              const people = Array.from(selectedIds).map(id => all.find(c => c.id === id)).filter(Boolean) as Candidate[];
              const withEmail = people.filter(c => c.email).map(c => ({ id: c.id, name: c.name, email: c.email! }));
              openEmailConfirm('acceptance', withEmail);
            }}
          >✓ הודעת קבלה ({selectedIds.size})</button>
        )}
        {selectedIds.size > 0 && (
          <button
            style={{ ...btnSmall(), borderColor: 'var(--accent)', color: 'var(--accent)' }}
            onClick={() => {
              const people = Array.from(selectedIds).map(id => all.find(c => c.id === id)).filter(Boolean) as Candidate[];
              const withEmail = people.filter(c => c.email).map(c => ({ id: c.id, name: c.name, email: c.email! }));
              openEmailConfirm('rejection', withEmail);
            }}
          >✗ הודעת דחייה ({selectedIds.size})</button>
        )}
        {selectedIds.size > 0 && (
          <button
            onClick={() => setSelectedIds(new Set())}
            className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
            style={{ color: 'var(--text-soft)' }}
          >
            ביטול בחירה
          </button>
        )}
      </div>

      {/* Group message modal */}
      {showMsgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(26,22,18,0.55)' }}>
          <div className="rounded-2xl border p-8 max-w-[520px] w-full mx-4" style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 20px 60px rgba(26,22,18,0.3)' }}>
            <div className="flex items-baseline justify-between mb-5">
              <div className="serif text-[22px]" style={{ color: 'var(--ink)' }}>מייל קבוצתי ב‑Outlook</div>
              <button onClick={() => setShowMsgModal(false)} className="mono text-[11px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100" style={{ color: 'var(--ink)' }}>✕</button>
            </div>
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-4 p-3 rounded-lg" style={{ background: 'rgba(122,30,43,0.06)', color: 'var(--ink)' }}>
              {Array.from(selectedIds).map(id => all.find(c => c.id === id)?.name).filter(Boolean).join(' · ')}
            </div>
            {/* Warn about candidates without email */}
            {(() => {
              const noEmail = Array.from(selectedIds)
                .map(id => all.find(c => c.id === id))
                .filter(c => c && !c.email)
                .map(c => c!.name);
              return noEmail.length > 0 ? (
                <div className="mb-4 p-3 rounded-lg text-[12.5px]" style={{ background: 'rgba(180,60,60,0.08)', color: '#b03030', border: '1px solid rgba(180,60,60,0.2)' }}>
                  ⚠ ללא מייל (לא יישלח): {noEmail.join(', ')}
                </div>
              ) : null;
            })()}
            <label className="block mb-3">
              <span className="mono text-[11px] uppercase tracking-[0.14em] mb-1 block" style={{ color: 'var(--text-soft)' }}>נושא</span>
              <input value={msgSubject} onChange={e => setMsgSubject(e.target.value)} className="input w-full" style={{ padding: '10px 14px', fontSize: '14px' }} placeholder="נושא ההודעה..." />
            </label>
            <label className="block mb-5">
              <span className="mono text-[11px] uppercase tracking-[0.14em] mb-1 block" style={{ color: 'var(--text-soft)' }}>תוכן</span>
              <textarea value={msgBody} onChange={e => setMsgBody(e.target.value)} rows={5} className="input w-full" style={{ padding: '10px 14px', fontSize: '14px', resize: 'vertical' }} placeholder="תוכן ההודעה..."/>
            </label>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowMsgModal(false)} className="btn">ביטול</button>
              <button
                onClick={() => {
                  const emails = Array.from(selectedIds)
                    .map(id => all.find(c => c.id === id)?.email)
                    .filter(Boolean) as string[];
                  const missing = Array.from(selectedIds)
                    .map(id => all.find(c => c.id === id))
                    .filter(c => c && !c.email)
                    .map(c => c!.name);
                  if (emails.length === 0) {
                    showToast('לאף אחד מהנבחרים אין מייל רשום', 'error');
                    return;
                  }
                  const bcc = emails.join(',');
                  openMailto(`mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(msgSubject)}&body=${encodeURIComponent(msgBody)}`);
                  if (missing.length > 0) {
                    showToast(`נפתח Outlook ל‑${emails.length} נמענים · ללא מייל: ${missing.join(', ')}`, 'success');
                  } else {
                    showToast(`✓ נפתח Outlook ל‑${emails.length} נמענים`, 'success');
                  }
                  setShowMsgModal(false);
                  setMsgSubject(''); setMsgBody('');
                  setSelectedIds(new Set());
                }}
                style={btnPrimary()}
              >
                📧 פתח ב‑Outlook
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        {filtered.length === 0 ? (
          <div className="py-24 text-center">
            <div className="serif text-[26px]" style={{ color: 'var(--ink)' }}>אין מועמדים להצגה</div>
            <div className="mt-3 text-[14px]" style={{ color: 'var(--text-soft)' }}>הוסף חדש או שנה סינון.</div>
          </div>
        ) : (
          <ul>
            {filtered.map(c => (
              <CandidateRow
                key={c.id}
                c={c}
                onEdit={() => setEditing(c)}
                pinned={pinnedId === c.id}
                onTogglePin={() => setPinnedId(pinnedId === c.id ? null : c.id)}
                selected={selectedIds.has(c.id)}
                onToggleSelect={() => {
                  const next = new Set(selectedIds);
                  next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                  setSelectedIds(next);
                }}
                onRevert={() => handleRevertToSubmission(c)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Email confirmation modal — shown before any email is sent ── */}
      {emailConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(26,22,18,0.6)' }}>
          <div className="rounded-2xl border p-8 max-w-[560px] w-full mx-4" style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
            {/* Header */}
            <div className="flex items-baseline justify-between mb-1">
              <div className="serif text-[24px]" style={{ color: 'var(--ink)' }}>
                {emailConfirm.type === 'acceptance' ? '✉ הודעת קבלה' : '✉ הודעת דחייה'}
              </div>
              <button onClick={() => setEmailConfirm(null)} className="mono text-[11px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100" style={{ color: 'var(--ink)' }}>✕</button>
            </div>
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-5" style={{ color: 'var(--text-soft)' }}>
              {emailConfirm.type === 'acceptance' ? 'הודעת קבלה לפרקטיקום' : 'הודעת אי-קבלה לפרקטיקום'} — בדוק/י לפני שליחה
            </div>

            {/* Recipients */}
            <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--divider)' }}>
              <div className="mono text-[10px] uppercase tracking-[0.15em] mb-2 font-semibold" style={{ color: 'var(--text-soft)' }}>
                שולחים ל‑{emailConfirm.recipients.length} נמענים
              </div>
              <div className="text-[13px] leading-[1.7]" style={{ color: 'var(--ink)' }}>
                {emailConfirm.recipients.map(r => r.name).join(' · ')}
              </div>
              {emailConfirm.recipients.length > 1 && (
                <div className="mono text-[10.5px] mt-2" style={{ color: 'var(--text-soft)' }}>
                  {`ⓘ תיפתח טיוטה נפרדת לכל נמען (${emailConfirm.recipients.length}) — השם והקישור האישי ימולאו אוטומטית. הטיוטות נפתחות אחת בכל פעם בלחיצה.`}
                </div>
              )}
            </div>

            {/* Subject */}
            <label className="block mb-3">
              <span className="mono text-[11px] uppercase tracking-[0.14em] mb-1 block" style={{ color: 'var(--text-soft)' }}>נושא</span>
              <input
                value={emailConfirm.subject}
                onChange={e => setEmailConfirm(prev => prev ? { ...prev, subject: e.target.value } : null)}
                className="input w-full"
                style={{ padding: '10px 14px', fontSize: '14px' }}
              />
            </label>

            {/* Body */}
            <label className="block mb-2">
              <span className="mono text-[11px] uppercase tracking-[0.14em] mb-1 block" style={{ color: 'var(--text-soft)' }}>תוכן</span>
              <textarea
                value={emailConfirm.body}
                onChange={e => setEmailConfirm(prev => prev ? { ...prev, body: e.target.value } : null)}
                rows={7}
                className="input w-full"
                style={{ padding: '10px 14px', fontSize: '13.5px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
              />
            </label>
            <div className="mono text-[10.5px] mb-3" style={{ color: 'var(--text-soft)' }}>
              {'ⓘ ניתן לערוך נושא ותוכן. {{שם}} ו{{קישור_קוח}} מוחלפים פר נמען בשמו ובקישור האישי שלו.'}
            </div>
            {emailConfirm.type === 'acceptance' && emailConfirm.body.includes('⚠️ תאריך טרם נקבע') && (
              <div className="mono text-[11px] mb-4 px-3 py-2 rounded-lg" style={{ background: 'rgba(200,100,0,0.08)', border: '1px solid rgba(200,100,0,0.25)', color: '#b85c00' }}>
                ⚠️ תאריך סדנה לא הוגדר לקורס זה — עדכן אותו בניהול → קורסים לפני שליחה, או ערוך ידנית את השדה למעלה.
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-between items-center">
              <button onClick={() => setEmailConfirm(null)} style={{ ...btnSecondary(), fontSize: '12px' }}>
                ביטול — אל תשלח
              </button>
              <button
                onClick={sendConfirmedEmail}
                style={{ ...btnPrimary(), fontSize: '13px' }}
              >
                📧 פתח ב‑Outlook ({emailConfirm.recipients.length}) →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Per-recipient draft queue — open each personalized draft on its own click ── */}
      {draftQueue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(26,22,18,0.6)' }}>
          <div className="rounded-2xl border p-7 max-w-[460px] w-full mx-4" style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
            <div className="serif text-[22px] mb-1.5" style={{ color: 'var(--ink)' }}>פתיחת טיוטות — נמען אחר נמען</div>
            <div className="text-[12.5px] mb-3 leading-[1.6]" style={{ color: 'var(--text-soft)' }}>
              כדי שכל נמען יקבל את הקישור האישי הנכון, הטיוטות נפתחות אחת בכל פעם (פתיחה של כולן יחד גורמת ל‑Outlook לערבב ביניהן).
            </div>
            <div className="mb-4 p-2.5 rounded-lg text-[13px]" style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--divider)', color: 'var(--ink)' }}>
              ✓ נפתחו {draftQueue.index} מתוך {draftQueue.drafts.length} טיוטות
            </div>
            <button onClick={openNextDraft} style={{ ...btnPrimary(), width: '100%', fontSize: '13px' }}>
              📧 פתח טיוטה ל{draftQueue.drafts[draftQueue.index]?.name || ''} ({draftQueue.index + 1}/{draftQueue.drafts.length}) →
            </button>
            <button onClick={() => setDraftQueue(null)} style={{ ...btnSecondary(), width: '100%', marginTop: '8px', fontSize: '12px' }}>
              עצור — אל תפתח את השאר
            </button>
          </div>
        </div>
      )}

      {(editing || creating) && (
        <CandidateEditor
          candidate={editing}
          courses={courses}
          years={years}
          defaultCourseId={context.courseId}
          defaultYear={context.year}
          onSave={handleSave}
          onDelete={editing ? handleDelete : undefined}
          onConvertToStudent={handleConvertToStudent}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </main>
  );
}

function CandidateRow({ c, onEdit, pinned, onTogglePin, selected, onToggleSelect, onRevert }: {
  c: Candidate; onEdit: () => void; pinned: boolean; onTogglePin: () => void;
  selected?: boolean; onToggleSelect?: () => void;
  onRevert?: () => void;
}) {
  const r = c.interviewResult || 'pending';
  const label = r === 'passed' ? 'עבר' : r === 'failed' ? 'לא התקבל' : 'ממתין';
  const isPass = r === 'passed';
  const hasDocs = !!(c.cvUrl && c.applicationUrl);
  const stage = c.convertedToStudentId ? 'הועבר לסטודנטים' :
                isPass ? 'עבר ראיון' :
                r === 'failed' ? 'לא התקבל' :
                c.interviewDate ? 'ממתין/ה לתוצאה' :
                hasDocs ? 'מסמכים הוגשו' : 'ממתין/ה למסמכים';

  const dotStatus: DotStatus =
    c.convertedToStudentId ? 'green' :  // converted to student → always green regardless of result
    r === 'failed' ? 'red' :
    r === 'passed' ? 'green' :
    hasDocs ? 'amber' :   // submitted both files → amber (visible, ready for interview)
    'gray';               // in list, hasn't submitted yet → gray

  return (
    <li className="relative group" data-info-row>
      <div onClick={onTogglePin}
        className="py-4 border-b cursor-pointer hover:bg-[rgba(122,30,43,0.02)]"
        style={{ borderColor: 'var(--divider)' }}>

        {/* Line 1: checkbox · dot · name · status badge */}
        <div className="flex items-center gap-2 min-w-0 mb-1.5">
          <label
            onClick={e => e.stopPropagation()}
            className="shrink-0 inline-flex items-center justify-center cursor-pointer"
            style={{ padding: '8px', margin: '-8px' }}
            title="בחר/בטל בחירה">
            <input type="checkbox" checked={!!selected}
              onChange={() => onToggleSelect?.()}
              className="w-4 h-4 rounded cursor-pointer" style={{ accentColor: 'var(--accent)' }} />
          </label>
          <StatusDot status={dotStatus} size={9} />
          <div className="serif text-[20px] leading-tight tracking-tight flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>
            {c.name || 'ללא שם'}
          </div>
          <span className="mono text-[10px] uppercase tracking-[0.13em] font-semibold shrink-0 px-2.5 py-1 rounded-full whitespace-nowrap"
            style={{ color: isPass ? 'var(--bg)' : 'var(--accent)', background: isPass ? 'var(--accent)' : 'rgba(122,30,43,0.08)' }}>
            {label}
          </span>
        </div>

        {/* Line 2: contact info · action icons */}
        <div className="flex items-center gap-2 pr-5" onClick={e => e.stopPropagation()}>
          <div className="text-[12.5px] flex flex-wrap gap-x-3 gap-y-0.5 flex-1 min-w-0" style={{ color: 'var(--text-soft)' }}>
            {c.phone && <span dir="ltr">{c.phone}</span>}
            {c.email && <span className="truncate" style={{ maxWidth: 'clamp(120px, 40vw, 220px)' }}>{c.email}</span>}
            {c.interviewDate && <span className="whitespace-nowrap">· {new Date(c.interviewDate).toLocaleDateString('he-IL')}</span>}
          </div>
          {onRevert && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRevert(); }}
              className="mono text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-1 rounded-full border opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              style={{ borderColor: 'var(--divider)', color: 'var(--text-soft)' }}
              title="החזר לתיבת ההגשות">
              ↩ הגשות
            </button>
          )}
          {c.interviewDate && (
            <span
              className="mono text-[10px] tracking-[0.06em] font-semibold shrink-0 px-2 py-1 rounded-lg whitespace-nowrap"
              style={{ background: 'rgba(122,30,43,0.07)', color: 'var(--accent)' }}
              title="מועד ראיון">
              📅 {new Date(c.interviewDate).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}
              {c.interviewTime && <span dir="ltr"> · {c.interviewTime.split(/[-–]/)[0]}</span>}
            </span>
          )}
          <RowActions
            phone={c.phone}
            email={c.email}
            name={c.name}
            onEdit={onEdit}
          />
        </div>
      </div>

      <Popover pinned={pinned} onRequestClose={onTogglePin}>
        <div className="flex items-baseline justify-between gap-3 pb-3 mb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
          <div>
            <div className="serif text-[22px] leading-[1.15]" style={{ color: 'var(--ink)' }}>{c.name}</div>
            <div className="mono text-[10.5px] uppercase tracking-[0.14em] mt-1" style={{ color: 'var(--accent)' }}>
              שלב: {stage}
            </div>
          </div>
          {pinned && <button type="button" onClick={onTogglePin} title="סגור" className="shrink-0 grid place-items-center w-7 h-7 rounded-full border mono text-[12px] font-semibold opacity-70 hover:opacity-100" style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>✕</button>}
        </div>
        <div className="space-y-1.5 text-[13px]">
          <DetailRowC label="טלפון" value={c.phone} />
          <DetailRowC label="מייל" value={c.email} />
          <DetailRowC label="שנה" value={c.year} />
          <DetailRowC label="CV" value={c.cvUrl ? '✓ הוגש' : '—'} />
          <DetailRowC label="טופס" value={c.applicationUrl ? '✓ הוגש' : '—'} />
          <DetailRowC label="ראיון" value={c.interviewDate ? new Date(c.interviewDate).toLocaleDateString('he-IL') : 'לא נקבע'} />
          <DetailRowC label="תוצאה" value={label} accent={isPass || r === 'failed'} />
          {c.evalScore != null && <DetailRowC label="ציון" value={String(c.evalScore)} accent={c.evalScore >= 85} />}
          {c.interviewSummary && <DetailRowC label="סיכום" value={c.interviewSummary} />}
        </div>

        {(c.email || c.name) && (
          <div className="pt-3 mt-3 border-t" style={{ borderColor: 'var(--divider)' }}>
            <div className="mono text-[10.5px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--accent)' }}>
              קישורים אישיים
            </div>
            <PersonalLinksC email={c.email} name={c.name} />
          </div>
        )}
      </Popover>
    </li>
  );
}

function PersonalLinksC({ email, name }: { email?: string | null; name?: string | null }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const cvLink = `${origin}/cv-update/?email=${encodeURIComponent(email || '')}&name=${encodeURIComponent(name || '')}`;
  const orgsLink = `${origin}/organizations`;

  async function copy(url: string, label: string) {
    try {
      await navigator.clipboard.writeText(url);
      showToast(`✓ הקישור ל${label} הועתק`, 'success');
    } catch {
      showToast('שגיאה בהעתקה', 'error');
    }
  }

  return (
    <div className="space-y-2">
      <LinkRowC label="קו״ח אישי" url={cvLink} onCopy={() => copy(cvLink, 'קו״ח')} />
      <LinkRowC label="ארגונים" url={orgsLink} onCopy={() => copy(orgsLink, 'ארגונים')} />
    </div>
  );
}

function LinkRowC({ label, url, onCopy }: { label: string; url: string; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="mono text-[10px] uppercase tracking-[0.13em] font-semibold w-16 shrink-0" style={{ color: 'var(--text-soft)' }}>{label}</span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-[12px] flex-1 min-w-0 truncate underline" style={{ color: 'var(--accent)' }} dir="ltr">{url}</a>
      <button type="button" onClick={onCopy} className="mono text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-1 rounded-md border shrink-0 hover:opacity-80" style={{ borderColor: 'var(--divider)', color: 'var(--text-soft)' }}>העתק</button>
    </div>
  );
}

function DetailRowC({ label, value, accent }: { label: string; value?: string | null; accent?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-3">
      <span className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold w-20 shrink-0" style={{ color: 'var(--text-soft)' }}>{label}</span>
      <span style={{ color: accent ? 'var(--accent)' : 'var(--ink)' }}>{value}</span>
    </div>
  );
}
