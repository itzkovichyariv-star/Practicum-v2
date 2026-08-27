import { useMemo, useState } from 'react';
import { btnPrimary, btnSmall, btnSecondary } from '../lib/design';
import { supabase } from '../lib/supabase';
import type { Candidate } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear, outlookCalendarUrl } from './pageShared';
import { saveSnapshot, randomId } from '../lib/dataApi';
import { showToast } from '../lib/toast';
import { markNotesCancelled } from '../lib/submissions';
import type { Student } from '../lib/supabase';
import CandidateEditor from './CandidateEditor';
import { Popover, RefreshButton, StatusDot, contactBtn, contactStyle, type DotStatus } from './StudentsPage';
import { WhatsAppIcon, MailIcon, PhoneIcon } from './icons';
import SubmissionsInbox from './SubmissionsInbox';
import ExcelImport from './ExcelImport';
// Two acceptance-email channels:
//   - Outlook draft (mailto:) — manual review, default for all courses
//   - Resend HTML (Edge Function) — auto-send when course.autoSendAcceptance=true
import { openMailto } from '../lib/openMailto';
import { sendAcceptanceEmail } from '../lib/emailApi';
import { viewableCvUrl, openCv } from '../lib/cvUrl';
import CandidateStrip from './CandidateStrip';
import type { CandidateAction } from '../lib/candidateStatus';

const normName = (n: string) => (n || '').trim().replace(/\s+/g, ' ').toLowerCase();

// The enrolment rule lives in lib/candidateStatus so it can be unit-tested without
// importing this component tree. Re-exported here because this module has been its
// public home since it was written, and the dashboard imports it by that name.
export { findStudentForCandidate, isArchivedCandidate } from '../lib/candidateStatus';
import { isArchivedCandidate } from '../lib/candidateStatus';

/**
 * The candidate a submission already belongs to, or undefined.
 *
 * Exported so the intake and the inbox's "this was taken in but has no card"
 * warning ask the SAME question. Two copies of this rule would drift, and the
 * warning would then accuse the intake of losing people it had actually filed.
 *
 * Email first because it is the identifier a person owns; exact name second,
 * for the re-intake of someone typed in by hand.
 */
export function findCandidateForSubmission(
  candidates: Candidate[],
  sub: { email?: string | null; name?: string | null },
): Candidate | undefined {
  const email = (sub.email || '').trim().toLowerCase();
  if (email) {
    const byEmail = candidates.find(c => (c.email || '').trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const name = normName(sub.name || '');
  return name ? candidates.find(c => normName(c.name) === name) : undefined;
}

/** Did this person actually apply?
 *
 *  This used to read `cvUrl && applicationUrl` — two FILES — and was therefore
 *  false for every single real candidate, so every dot was grey and «הגישו
 *  מסמכים» counted 0 forever. Yariv 2026-08-13: "בכל מקרה מוגש מה שביקשנו —
 *  טופס הגשה וקורות חיים ולכן זה צריך להיות כתום, כשלמעשה אין אפור."
 *
 *  He is right, and the cause is that the second file does not exist. The public
 *  form collects a CV **and a questionnaire** — `RegistrationForm` literally
 *  sends `application_file_path: null` — and the questionnaire IS the הגשה form;
 *  it is required, so nobody reaches the candidates list without one.
 *
 *  So the test is evidence of a submission, in any of the forms it can take,
 *  rather than a file that is never written. Grey survives only for a candidate
 *  typed in by hand with nothing attached — which is a real state, and the one
 *  case where "טרם הגיש/ה" is actually true. */
export const hasSubmitted = (c: Candidate): boolean =>
  !!(c.cvUrl || c.applicationUrl || c.questionnaire || c.submittedAt);

export default function CandidatesPage({ data, context, userName, onRefresh }: PageProps) {
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<'all' | 'pending' | 'conducted' | 'passed' | 'failed' | 'submitted' | 'notsubmitted'>('all');
  // Archive = candidates who already became students. They stay in the data —
  // the candidacy file is their single source of truth — but they leave the
  // working list, because the question this page answers is "who still needs
  // handling". Off by default; the toggle only renders when the archive is
  // non-empty. Yariv 2026-08-11: they used to sit here with a green dot,
  // indistinguishable from a candidate still waiting on him.
  const [showArchive, setShowArchive] = useState(false);
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

ברכות חמות! אנו שמחים לבשר כי עברת בהצלחה את ראיון הקבלה לתכנית הפרקטיקום במשאבי אנוש, אוניברסיטת אריאל.

📌 השלבים הקרובים:

1. סדנת הכנה לפרקטיקום
הסדנה תתקיים בתאריך {{תאריך_סדנה}}. פרטים נוספים יישלחו בנפרד.

2. הגשת קורות חיים ובחירת ארגון
לאחר הסדנה אתה/את מתבקש/ת להעלות קורות חיים מעודכנים ולציין את העדפותיך לארגון — הכל דרך הקישור המצורף:
{{קישור_קוח}}

תהליך השיבוץ יחל רק לאחר הגשת קורות החיים המעודכנים והעדפותיך — אנא הקפד/י לבצע זאת בסמוך לסיום הסדנה.

⚠️ אנא אל תעשה שימוש בקישור לפני סיום סדנת ההכנה. רשימת הארגונים הקיימת בקישור אינה מעודכנת בשלב זה. היא תתעדכן עד לסיום הסדנה.

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
  // their own /cv-update + /organizations links prefilled.
  function buildDraftUrl(r: { name: string; email: string }, subject: string, body: string): string {
    const cvLink = `${window.location.origin}/cv-update/?email=${encodeURIComponent(r.email)}&name=${encodeURIComponent(r.name)}`;
    // Personalised per recipient (same as the Resend/notify-acceptance path): the
    // organizations page identifies the student from ?email= and shows ONLY their
    // own course's approved orgs. A bare /organizations link shows them nothing.
    const orgsLink = `${window.location.origin}/organizations?email=${encodeURIComponent(r.email)}`;
    const personalBody = body
      .replace(/\{\{שם\}\}/g, r.name || '')
      .replace(/\{\{קישור_קוח\}\}/g, cvLink)
      .replace(/\{\{קישור_ארגונים\}\}/g, orgsLink);
    return `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(personalBody)}`;
  }

  function sendConfirmedEmail() {
    if (!emailConfirm) return;
    const { type, recipients, subject, body } = emailConfirm;

    // One personalized draft per recipient. We open the FIRST now (inside this
    // click's gesture) and hand the rest to the draft queue, which opens them
    // one-at-a-time on their own clicks. Opening them all in a synchronous loop
    // makes the OS mail app race so every window gets the LAST recipient — the
    // exact "two drafts, same person" bug this replaces.
    const drafts: Draft[] = recipients.map(r => ({ name: r.name, email: r.email, url: buildDraftUrl(r, subject, body) }));
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
  const students: Student[] = (data.students || []) as Student[];
  const courses = data.courses || [];

  const years = useMemo(() => {
    const set = new Set<string>();
    courses.forEach(c => c.year && set.add(normalizeYear(c.year)));
    all.forEach(c => c.year && set.add(normalizeYear(c.year)));
    (data.academicYears || []).forEach(y => set.add(normalizeYear(y)));
    return Array.from(set).sort().reverse();
  }, [courses, all, data.academicYears]);

  const scoped = useMemo(() => all.filter(c => sameContext(c, context, courses)), [all, context, courses]);

  // A candidate is archived once a student record exists for them.
  const archivedCount = useMemo(() => scoped.filter(c => isArchivedCandidate(c, students)).length, [scoped, students]);
  // The pool every count and filter below works on. Hiding the archive is not a
  // filter on top of the others — it changes what "all" means, so the ramzor
  // tabs keep agreeing with the list they sit above in both states.
  const pool = useMemo(
    () => (showArchive ? scoped : scoped.filter(c => !isArchivedCandidate(c, students))),
    [scoped, showArchive, students],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pool.filter(c => {
      const hasDocs = hasSubmitted(c);
      const result = c.interviewResult || 'pending';
      if (stage === 'submitted') return hasDocs;
      if (stage === 'notsubmitted') return !hasDocs && result === 'pending' && !c.interviewConducted;
      // "ראיון בוצע" = the interview happened and a pass/fail decision is still pending.
      if (stage === 'conducted') return !!c.interviewConducted && result === 'pending';
      // "ממתינים" = awaiting the interview — must EXCLUDE those already marked
      // "ראיון בוצע" (conducted, decision pending), so the two are separate buckets.
      if (stage === 'pending') return result === 'pending' && !c.interviewConducted;
      if (stage !== 'all' && result !== stage) return false;
      if (!q) return true;
      const hay = [c.name, c.phone, c.email].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  }, [pool, search, stage]);

  const counts = useMemo(() => ({
    total: pool.length,
    pending: pool.filter(c => (!c.interviewResult || c.interviewResult === 'pending') && !c.interviewConducted).length,
    conducted: pool.filter(c => c.interviewConducted && (!c.interviewResult || c.interviewResult === 'pending')).length,
    passed: pool.filter(c => c.interviewResult === 'passed').length,
    failed: pool.filter(c => c.interviewResult === 'failed').length,
    submitted: pool.filter(hasSubmitted).length,
    notsubmitted: pool.filter(c => !hasSubmitted(c) && (!c.interviewResult || c.interviewResult === 'pending')).length,
  }), [pool]);

  async function persistAndRefresh(next: Candidate[], msg: string, activity?: { action: string; entity: string; target: string }) {
    setSaving(true); setSaveMsg(null);
    const res = await saveSnapshot({ ...data, candidates: next }, { name: userName }, activity);
    setSaving(false);
    if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
    setSaveMsg(msg);
    showToast(msg + ' · נשמר בענן ☁️', 'success');
    (data.candidates as Candidate[]) = next;
    onRefresh();
    setTimeout(() => setSaveMsg(null), 2500);
  }

  // Silent debounced auto-save from the candidate editor (live interview notes).
  // Persists without a toast or refresh so it doesn't disrupt the open card; the
  // editor shows its own "נשמר ☁️" indicator. No auto-convert / validation — a
  // plain draft persist (the explicit save still enforces the pipeline rules).
  async function handleCandidateAutoSave(c: Candidate) {
    const idx = all.findIndex(x => x.id === c.id);
    if (idx < 0) return; // only existing candidates
    const next = [...all];
    next[idx] = c;
    const res = await saveSnapshot({ ...data, candidates: next }, { name: userName });
    if (!res.ok) throw new Error(res.error || 'save failed');
    (data.candidates as Candidate[]) = next;
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

      // Acceptance email — auto-send via Resend if the course opted in,
      // otherwise open the Outlook-draft confirmation modal (default).
      if (c.email) {
        const course = courses.find(co => co.id === c.courseId);
        if (course?.autoSendAcceptance === true) {
          showToast('שולח מייל קבלה אוטומטית…', 'info');
          const result = await sendAcceptanceEmail({
            name: c.name,
            email: c.email,
            courseId: c.courseId,
          });
          if (result.ok) {
            // Persist acceptanceEmailSent: true so the candidate card shows the
            // ✉ קבלה chip and we don't re-send on a subsequent edit.
            const sentIdx = nextCandidates.findIndex(x => x.id === updatedCand.id);
            if (sentIdx >= 0) {
              const withSent = [...nextCandidates];
              withSent[sentIdx] = { ...withSent[sentIdx], acceptanceEmailSent: true };
              await persistAndRefresh(withSent, '✉ מייל קבלה נשלח אוטומטית');
            } else {
              showToast('✉ מייל קבלה נשלח אוטומטית', 'success');
            }
          } else {
            // Resend send failed — fall back to manual Outlook draft so the
            // candidate doesn't go without any notification.
            showToast(`שליחה אוטומטית נכשלה (${result.error || 'תקלה'}) — נפתחה טיוטת Outlook`, 'error');
            openEmailConfirm('acceptance', [{ id: updatedCand.id, name: c.name, email: c.email }]);
          }
        } else {
          openEmailConfirm('acceptance', [{ id: updatedCand.id, name: c.name, email: c.email }]);
        }
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

  /** The strip proposes; the page disposes. Each action routes to the flow that
   *  already owns it — no action invents a new path to a state the card can already
   *  reach, which is what would let the two drift apart.
   *
   *  collect_docs / book_interview / mark_conducted / decide all open the card,
   *  because the card is where those fields live. That is not a stub: the value of
   *  the strip is knowing WHICH of them is the next thing, on a list of 80 people. */
  function handleStripAction(c: Candidate, action: CandidateAction) {
    switch (action.id) {
      case 'convert':
        handleConvertToStudent(c);
        return;
      case 'send_acceptance':
      case 'send_rejection': {
        if (!c.email) { showToast(`אין כתובת מייל ל‑${c.name}`, 'error'); return; }
        openEmailConfirm(action.id === 'send_acceptance' ? 'acceptance' : 'rejection',
          [{ id: c.id, name: c.name, email: c.email }]);
        return;
      }
      default:
        setEditing(c);
    }
  }

  async function handleDelete(id: string) {
    const c = all.find(x => x.id === id);
    setEditing(null);
    await persistAndRefresh(all.filter(x => x.id !== id), '✓ נמחק',
      { action: 'מחיקה', entity: 'מועמד', target: c?.name || id });
  }

  /**
   * Take a submission into the candidates list.
   *
   * RETURNS the outcome, and that is the point: the inbox stamps a submission
   * "נקלט" only when this says ok. It used to return nothing and report failure
   * as a toast, so the stamp went on regardless — leaving a submission marked
   * taken-in with no candidate behind it, and no way to retry from the screen.
   */
  async function handleAcceptSubmissionIntoCandidates(sub: any): Promise<{ ok: boolean; error?: string }> {
    // Find course by name+year; fall back to name-only if year doesn't match
    const subYear = sub.year || '';
    const nameMatch = (c: typeof courses[0]) =>
      (c.name || '').replace(/\s+/g, '').toLowerCase() === (sub.course_name || '').replace(/\s+/g, '').toLowerCase();
    const course =
      courses.find(c => nameMatch(c) && normalizeYear(c.year || '') === normalizeYear(subYear)) ||
      courses.find(c => nameMatch(c));
    if (!course && sub.course_name) console.warn('[intake] no course match for', sub.course_name, sub.year, '→ defaulting to', courses[0]?.name);
    // Parse booked slot out of notes (format: "בחר מועד ראיון: YYYY-MM-DD HH:MM–HH:MM")
    const slotMatch = (sub.notes || '').match(/בחר מועד ראיון:\s*(\d{4}-\d{2}-\d{2})\s*(\d{1,2}:\d{2}(?:[–\-]\d{1,2}:\d{2})?)/);
    const interviewDate = slotMatch?.[1] || '';
    const interviewTime = slotMatch?.[2] || '';

    // ── Always read candidates fresh from Supabase ───────────────────────────
    // Prevents race condition: onRefresh() from a previous intake may complete
    // AFTER the next intake begins, causing the app to regress to a stale list
    // and then overwrite a recently-saved candidate on the next save.
    // If that read FAILS we must stop. `|| []` on a failed read used to leave
    // currentCandidates empty, and the save below would then write a candidates
    // list containing only this one person — silently deleting everybody else.
    // A refused intake costs a click; a wiped list costs the year.
    const { data: freshRow, error: freshErr } = await supabase
      .from('practicum_data')
      .select('data')
      .eq('org_id', 'default')
      .single();
    if (freshErr || !freshRow) {
      const msg = freshErr?.message || 'לא ניתן לקרוא את רשימת המועמדים';
      showToast(`הקליטה בוטלה — ${msg}`, 'error');
      return { ok: false, error: msg };
    }
    const currentCandidates: Candidate[] = (freshRow as any)?.data?.candidates || [];
    const matched = findCandidateForSubmission(currentCandidates, sub);
    const subLastToken = normName(sub.name).split(' ').pop() || '';
    const bySimilarName = !matched && subLastToken.length > 2
      ? currentCandidates.find((c: Candidate) => {
          const t = normName(c.name).split(' ').pop() || '';
          return t === subLastToken && normName(c.name) !== normName(sub.name);
        })
      : undefined;

    let existingRecord: Candidate | undefined = matched;
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
        // Carry the submitted application form (questionnaire) onto the existing
        // record too — the new-candidate branch already does, but this update
        // branch was dropping it, so a re-intake onto a matched candidate lost it.
        questionnaire: sub.questionnaire || existingRecord.questionnaire || null,
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
      if (!res.ok) {
        showToast('שגיאה בשמירה: ' + (res.error || 'לא ידוע'), 'error');
        return { ok: false, error: res.error || 'save failed' };
      }
      (data.candidates as Candidate[]) = nextCandidates;
      onRefresh();
      showToast(`✓ עודכן מועמד קיים: ${existingRecord.name}`, 'success');
      return { ok: true };
    } else {
      // Create new candidate
      const newCandidate: Candidate = {
        id: randomId('cand'),
        name: sub.name,
        phone: sub.phone || '',
        email: sub.email || '',
        city: sub.city || '',
        courseId: course?.id || (courses[0]?.id || ''),
        // Year comes from the RESOLVED course (never the submission independently),
        // so courseId and year can't drift apart.
        year: normalizeYear((course || courses[0])?.year || sub.year || 'תשפ״ז'),
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
      if (!res.ok) {
        showToast('שגיאה בשמירה: ' + (res.error || 'לא ידוע'), 'error');
        return { ok: false, error: res.error || 'save failed' };
      }
      (data.candidates as Candidate[]) = nextCandidates;
      onRefresh();
      showToast(`✓ נקלט מועמד חדש: ${sub.name}`, 'success');
      return { ok: true };
    }
  }

  /**
   * A candidate withdraws.
   *
   * Booking a slot adds one to booked_count and writes the name on it. Until now
   * nothing ever subtracted — there was no −1 anywhere in the system — so a
   * withdrawal left the time occupied by someone who was not coming, and the only
   * way to reopen it was to delete the slot in ניהול and build it again by hand.
   *
   * The slot is released FIRST and everything stops if that fails. The order is
   * deliberate: the state worth avoiding is a deleted candidate whose slot is
   * still held, which is exactly the mess this exists to clear.
   *
   * The slot is identified by day, start time and the name it was booked under.
   * A candidate stores their interview time as free text, not as a reference to
   * the row, so this is a match rather than a lookup — and when more than one row
   * fits, it refuses and says so instead of guessing. Releasing the wrong slot
   * would let two people book the same interview.
   */
  async function handleCancelInterview(c: Candidate) {
    const day = (c.interviewDate || '').slice(0, 10);
    const startTime = (c.interviewTime || '').split(/[-–]/)[0].trim().slice(0, 5);

    const { data: rows, error: readErr } = await supabase
      .from('public_interview_slots')
      .select('id, date, start_time, end_time, capacity, booked_count, booked_by')
      .eq('date', day);
    if (readErr) {
      showToast('לא ניתן לקרוא את מועדי הראיון: ' + readErr.message, 'error');
      return;
    }

    const held = (rows || []).filter((r: any) => (r.booked_count || 0) > 0);
    const byTime = startTime
      ? held.filter((r: any) => String(r.start_time || '').slice(0, 5) === startTime)
      : held;
    const byName = byTime.filter((r: any) => normName(r.booked_by || '') === normName(c.name));
    const match: any = byName.length === 1 ? byName[0] : (byTime.length === 1 ? byTime[0] : null);
    const ambiguous = !match && byTime.length > 1;

    const lost: string[] = [];
    if (c.interviewConducted) lost.push('סימון "ראיון בוצע"');
    if (c.evalScore != null || c.evalEnglish || c.evalMotivation || c.evalCommunication || c.evalCommitment || c.evalAcquaintance) lost.push('ציוני ההערכה');
    if (c.interviewSummary) lost.push('סיכום הראיון');
    if (c.interviewResult === 'passed' || c.interviewResult === 'failed') lost.push('תוצאת הראיון');

    const slotLine = match
      ? `• המשבצת ${day} ${String(match.start_time).slice(0, 5)}–${String(match.end_time).slice(0, 5)} תשוחרר ותהיה פנויה להרשמה`
      : ambiguous
        ? `• ⚠️ נמצאו ${byTime.length} משבצות תפוסות באותו מועד — לא ניתן לזהות איזו שייכת ל${c.name}, ולכן אף אחת לא תשוחרר. שחרור ידני: ניהול → מועדי ראיון`
        : `• לא נמצאה משבצת תפוסה בתאריך ${day || '—'} — ייתכן שכבר שוחררה`;

    const warning =
      `לבטל את הראיון של ${c.name}?\n\n` +
      `${slotLine}\n` +
      `• ההגשה תסומן כמבוטלת (הקבצים יישמרו)\n` +
      `• כרטיס המועמד/ת יימחק` +
      (lost.length ? `, והנתונים הבאים יימחקו:\n  · ${lost.join('\n  · ')}` : '') +
      `\n\n(שחזור אפשרי מגיבויי המערכת — מסך ניהול → גרסאות)`;
    if (!confirm(warning)) return;

    // ── 1. Release the slot, guarded ──────────────────────────────────────────
    // The write only lands if booked_count is still what we read. If someone
    // booked in the meantime the update matches nothing, and we stop rather than
    // overwrite their booking with a stale number.
    if (match) {
      const next = Math.max(0, (match.booked_count || 0) - 1);
      const { data: updated, error: relErr } = await supabase
        .from('public_interview_slots')
        .update({ booked_count: next, booked_by: null })
        .eq('id', match.id)
        .eq('booked_count', match.booked_count)
        .select('id');
      if (relErr) {
        showToast('שחרור המשבצת נכשל — הביטול הופסק: ' + relErr.message, 'error');
        return;
      }
      if (!updated || updated.length === 0) {
        showToast('המשבצת השתנתה באותו רגע — הביטול הופסק. נסה/י שוב', 'error');
        return;
      }
    }

    // ── 2. Mark the submission cancelled (best effort) ────────────────────────
    // Failing here is not worth aborting an already-released slot for; it only
    // means the inbox shows her as taken-in-without-a-card until someone tidies.
    const today = new Date().toISOString().slice(0, 10);
    let subRow: any = null;
    if (c.email) {
      const { data } = await supabase.from('candidate_submissions')
        .select('id, notes').ilike('email', c.email).order('submitted_at', { ascending: false }).limit(1);
      subRow = data?.[0] || null;
    }
    if (!subRow && c.name) {
      const { data } = await supabase.from('candidate_submissions')
        .select('id, notes').ilike('name', c.name).order('submitted_at', { ascending: false }).limit(1);
      subRow = data?.[0] || null;
    }
    if (subRow) {
      await supabase.from('candidate_submissions')
        .update({ notes: markNotesCancelled(subRow.notes, today) })
        .eq('id', subRow.id);
    }

    // ── 3. Remove the candidate ───────────────────────────────────────────────
    await persistAndRefresh(all.filter(x => x.id !== c.id),
      match ? '✓ הראיון בוטל והמשבצת שוחררה' : '✓ הראיון בוטל',
      { action: 'ביטול ראיון', entity: 'מועמד', target: c.name });
  }

  /**
   * A candidate who is not continuing and has NO interview booked.
   *
   * handleCancelInterview only exists for someone with a slot to release, so a candidate
   * who never booked one had no way off this list from the row at all — the only removal
   * was the 🗑 inside the card, and the row's one visible control sent her BACKWARDS to
   * the pre-intake inbox. Yariv, on רננה (2026-08-11): "החץ המעוקל מעביר אותה בחזרה
   * לתיבה לפני קליטה אז לא בטוח שזו הדרך הנכונה." He was right — that is a different act.
   *
   * Same ending as the interview path, minus the slot: the submission is marked cancelled
   * so the inbox agrees with the list, the files are kept, and the card goes.
   */
  async function handleLeaveNoInterview(c: Candidate) {
    if (!confirm(
      `${c.name} לא ממשיך/ה בתהליך?\n\n` +
      `• כרטיס המועמד/ת יימחק\n` +
      `• ההגשה תסומן כמבוטלת (הקבצים יישמרו)\n\n` +
      `(שחזור אפשרי מגיבויי המערכת — מסך ניהול → גרסאות)`)) return;

    const today = new Date().toISOString().slice(0, 10);
    let subRow: any = null;
    if (c.email) {
      const { data } = await supabase.from('candidate_submissions')
        .select('id, notes').ilike('email', c.email).order('submitted_at', { ascending: false }).limit(1);
      subRow = data?.[0] || null;
    }
    if (!subRow && c.name) {
      const { data } = await supabase.from('candidate_submissions')
        .select('id, notes').ilike('name', c.name).order('submitted_at', { ascending: false }).limit(1);
      subRow = data?.[0] || null;
    }
    if (subRow) {
      await supabase.from('candidate_submissions')
        .update({ notes: markNotesCancelled(subRow.notes, today) })
        .eq('id', subRow.id);
    }

    await persistAndRefresh(all.filter(x => x.id !== c.id),
      `✓ ${c.name} הוסר/ה מרשימת המועמדים`,
      { action: 'לא ממשיך/ה בתהליך', entity: 'מועמד', target: c.name });
  }

  async function handleRevertToSubmission(c: Candidate) {
    // ── Safety guard (2026-06-11, after עינה נוימן's interview data was lost) ──
    // Reverting DELETES the candidate card; re-intake rebuilds it from the bare
    // submission, so anything entered since intake is gone. Spell out exactly
    // what this candidate stands to lose and require explicit confirmation.
    const lost: string[] = [];
    if (c.interviewConducted) lost.push('סימון "ראיון בוצע"');
    if (c.evalScore != null || c.evalEnglish || c.evalMotivation || c.evalCommunication || c.evalCommitment || c.evalAcquaintance) lost.push('ציוני ההערכה');
    if (c.interviewSummary) lost.push('סיכום הראיון');
    if (c.interviewResult === 'passed' || c.interviewResult === 'failed') lost.push('תוצאת הראיון');
    if (c.preferredArea) lost.push('תחום מועדף');
    const warning =
      `להחזיר את ${c.name} לתיבת ההגשות?\n\n` +
      `⚠️ פעולה זו מוחקת את כרטיס המועמד/ת. בקליטה מחדש ייווצר כרטיס חדש מטופס ההרשמה בלבד` +
      (lost.length ? `, והנתונים הבאים יימחקו:\n• ${lost.join('\n• ')}` : '.') +
      `\n\n(שחזור אפשרי מגיבויי המערכת — מסך ניהול → גרסאות)`;
    if (!confirm(warning)) return;
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
    await persistAndRefresh(nextCandidates, `↩ ${c.name} הוחזר לתיבת ההגשות`,
      { action: 'החזרה להגשות', entity: 'מועמד', target: c.name });
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
      // Carry the submitted application form (questionnaire) so it travels with
      // the person into the student record and renders with its original design.
      questionnaire: c.questionnaire || null,
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

      <SubmissionsInbox
        onAcceptIntoCandidates={handleAcceptSubmissionIntoCandidates}
        hasCandidate={sub => !!findCandidateForSubmission(all, sub)}
      />

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
          ['conducted',    'ראיון בוצע',   counts.conducted,     'amber'],
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
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5 text-[12px]" style={{ color: 'var(--text-soft)' }}>
        {([
          ['green', 'עבר ראיון'],
          ['amber', 'הגיש/ה מסמכים'],
          ['gray',  'טרם הגיש/ה מסמכים'],
          ['red',   'לא התקבל/ה'],
        ] as const).map(([color, label]) => (
          <span key={color} className="flex items-center gap-1.5">
            <StatusDot status={color} size={7} />
            <span>{label}</span>
          </span>
        ))}
        {/* The archive switch lives with the legend because it answers the same
            question — what am I looking at. Hidden entirely when the archive is
            empty rather than shown reading "(0)", which is noise on a new course. */}
        {archivedCount > 0 && (
          <label
            className="mono text-[11px] uppercase tracking-[0.14em] font-semibold cursor-pointer flex items-center gap-2"
            style={{ color: showArchive ? 'var(--accent)' : 'var(--text-soft)' }}
            title="מועמדים שכבר הפכו לסטודנטים">
            <input
              type="checkbox"
              data-archive-toggle
              checked={showArchive}
              onChange={e => setShowArchive(e.target.checked)}
            />
            הצג ארכיון ({archivedCount})
          </label>
        )}
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
              // Solid/subtle outline: green outline = acceptance, wine outline = rejection.
              display: 'inline-block', padding: '7px 14px', fontSize: '12px', fontWeight: 600,
              background: 'transparent',
              color: stage === 'passed' ? '#15803d' : 'var(--accent)',
              border: `1px solid ${stage === 'passed' ? '#15803d' : 'var(--accent)'}`,
              borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
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
                enrolled={isArchivedCandidate(c, students)}
                onStripAction={a => handleStripAction(c, a)}
                onRevert={() => handleRevertToSubmission(c)}
                onLeaveProcess={() => (c.interviewDate ? handleCancelInterview(c) : handleLeaveNoInterview(c))}
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
          onAutoSave={editing ? handleCandidateAutoSave : undefined}
          onDelete={editing ? handleDelete : undefined}
          onConvertToStudent={handleConvertToStudent}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </main>
  );
}

function CandidateRow({ c, enrolled, onEdit, pinned, onTogglePin, selected, onToggleSelect, onRevert, onLeaveProcess, onStripAction }: {
  c: Candidate;
  /** Whether a student record already exists for this person. Computed once by the
   *  page against the whole students array — the row must not re-derive it, or the
   *  marker and the pool could disagree about the same candidate. */
  enrolled: boolean;
  onEdit: () => void; pinned: boolean; onTogglePin: () => void;
  selected?: boolean; onToggleSelect?: () => void;
  onRevert?: () => void;
  onStripAction?: (action: CandidateAction) => void;
  /** A candidate who is not continuing. Releases the interview slot when there is one,
   *  and removes the card either way — a candidate with no interview booked previously
   *  had no way off this list at all. */
  onLeaveProcess?: () => void;
}) {
  const r = c.interviewResult || 'pending';
  const conductedPending = !!c.interviewConducted && r === 'pending';
  const label = r === 'passed' ? 'עבר' : r === 'failed' ? 'לא התקבל' : conductedPending ? 'ראיון בוצע' : 'ממתין';
  const isPass = r === 'passed';
  const hasDocs = hasSubmitted(c);
  const stage = enrolled ? 'הועבר לסטודנטים' :
                isPass ? 'עבר ראיון' :
                r === 'failed' ? 'לא התקבל' :
                conductedPending ? 'ראיון בוצע — בהערכה' :
                c.interviewDate ? 'ממתין/ה לתוצאה' :
                hasDocs ? 'מסמכים הוגשו' : 'ממתין/ה למסמכים';

  const dotStatus: DotStatus =
    enrolled ? 'green' :  // a student record exists → always green regardless of result
    r === 'failed' ? 'red' :
    r === 'passed' ? 'green' :
    hasDocs ? 'amber' :   // applied — CV + questionnaire — so: visible, ready for interview
    'gray';               // no submission at all: typed in by hand with nothing attached

  const archived = enrolled;

  // Same three handlers the student row uses, so the two rows behave identically:
  // tel: on a touch device, copy-and-toast on desktop where tel: is a silent no-op.
  const canDial = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)')?.matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
  const candCall = (e: any) => {
    e.stopPropagation();
    if (!c.phone) return;
    const tel = c.phone.replace(/[^\d+]/g, '');
    if (canDial) { window.location.href = `tel:${tel}`; return; }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(c.phone).then(
        () => showToast(`📞 ${c.phone} · המספר הועתק`, 'success'),
        () => showToast(`📞 ${c.phone}`, 'info'),
      );
    } else { showToast(`📞 ${c.phone}`, 'info'); }
  };
  const candWa = (e: any) => {
    e.stopPropagation();
    if (!c.phone) return;
    let n = c.phone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}`, '_blank');
  };
  const candMail = (e: any) => {
    e.stopPropagation();
    if (!c.email) return;
    openMailto(`mailto:${c.email}?subject=${encodeURIComponent(`פרקטיקום — ${c.name || ''}`)}`);
  };

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

        {/* The status strip — the same architecture the student row uses: one sentence,
            whose turn it is, and the single next action, with the evaluation folded
            underneath. Yariv 2026-08-22: candidates "don't have a rich view that is
            similar to the one they have as students", and the data to fill one was
            already there (five evaluation scales, a score, a nine-question form) with
            nowhere to show it. It sits above the chips because on a list of eighty
            people the first question is always "which of these is mine to do now". */}
        <div className="pr-5" onClick={e => e.stopPropagation()}>
          <CandidateStrip candidate={c} enrolled={enrolled} onAction={onStripAction} />
        </div>

        {/* Line 2: the file chips — the two documents the candidacy turns on, open
            from the list instead of two clicks into the card. A chip that is filled
            is a link; a dashed, dimmed one says the file was never submitted. The
            archive marker rides the same line, because a row that is only "green"
            reads as a candidate who passed rather than one already enrolled. */}
        <div className="flex items-center gap-1.5 flex-wrap pr-5 mb-1.5" onClick={e => e.stopPropagation()}>
          {/* viewableCvUrl, never the raw value. Yariv 2026-08-26: "קורות חיים של
              עדי גורביץ לא נפתחות — נותן דף לבן". A stored CV is `storage://bucket/path`,
              which is not a URL a browser can follow at all, and even once resolved a
              .doc/.docx cannot render inline. Both land on a blank tab, which reads as
              "the file is missing" when the file is fine and only the link was wrong. */}
          <FileChip label="CV" url={viewableCvUrl(c.cvUrl)} fileRef={c.cvUrl} />
          {/* The הגשה form is a FILE only when someone attached one by hand. For
              everyone who came through the public form it is the questionnaire,
              which has no URL to open — so the chip opens the card, where
              QuestionnaireView already renders it. Same evidence the dot uses;
              they can never disagree. */}
          <FileChip label="טופס" url={viewableCvUrl(c.applicationUrl)} fileRef={c.applicationUrl}
            onOpen={!c.applicationUrl && c.questionnaire ? onEdit : undefined}
            openTitle="פתח/י את שאלון המועמדות בכרטיס" />
          {archived && (
            <span className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2.5 py-0.5 rounded-full shrink-0"
              style={{ color: 'var(--text-soft)', background: 'transparent', border: '1px solid var(--divider)' }}
              title="קיימת רשומת סטודנט/ית — השורה מוצגת מהארכיון">
              ↗ בארכיון
            </span>
          )}
        </div>

        {/* Line 3: contact info · action icons */}
        {/* wraps: the row gained a permanently-visible "לא ממשיך/ה" control when the
            hover-gating came off, and with everything `shrink-0` that pushed a 390px
            screen 3px wide. Wrapping costs a line on a narrow phone and keeps every
            control reachable, which is the point of removing the hover in the first place. */}
        <div className="flex items-center gap-2 pr-5 flex-wrap" onClick={e => e.stopPropagation()}>
          <div className="text-[12.5px] flex flex-wrap gap-x-3 gap-y-0.5 flex-1 min-w-0" style={{ color: 'var(--text-soft)' }}>
            {/* A phone number is one token to a human and useless broken across two
                lines ("058-" / "7778888"), so it never wraps — it is short and fixed
                width, and giving it the whole line costs nothing. The email is the
                opposite: long, variable, and readable truncated, so it is the one
                that gives way when the row is narrow. */}
            {c.phone && <span dir="ltr" className="whitespace-nowrap">{c.phone}</span>}
            {c.email && <span className="truncate" style={{ maxWidth: 'clamp(120px, 40vw, 220px)' }}>{c.email}</span>}
            {c.interviewDate && <span className="whitespace-nowrap">· {new Date(c.interviewDate).toLocaleDateString('he-IL')}</span>}
          </div>
          {/* NOT hover-gated. These were `opacity-0 group-hover:opacity-100`, which means
              they never appear on a phone — there is no hover — so on the device Yariv
              actually works on, the row offered no way to remove anyone. He hit it on
              רננה (2026-08-11): "לא רואה אפשרות למחוק אותה מרשימת המועמדים". The action
              existed and was invisible, which is worse than missing: it reads as absent. */}
          {onRevert && (
            <button
              type="button"
              data-revert-submission
              onClick={e => { e.stopPropagation(); onRevert(); }}
              className="mono text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-1 rounded-full border shrink-0"
              style={{ borderColor: 'var(--divider)', color: 'var(--text-soft)' }}
              title="החזר לתיבת ההגשות — לפני קליטה">
              ↩ הגשות
            </button>
          )}
          {onLeaveProcess && (
            <button
              type="button"
              data-cancel-interview
              onClick={e => { e.stopPropagation(); onLeaveProcess(); }}
              className="mono text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-1 rounded-full border shrink-0"
              style={{ borderColor: '#b45309', color: '#b45309' }}
              title={c.interviewDate
                ? 'המועמד/ת לא ממשיך/ה — משבצת הראיון תשוחרר והכרטיס יימחק'
                : 'המועמד/ת לא ממשיך/ה — הכרטיס יימחק'}>
              ✕ לא ממשיך/ה
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
          {/* The same three controls the student row renders — same component, same
              36px circle, same wine outline — instead of the emoji set RowActions
              gives the lecturers/trainers pages. */}
          {c.phone && (
            <button type="button" onClick={candCall} title="התקשר למועמד/ת" aria-label="התקשר למועמד/ת"
              className={contactBtn} style={contactStyle}><PhoneIcon size={16} /></button>
          )}
          {c.phone && (
            <button type="button" onClick={candWa} title="WhatsApp למועמד/ת" aria-label="WhatsApp למועמד/ת"
              className={contactBtn} style={contactStyle}><WhatsAppIcon size={16} /></button>
          )}
          {c.email && (
            <button type="button" onClick={candMail} title="מייל למועמד/ת" aria-label="מייל למועמד/ת"
              className={contactBtn} style={contactStyle}><MailIcon size={16} /></button>
          )}
          {/* title stays exactly "ערוך" — gate cells locate the editor by it. */}
          <button type="button" onClick={e => { e.stopPropagation(); onEdit(); }} title="ערוך" aria-label="ערוך / פתח כרטיס מועמד/ת"
            className="shrink-0 grid place-items-center w-9 h-9 rounded-md transition-colors hover:bg-[rgba(122,30,43,0.08)] active:scale-95"
            style={{ color: 'var(--accent)', background: 'transparent', border: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
      </div>

      <Popover pinned={pinned} onRequestClose={onTogglePin}>
        <div className="flex items-baseline justify-between gap-3 pb-3 mb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
          <div>
            {/* A name is user data and can be long; without a break rule it pushed the
                popover — and the page — past the screen. Same fix as the students list
                (2026-08-11); this is the candidates page's own copy of that popover. */}
            <div className="serif text-[22px] leading-[1.15]"
              style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>{c.name}</div>
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
  const orgsLink = `${origin}/organizations?email=${encodeURIComponent(email || '')}`;

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

/** One of the two candidacy documents, shown on the row itself.
 *  With a URL it is a real link that opens the file — `stopPropagation` keeps the
 *  click off the row, which would otherwise toggle the detail popover. Without
 *  one it is dashed and dimmed and is NOT a link, so "not submitted" is legible
 *  at a glance instead of being a dead control that looks clickable. */
function FileChip({ label, url, fileRef, onOpen, openTitle }: {
  label: string; url?: string | null; fileRef?: string | null; onOpen?: () => void; openTitle?: string;
}) {
  const base = 'mono text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2.5 py-0.5 rounded-full shrink-0';
  const filled = { color: 'var(--accent)', background: 'rgba(122,30,43,0.08)' } as const;
  // Submitted, but as something with no URL to open — the questionnaire. Looks
  // identical to a submitted file, because to the reader it IS one; the click
  // goes to the card instead of a download.
  if (!url && onOpen) {
    return (
      <button type="button" onClick={e => { e.stopPropagation(); onOpen(); }}
        className={`${base} hover:opacity-75`} title={openTitle || `פתח ${label}`}
        style={{ ...filled, border: 'none', cursor: 'pointer' }}>
        {label} ✓
      </button>
    );
  }
  if (!url) {
    return (
      <span className={base} title={`${label} — טרם הוגש`}
        style={{ color: 'var(--text-soft)', background: 'transparent', border: '1px dashed var(--divider)' }}>
        {label} —
      </span>
    );
  }
  // The href stays real — copy-link, middle-click and "open in new tab" all still work,
  // and it is what the chip degrades to if the script never runs. The CLICK goes through
  // openCv, which checks the object resolves and, when it does not, replaces what used
  // to be a blank tab with what actually went wrong.
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      onClick={e => { e.stopPropagation(); if (fileRef) { e.preventDefault(); void openCv(fileRef); } }}
      className={`${base} hover:opacity-75`} title={`פתח ${label}`}
      style={{ color: 'var(--accent)', background: 'rgba(122,30,43,0.08)' }}>
      {label} ✓
    </a>
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
