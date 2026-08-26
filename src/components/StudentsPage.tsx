import { useEffect, useMemo, useRef, useState } from 'react';
import { btnPrimary, btnSecondary, btnSmall } from '../lib/design';
import type { Student, Candidate, PracticumData } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear, groupByYearCourse } from './pageShared';
import { saveSnapshot, randomId } from '../lib/dataApi';
import { occupyAcceptedOrgSlot, releaseStudentSlots, setCourseCapacity } from '../lib/placement';
import { showToast } from '../lib/toast';
import StudentEditor from './StudentEditor';
import ExcelImport from './ExcelImport';
// email sending is via Outlook (mailto:) — no direct API imports needed
import { openMailto } from '../lib/openMailto';
import { WhatsAppIcon, MailIcon, PhoneIcon } from './icons';
import PlacementStrip from './PlacementStrip';
import { planDispatch, applyDispatch, unsendOrg, dropOrg, placeDirect } from '../lib/dispatch';
import { resolveCvUrl } from '../lib/cvUrl';
import { placementStatus, isPlacementCourse, TURN_LABEL, TURN_COLOR,
  type PlacementStatus, type PlacementTurn, type CvSubmission, type PlacementAction } from '../lib/placementStatus';
import type { Employer } from '../lib/supabase';

// Resolve the hosting employer from a student's free-text acceptedOrg (exact → ci →
// prefix, either direction) — same fuzzy match the editor uses — so the org-contact
// icons find the employer even when the name drifts slightly.
function resolveEmployerForOrg(orgName: string | undefined, employers: Employer[]): Employer | undefined {
  if (!orgName) return undefined;
  const norm = (s?: string) => (s || '').trim().toLowerCase();
  const n = norm(orgName);
  return employers.find(e => e.name === orgName)
    || employers.find(e => norm(e.name) === n)
    || employers.find(e => { const en = norm(e.name); return !!en && (en.startsWith(n) || n.startsWith(en)); });
}
const firstEmailOf = (s?: string) => (s || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] || '';

type Filters = {
  search: string;
  stage: 'all' | 'prep' | 'placed' | 'hired' | 'completed' | 'notplaced';
  dotFilter: 'all' | 'green' | 'amber' | 'gray';
  turn: 'all' | PlacementTurn;
};

const emptyFilters: Filters = { search: '', stage: 'all', dotFilter: 'all', turn: 'all' };

// A student "has employer feedback" when either the public employer form was
// submitted (feedbackSubmittedAt) or feedback text was recorded manually in the
// editor. Single source of truth for the "✓ משוב" card pill AND the group-email
// "משוב מעסיק חסר" bucket, so a quick scan and the mail tool always agree.
// Course-agnostic on purpose — it lights up wherever feedback exists (HR
// practicum תשפ״ו today, every course automatically as their feedback arrives).
export const hasEmployerFeedback = (s: Student): boolean =>
  !!s.feedbackSubmittedAt || !!(s.feedbackText && s.feedbackText.trim());

// Divisions for the group-email tool. Each is a predicate over a student; the
// recipient set is the current course+year context filtered by the chosen one.
type MailBucketKey = 'all' | 'placed' | 'notplaced' | 'hired' | 'completed' | 'prep' | 'feedback_pending';
const MAIL_BUCKETS: { key: MailBucketKey; label: string; test: (s: Student) => boolean }[] = [
  { key: 'all',              label: 'כולם',              test: () => true },
  { key: 'placed',           label: 'שובצו בארגון',       test: s => !!s.acceptedOrg },
  { key: 'notplaced',        label: 'טרם שובצו',          test: s => !s.acceptedOrg && !s.hired && !s.practicumCompleted },
  { key: 'hired',            label: 'נקלטו לעבודה',        test: s => !!s.hired },
  { key: 'completed',        label: 'סיימו פרקטיקום',      test: s => !!s.practicumCompleted },
  { key: 'prep',             label: 'עברו הכנה',          test: s => !!s.preparation?.passed },
  { key: 'feedback_pending', label: 'משוב מעסיק חסר',      test: s => !!s.acceptedOrg && !hasEmployerFeedback(s) },
];
// Map the active stage tab → the matching mail bucket, so opening the group-mail
// tool defaults to whatever the coordinator is already looking at.
const STAGE_TO_BUCKET: Record<Filters['stage'], MailBucketKey> = {
  all: 'all', prep: 'prep', placed: 'placed', hired: 'hired', completed: 'completed', notplaced: 'notplaced',
};

// In-app alert: candidate-suggested organizations awaiting the coordinator's approval.
function PendingSuggestionsBanner({ dismissedIds }: { dismissedIds?: string[] }) {
  const [pending, setPending] = useState<Array<{ id: string; name: string | null; email: string; org: string }>>([]);
  // A suggestion is "handled" once its cv_updates id is in dismissedSuggestionIds
  // (written on approve/dismiss). This is the ONLY reliable marker because anon
  // can't set cv_updates.seen_at under RLS — so without it, approved/dismissed
  // suggestions reappeared here forever.
  const dismissed = new Set(dismissedIds || []);
  useEffect(() => {
    let alive = true;
    // Latest-submission-per-candidate dedup: only the candidate's most recent
    // submission counts, and only if it carries an unhandled suggestion. A newer
    // submission without a suggestion supersedes (hides) an older suggestion.
    supabase.from('cv_updates')
      .select('id, name, email, suggested_org, uploaded_at, seen_at')
      .order('uploaded_at', { ascending: false })
      .then(({ data }) => {
        if (!alive || !data) return;
        const latestByEmail = new Map<string, any>();
        for (const r of data) {
          const key = (r.email || '').trim().toLowerCase();
          if (!key || latestByEmail.has(key)) continue; // desc order → first seen = latest
          latestByEmail.set(key, r);
        }
        setPending([...latestByEmail.values()]
          .filter((r: any) => r.suggested_org?.name && !r.seen_at && !dismissed.has(r.id))
          .map((r: any) => ({ id: r.id, name: r.name, email: r.email, org: r.suggested_org.name })));
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissedIds]);
  if (pending.length === 0) return null;
  return (
    <div className="mb-6 rounded-xl p-4" style={{ background: 'rgba(122,30,43,0.07)', border: '1px solid var(--accent)' }}>
      <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold mb-1.5" style={{ color: 'var(--accent)' }}>
        ⚠ {pending.length} {pending.length === 1 ? 'הצעת ארגון ממתינה' : 'הצעות ארגון ממתינות'} לאישור
      </div>
      <div className="text-[13px] leading-[1.7]" style={{ color: 'var(--ink)' }}>
        {pending.map(p => (
          <div key={p.id}>• {p.name || p.email} — <strong>{p.org}</strong></div>
        ))}
      </div>
      <div className="text-[12px] mt-1.5" style={{ color: 'var(--text-soft)' }}>
        פתח/י את כרטיס הסטודנט/ית התואם/ת → סעיף "CV מעודכן ממתין" → אשר/דחה.
      </div>
    </div>
  );
}

export default function StudentsPage({ data, context, userName, onRefresh }: PageProps & { data: any }) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [editing, setEditing] = useState<Student | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<Student | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMailModal, setShowMailModal] = useState(false);
  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');
  // 'bucket' = email a whole division (course+year scoped); 'selected' = the
  // manually-ticked rows. mailBucket is the active division in bucket mode.
  const [mailMode, setMailMode] = useState<'selected' | 'bucket'>('selected');
  const [mailBucket, setMailBucket] = useState<MailBucketKey>('all');

  // Email confirmation state — mandatory before any API send
  type EmailConfirm = {
    type: 'acceptance' | 'rejection';
    recipients: Array<{ id: string; name: string; email: string }>;
    subject: string;
    body: string;
  };
  const [emailConfirm, setEmailConfirm] = useState<EmailConfirm | null>(null);

  const EMAIL_TEMPLATES = {
    acceptance: {
      subject: 'אישור שיבוץ לפרקטיקום',
      body: `שלום {{שם}},

אנו שמחים לאשר כי שובצת בהצלחה למסגרת הפרקטיקום.

להמשך התהליך:
• יצירת קשר עם הארגון המאכסן לתיאום יום הפגישה הראשון
• דיווח שעות שבועי בהתאם לדרישות התכנית
• פנייה לצוות הפרקטיקום בכל שאלה

נשמח לתמוך בך לאורך כל התהליך.

בהצלחה,
צוות הפרקטיקום · אוניברסיטת אריאל`,
    },
    rejection: {
      subject: 'עדכון סטטוס פרקטיקום',
      body: `שלום {{שם}},

בהמשך לתהליך השיבוץ לפרקטיקום, ברצוננו ליידעך כי חלו שינויים בסטטוס הבקשה שלך.

צוות הפרקטיקום יצור עמך קשר בהקדם לדיון בשלבים הבאים.

בברכה,
צוות הפרקטיקום · אוניברסיטת אריאל`,
    },
  } as const;

  function openEmailConfirm(type: 'acceptance' | 'rejection', recipients: Array<{ id: string; name: string; email: string }>) {
    if (!recipients.length) { showToast('לאף אחד מהנבחרים אין מייל', 'error'); return; }
    setEmailConfirm({ type, recipients, subject: EMAIL_TEMPLATES[type].subject, body: EMAIL_TEMPLATES[type].body });
  }

  function sendConfirmedEmail() {
    if (!emailConfirm) return;
    const { type, recipients, subject, body } = emailConfirm;

    if (recipients.length === 1) {
      const r = recipients[0];
      const personalBody = body.replace(/\{\{שם\}\}/g, r.name);
      openMailto(`mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(personalBody)}`);
    } else {
      const bcc = recipients.map(r => r.email).filter(Boolean).join(',');
      const groupBody = body.replace(/\{\{שם\}\}/g, '[שם הנמען]');
      openMailto(`mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(groupBody)}`);
    }

    // Optimistically mark as sent
    const next = [...all];
    const field = type === 'acceptance' ? 'acceptanceEmailSent' : 'rejectionEmailSent';
    for (const rec of recipients) {
      const i = next.findIndex(s => s.id === rec.id);
      if (i >= 0) next[i] = { ...next[i], [field]: true };
    }
    persistAndRefresh(next, `✉ Outlook נפתח ל‑${recipients.length} נמענים`);
    setEmailConfirm(null);
    setSelectedIds(new Set());
    showToast(`✓ נפתח Outlook ל‑${recipients.length} נמענים`, 'success');
  }

  // Auto-process new CV uploads on mount — mark seen + save cvUpdatedUrl silently
  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase.from('cv_updates')
        .select('id, email, cv_file_path, uploaded_at')
        .is('seen_at', null);
      if (!rows || rows.length === 0) return;

      // Pick latest upload per email
      const byEmail: Record<string, { id: string; email: string; cv_file_path: string; uploaded_at: string }> = {};
      for (const row of rows) {
        const key = (row.email || '').toLowerCase();
        if (!byEmail[key] || row.uploaded_at > byEmail[key].uploaded_at) byEmail[key] = { ...row, email: key };
      }

      // Only process students who don't yet have cvUpdatedUrl set
      const currentAll = data.students || [];
      const toProcess = Object.values(byEmail).filter(r => {
        const s = currentAll.find(st => (st.email || '').toLowerCase() === r.email);
        return s && !s.cvUpdatedUrl;
      });
      if (toProcess.length === 0) return;

      const next = [...currentAll];
      for (const item of toProcess) {
        await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', item.id);
        const idx = next.findIndex(s => (s.email || '').toLowerCase() === item.email);
        if (idx >= 0) next[idx] = { ...next[idx], cvUpdatedUrl: `storage://candidate-uploads/${item.cv_file_path}` };
      }
      await persistAndRefresh(next, `✓ CV מעודכן נשמר אוטומטית`);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const all = data.students || [];
  const courses = data.courses || [];
  const employers = data.employers || [];

  const years = useMemo(() => {
    const set = new Set<string>();
    courses.forEach(c => c.year && set.add(normalizeYear(c.year)));
    all.forEach(s => s.year && set.add(normalizeYear(s.year)));
    (data.academicYears || []).forEach(y => set.add(normalizeYear(y)));
    return Array.from(set).sort().reverse();
  }, [courses, all, data.academicYears]);

  const scoped = useMemo(() => all.filter(s => sameContext(s, context, courses)), [all, context, courses]);

  // Every student's latest /cv-update submission — one query for the whole list, the
  // same latest-per-email shape PendingSuggestionsBanner uses. This is what makes a
  // waiting submission visible from the list: until now it was only discoverable by
  // opening that student's card, which is how two lists sat unread for days.
  const [subs, setSubs] = useState<{ latest: Map<string, CvSubmission>; unseen: Map<string, CvSubmission> }>(
    { latest: new Map(), unseen: new Map() });
  const [subsTick, setSubsTick] = useState(0);
  // A send opened from the row, awaiting the "did it actually go?" confirmation.
  const [rowSend, setRowSend] = useState<{ student: Student; entries: any[]; channel: 'whatsapp' | 'email' } | null>(null);
  // The just-sent bar. Persistent by design — see runPlacementAction('unsend').
  const [sentBar, setSentBar] = useState<{ studentId: string; studentName: string; orgNames: string[] } | null>(null);
  // A reminder awaiting confirmation that it really went out. Persistent, like the send bar.
  // `targets` records the dispatches whose compose window actually opened, so the
  // confirmation can restart the clock for those employers ONLY. Marking every
  // pending dispatch reminded was harmless while nothing read `remindedAt`; now that
  // the silence clock does, it would silence organizations we never contacted.
  const [remindBar, setRemindBar] = useState<{ studentId: string; studentName: string; orgName: string; days: number;
    targets: { employerId: string; slotId: string | null }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.from('cv_updates')
      .select('id, email, uploaded_at, seen_at, cv_file_path, org_pref_1, org_pref_2, org_pref_3')
      .order('uploaded_at', { ascending: false })
      .limit(500)
      .then(({ data: rows }) => {
        if (!alive || !rows) return;
        const latest = new Map<string, CvSubmission>(), unseen = new Map<string, CvSubmission>();
        for (const r of rows as any[]) {
          const k = String(r.email || '').trim().toLowerCase();
          if (!k) continue;
          if (!latest.has(k)) latest.set(k, r);              // desc order → first = newest
          if (!r.seen_at && !unseen.has(k)) unseen.set(k, r);
        }
        setSubs({ latest, unseen });
      });
    return () => { alive = false; };
  }, [subsTick]);

  // One classifier, one map — the strip, the turn filter and the counts can never
  // disagree about a student's state.
  const statusById = useMemo(() => {
    const m = new Map<string, PlacementStatus>();
    for (const s of scoped) {
      const email = String(s.email || '').trim().toLowerCase();
      const st = placementStatus({
        student: s, employers, dispatches: (data as any).dispatches || [],
        pending: subs.unseen.get(email) || null,
        lastSubmissionAt: subs.latest.get(email)?.uploaded_at || null,
        allStudents: all,
        course: courses.find((c: any) => c.id === s.courseId),
      });
      if (st) m.set(s.id, st);
    }
    return m;
  }, [scoped, employers, courses, subs, data, all]);

  const turnCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0, ours: 0, student: 0, employer: 0, closed: 0 };
    for (const s of scoped) {
      const st = statusById.get(s.id);
      if (!st) continue;
      c.all++; c[st.turn] = (c[st.turn] || 0) + 1;
    }
    return c;
  }, [scoped, statusById]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return scoped.filter(s => {
      if (filters.stage === 'prep' && !s.preparation?.passed) return false;
      if (filters.stage === 'placed' && !s.acceptedOrg) return false;
      if (filters.stage === 'hired' && !s.hired) return false;
      if (filters.stage === 'completed' && !s.practicumCompleted) return false;
      if (filters.stage === 'notplaced' && (s.acceptedOrg || s.hired || s.practicumCompleted)) return false;
      if (filters.dotFilter !== 'all') {
        const dot: DotStatus = s.practicumCompleted ? 'amber'
          : (s.hired || s.acceptedOrg ? 'green'
          : (s.preparation?.passed ? 'amber' : 'gray'));
        if (dot !== filters.dotFilter) return false;
      }
      if (filters.turn !== 'all' && statusById.get(s.id)?.turn !== filters.turn) return false;
      if (q) {
        const hay = [s.name, s.phone, s.email, s.city, s.acceptedOrg, s.notes].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  }, [scoped, filters, statusById]);

  const counts = useMemo(() => ({
    total: scoped.length,
    prep: scoped.filter(s => s.preparation?.passed).length,
    placed: scoped.filter(s => s.acceptedOrg).length,
    hired: scoped.filter(s => s.hired).length,
    completed: scoped.filter(s => s.practicumCompleted).length,
    notplaced: scoped.filter(s => !s.acceptedOrg && !s.hired && !s.practicumCompleted).length,
  }), [scoped]);

  // Recipients for the group-email modal: in bucket mode = everyone in the
  // current course+year context matching the chosen division; in selected mode
  // = the manually-ticked rows.
  const mailRecipients = useMemo<Student[]>(() => {
    if (mailMode === 'bucket') {
      const b = MAIL_BUCKETS.find(x => x.key === mailBucket) || MAIL_BUCKETS[0];
      return scoped.filter(b.test).sort((a, b2) => (a.name || '').localeCompare(b2.name || '', 'he'));
    }
    return (Array.from(selectedIds).map(id => all.find(s => s.id === id)).filter(Boolean) as Student[])
      .sort((a, b2) => (a.name || '').localeCompare(b2.name || '', 'he'));
  }, [mailMode, mailBucket, scoped, selectedIds, all]);

  /**
   * Row actions. Only ADOPT mutates from the list: it is the highest-volume, lowest-risk
   * action (copy the submission onto the student, mark it seen — no slots, no messages),
   * and it is the state that strands students today. Everything that reserves a place or
   * marks a placement stays on its ONE tested path inside the card, so the two can never
   * drift apart; those actions open the card instead of forking the logic.
   * Mirrors StudentEditor.applyPendingCv, but persists immediately rather than waiting
   * for a manual Save.
   */
  async function runPlacementAction(student: Student, action: PlacementAction) {
    // Sending happens HERE, in the row — Yariv 2026-08-09: "אם אפשר שהשליחה תהיה מהמלבן
    // של הסטודנט זה יקל, במקום לגלול עד למטה ולחפש את השליחה". It runs through the SAME
    // planner the card uses (lib/dispatch), so the two cannot drift, and it keeps every
    // guard: an explicit target, a compose window that must actually open, and a
    // confirmation that the message really went before any place is taken.
    // A reminder re-opens the compose window for an organization whose CV is already
    // out. The place is already held, so nothing is reserved; confirming only records
    // that a reminder went, which restarts the silence clock.
    if (action.id === 'remind') {
      const course = courses.find((c: any) => c.id === student.courseId);
      const st = statusById.get(student.id);
      const target = (action as any).targetOrg
        || st?.chips.find(c => c.tone === 'late')?.orgName
        || st?.chips.find(c => c.tone === 'sent')?.orgName;
      if (!target) { showToast('אין ארגון בהמתנה לתזכורת', 'error'); return; }
      const disp = ((data as any).dispatches || [])
        .filter((d: any) => d.studentId === student.id && d.result === 'pending')
        .sort((a: any, b: any) => String(b.sentAt).localeCompare(String(a.sentAt)))[0];
      const days = disp ? Math.max(0, Math.floor((Date.now() - new Date(disp.sentAt).getTime()) / 86400000)) : 0;
      const plan = planDispatch({
        student, employers, orgNames: [target], channel: (action as any).channel || 'email',
        courseId: student.courseId, courseName: course?.name || '',
        cvLink: resolveCvUrl(student.cvUpdatedUrl || student.cvUrl || ''),
        userName, settings: (data as any).placementSettings || {},
        newId: () => randomId('d'), origin: typeof window !== 'undefined' ? window.location.origin : '',
        allowResend: true, reminder: { daysWaiting: days },
      });
      if (plan.blockedReason) { showToast(plan.blockedReason, 'error'); return; }
      // Same refusal the send path makes: an empty compose window looks like it worked,
      // and that is exactly how a reminder goes missing. Now that WhatsApp is offered
      // here, the missing detail is usually a phone rather than an address.
      const noContact = plan.entries.filter(e => e.missingContact).map(e => e.orgName);
      if (noContact.length && noContact.length === plan.entries.length) {
        showToast(`אין ${(action as any).channel === 'whatsapp' ? 'טלפון' : 'כתובת מייל'} ל‑${noContact.join(', ')} — הוסף/י פרטי קשר לארגון`, 'error');
        return;
      }
      const opened: any[] = [];
      for (const e of plan.entries) {
        const ok = e.channel === 'whatsapp' ? !!window.open(e.url, '_blank') : openMailto(e.url);
        if (ok) opened.push(e);
      }
      if (!opened.length) { showToast('חלון נחסם — שלח/י בנפרד', 'error'); return; }
      setRemindBar({ studentId: student.id, studentName: student.name, orgName: target, days,
        targets: opened.map(e => ({ employerId: e.employerId, slotId: e.slotId ?? null })) });
      return;
    }
    if (action.id === 'send_cv') {
      const orgNames = ((action as any).targetOrgs as string[] | undefined)?.filter(Boolean)
        || [(action as any).targetOrg].filter(Boolean) as string[];
      if (!orgNames.length) { setEditing(student); return; }
      const course = courses.find((c: any) => c.id === student.courseId);
      const plan = planDispatch({
        student, employers, orgNames, channel: (action as any).channel || 'email',
        courseId: student.courseId, courseName: course?.name || '',
        cvLink: resolveCvUrl(student.cvUpdatedUrl || student.cvUrl || ''),
        userName, settings: (data as any).placementSettings || {},
        newId: () => randomId('d'), origin: typeof window !== 'undefined' ? window.location.origin : '',
      });
      if (plan.blockedReason) { showToast(plan.blockedReason, 'error'); return; }
      // Refuse rather than open a compose window with no recipient — an empty window
      // looks like it worked and is exactly how a send goes missing.
      const noContact = plan.entries.filter(e => e.missingContact).map(e => e.orgName);
      if (noContact.length && noContact.length === plan.entries.length) {
        showToast(`אין ${(action as any).channel === 'whatsapp' ? 'טלפון' : 'כתובת מייל'} ל‑${noContact.join(', ')} — הוסף/י פרטי קשר לארגון`, 'error');
        return;
      }
      const opened = [];
      const skipped = [...plan.skipped];
      for (const e of plan.entries) {
        const ok = e.channel === 'whatsapp' ? !!window.open(e.url, '_blank') : openMailto(e.url);
        if (!ok) { skipped.push(`${e.orgName} (חלון נחסם — שלח/י בנפרד)`); continue; }
        opened.push(e);
      }
      if (opened.length === 0) { showToast(skipped.length ? `לא נשלח — ${skipped.join(', ')}` : 'לא נשלח', 'error'); return; }
      setRowSend({ student, entries: opened, channel: opened[0].channel });
      return;
    }
    // Undo a send from the row. Deliberately NOT time-limited: checking whether Outlook
    // actually sent takes longer than any toast would last (Yariv 2026-08-10 — "it should
    // stay after it is created"), so the control lives on the organization itself and
    // remains until the send is resolved.
    if (action.id === 'drop_org') {
      const orgName = (action as any).targetOrg as string | undefined;
      if (!orgName) return;
      const res = dropOrg({ student, employers, orgName, userName });
      const nextStudents = all.map(x => x.id === student.id ? res.student : x);
      setSaving(true);
      const saved = await saveSnapshot(
        { ...data, students: nextStudents, employers: res.employers },
        { name: userName }, { action: 'ארגון הוסר מהדירוג', entity: 'סטודנט', target: student.name });
      setSaving(false);
      if (saved.ok) { onRefresh(); showToast(`✕ ${orgName} הוסר מהדירוג`, 'success'); }
      else showToast('שגיאה בשמירה: ' + (saved.error || ''), 'error');
      return;
    }
    if (action.id === 'unsend') {
      const orgName = (action as any).targetOrg as string | undefined;
      if (!orgName) return;
      const res = unsendOrg({
        student, employers, dispatches: (data as any).dispatches || [],
        orgName, userName, mode: 'never_sent',
      });
      const nextStudents = all.map(x => x.id === student.id ? res.student : x);
      setSaving(true);
      const saved = await saveSnapshot(
        { ...data, students: nextStudents, employers: res.employers, dispatches: res.dispatches },
        { name: userName },
        { action: 'בוטלה שליחת קו״ח', entity: 'סטודנט', target: student.name },
      );
      setSaving(false);
      if (saved.ok) { setRowSend(null); onRefresh(); showToast(`↩︎ ${orgName} חזר לרשימה — המקום שוחרר`, 'success'); }
      else showToast('שגיאה בשמירה: ' + (saved.error || ''), 'error');
      return;
    }
    // Approving a placement from the row. This used to fall through to setEditing() while
    // its confirmation dialog promised "הסטודנט/ית יירשם/תירשם כמשובץ/ת בארגון, ייתפס
    // מקום" — so the card opened, the database was untouched, and the placement silently
    // did not happen. Yariv hit it on הדר עוזירי → מערך הדיגיטל הלאומי and had to redo the
    // whole thing inside the card ("ניכר ששום כפתור לא באמת עבד מחוץ למערכת").
    // It runs the SAME lib/dispatch.placeDirect the card runs, so the two cannot drift.
    if (action.id === 'place_direct') {
      const orgName = (action as any).targetOrg
        || (statusById.get(student.id)?.chips || []).find((c: any) => c.suggested)?.orgName;
      if (!orgName) { setEditing(student); return; }
      const res = placeDirect({ student, employers, orgName, userName });
      if (!res.ok) { showToast(res.error || 'לא ניתן לאשר השמה', 'error'); return; }
      await persistAndRefresh(
        all.map(x => x.id === student.id ? res.student : x),
        `✓ ${student.name} שובץ/ה ל"${orgName}"`,
        res.employers,
        { action: 'אישור השמה ישירה', entity: 'סטודנט', target: `${student.name} · ${orgName}` });
      showToast(`✓ ${student.name} שובץ/ה ל"${orgName}" (השמה ישירה)`, 'success');
      return;
    }

    if (action.id !== 'adopt') { setEditing(student); return; }
    const email = String(student.email || '').trim().toLowerCase();
    const row = subs.unseen.get(email);
    if (!row) { showToast('ההגשה כבר נקלטה', 'info'); return; }
    const next = all.map(x => x.id === student.id ? {
      ...x,
      ...(row.cv_file_path ? { cvUpdatedUrl: `storage://candidate-uploads/${row.cv_file_path}` } : {}),
      ...(row.org_pref_1 ? { firstChoiceOrg: row.org_pref_1 } : {}),
      ...(row.org_pref_2 ? { secondChoiceOrg: row.org_pref_2 } : {}),
      ...(row.org_pref_3 ? { thirdChoiceOrg: row.org_pref_3 } : {}),
    } as Student : x);
    await persistAndRefresh(next, '✓ ההגשה נקלטה לכרטיס', undefined,
      { action: 'נקלטה הגשת קו״ח והעדפות', entity: 'סטודנט', target: student.name });
    await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', row.id);
    setSubsTick(t => t + 1);
    showToast(`✓ ההגשה של ${student.name} נקלטה לכרטיס`, 'success');
  }

  async function persistAndRefresh(next: Student[], msg: string, nextEmployers?: any[], activity?: { action: string; entity: string; target: string }) {
    setSaving(true);
    setSaveMsg(null);
    const nextData = nextEmployers ? { ...data, students: next, employers: nextEmployers } : { ...data, students: next };
    const res = await saveSnapshot(nextData, { name: userName }, activity);
    setSaving(false);
    if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
    setSaveMsg(msg);
    showToast(msg + ' · נשמר בענן ☁️', 'success');
    (data.students as Student[]) = next;
    if (nextEmployers) (data.employers as any) = nextEmployers;
    onRefresh();
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function handleSave(s: Student) {
    const idx = all.findIndex(x => x.id === s.id);
    const previous = idx >= 0 ? all[idx] : null;
    const next = idx >= 0 ? [...all] : [...all, s];
    if (idx >= 0) next[idx] = s;
    setEditing(null); setCreating(false);

    // Occupy a vacancy slot at the org when acceptedOrg is newly set (the unified
    // capacity ledger — replaces the old bare filledPositions++).
    const orgJustSet = s.acceptedOrg && !previous?.acceptedOrg;
    if (orgJustSet) {
      const empIdx = employers.findIndex(e => e.name === s.acceptedOrg);
      if (empIdx >= 0) {
        const updatedEmps = occupyAcceptedOrgSlot(s, employers, { actorId: userName });
        setSaving(true); setSaveMsg(null);
        const res = await saveSnapshot(
          { ...data, students: next, employers: updatedEmps },
          { name: userName },
          { action: 'שובץ לארגון', entity: 'סטודנט', target: s.name }
        );
        setSaving(false);
        if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
        setSaveMsg('✓ שובץ/ה לארגון');
        showToast('✓ שובץ/ה לארגון · נשמר בענן ☁️', 'success');
        (data.students as Student[]) = next;
        (data.employers as any) = updatedEmps;
        onRefresh();
        setTimeout(() => setSaveMsg(null), 2500);
        return;
      }
    }

    // Coordinator-edit audit trail: record WHO (userName — Yariv or Rachel) changed
    // WHICH key fields. Now that a coordinator can directly change a student's choices,
    // Yariv wants a "who changed what" trail (student SUBMISSIONS are already logged in
    // cv_updates; this covers COORDINATOR edits, which previously left no history entry).
    const tracked: Array<[keyof Student, string]> = [
      ['firstChoiceOrg', 'בחירה ראשונה'], ['secondChoiceOrg', 'בחירה שנייה'], ['thirdChoiceOrg' as keyof Student, 'בחירה שלישית'],
      // Interview-result edits are now first-class (the per-org תוצאת ראיון control) — audit them too.
      ['firstChoiceResult' as keyof Student, 'תוצאת ראיון א'], ['secondChoiceResult' as keyof Student, 'תוצאת ראיון ב'], ['thirdChoiceResult' as keyof Student, 'תוצאת ראיון ג'],
      ['cvUpdatedUrl', 'קו״ח מעודכן'], ['submissionStatus', 'סטטוס'], ['acceptedOrg', 'שיבוץ'], ['feedbackText', 'משוב'],
    ];
    // Normalise so a *Result field materialising from undefined → its 'pending' default
    // (which OrgHub writes on the first edit) is NOT logged as a real interview-result change.
    const norm = (k: keyof Student, v: any) => { const str = String(v ?? ''); return /Result$/.test(String(k)) && str === 'pending' ? '' : str; };
    const changedLabels = previous
      ? tracked.filter(([k]) => norm(k, (previous as any)[k]) !== norm(k, (s as any)[k])).map(([, label]) => label)
      : [];
    const editActivity = !previous
      ? { action: 'יצירת סטודנט/ית', entity: 'סטודנט', target: s.name }
      : { action: changedLabels.length ? `עריכת רכז: ${changedLabels.join(', ')}` : 'עריכת פרטי סטודנט/ית', entity: 'סטודנט', target: s.name };

    await persistAndRefresh(next, idx >= 0 ? '✓ הסטודנט/ית עודכנו' : '✓ סטודנט/ית נוצר', undefined, editActivity);
  }

  async function handleAutoSave(s: Student) {
    const idx = all.findIndex(x => x.id === s.id);
    if (idx < 0) return;
    const next = [...all];
    next[idx] = s;
    await persistAndRefresh(next, '✓ נשמר אוטומטית');
    // Do NOT close the editor
  }

  function handleDelete(id: string) {
    const student = all.find(s => s.id === id);
    if (!student) return;
    setEditing(null);
    setDeleteDialog(student);
  }

  async function confirmDeleteAll(student: Student) {
    setDeleteDialog(null);
    const candidates = (data.candidates as Candidate[]) || [];
    const linked = student.fromCandidateId
      ? candidates.find(c => c.id === student.fromCandidateId)
      : candidates.find(c => (c.email || '').toLowerCase() === (student.email || '').toLowerCase());
    const nextStudents = all.filter(s => s.id !== student.id);
    const nextCandidates = linked ? candidates.filter(c => c.id !== linked.id) : candidates;
    const nextEmployers = releaseStudentSlots((data.employers as any) || [], student.id);
    setSaving(true);
    const res = await saveSnapshot(
      { ...data, students: nextStudents, candidates: nextCandidates, employers: nextEmployers },
      { name: userName },
      { action: 'נמחק לחלוטין', entity: 'סטודנט', target: student.name }
    );
    setSaving(false);
    if (res.ok) {
      (data.students as Student[]) = nextStudents;
      (data.candidates as Candidate[]) = nextCandidates;
      (data.employers as any) = nextEmployers;
      onRefresh();
      showToast(`✓ ${student.name} נמחק/ה לחלוטין (כולל מועמדות)`, 'success');
    } else {
      showToast('שגיאה: ' + (res.error || ''), 'error');
    }
  }

  async function confirmKeepAsCandidate(student: Student) {
    setDeleteDialog(null);
    // Revert-to-candidate now lives ONLY here (behind this confirmed dialog) — the
    // one-tap list quick-revert was removed. Create the candidate record if one doesn't
    // already exist, so "keep as candidate" reliably lands them back in the candidates list.
    const candidates = (data.candidates as Candidate[]) || [];
    const existing = student.fromCandidateId
      ? candidates.find(c => c.id === student.fromCandidateId)
      : (student.email ? candidates.find(c => (c.email || '').toLowerCase() === (student.email || '').toLowerCase()) : undefined);
    const nextCandidates = existing ? candidates : [...candidates, {
      id: randomId('cand'), name: student.name, phone: student.phone || '', email: student.email || '',
      city: student.city || '', courseId: student.courseId || '', year: student.year || '',
      applicationDate: '', cvUrl: student.cvUrl || '', applicationUrl: '', submittedAt: undefined,
      interviewDate: '', interviewTime: '', interviewResult: 'pending', notes: 'הוחזר ממצב סטודנט',
    } as Candidate];
    const nextEmployers = releaseStudentSlots((data.employers as any) || [], student.id);
    const nextStudents = all.filter(s => s.id !== student.id);
    setSaving(true);
    const res = await saveSnapshot(
      { ...data, students: nextStudents, candidates: nextCandidates, employers: nextEmployers },
      { name: userName },
      { action: 'הוחזר למועמד', entity: 'סטודנט', target: student.name },
    );
    setSaving(false);
    if (!res.ok) { showToast('שגיאה: ' + (res.error || ''), 'error'); return; }
    (data.students as Student[]) = nextStudents;
    (data.candidates as Candidate[]) = nextCandidates;
    (data.employers as any) = nextEmployers;
    onRefresh();
    showToast(`✓ ${student.name} הוסר/ה כסטודנט, נשמר/ה כמועמד`, 'success');
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-10 pt-14 pb-28">
      <PendingSuggestionsBanner dismissedIds={(data as any).dismissedSuggestionIds} />
      <section className="pt-4 pb-14 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">III · סטודנטים</div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
              סטודנטים
            </h1>
            <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
              {counts.total === 0
                ? 'אין סטודנטים בהקשר הנוכחי. הוסף חדש או שנה את הסינון בבר העליון.'
                : `${counts.total} סטודנטים · ${counts.placed} שובצו · ${counts.hired} נקלטו · ${counts.completed} סיימו פרקטיקום · ${counts.prep} עברו הכנה`}
            </p>
          </div>
          <div className="flex flex-row md:flex-col gap-2 items-start md:items-end flex-wrap">
            <button onClick={() => setCreating(true)} style={btnPrimary()}>+ חדש/ה →</button>
            {counts.total > 0 && (
              <button
                title="שליחת מייל לקבוצת סטודנטים לפי חלוקה — נפתח ב‑Outlook שלך"
                onClick={() => {
                  setMailMode('bucket');
                  setMailBucket(STAGE_TO_BUCKET[filters.stage]);
                  setMailSubject(''); setMailBody('');
                  setShowMailModal(true);
                }}
                style={btnSecondary()}>✉ מייל לקבוצה</button>
            )}
            <div className="flex gap-2 flex-wrap justify-end">
              <button onClick={() => setShowImport(s => !s)}
                className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
                style={{ color: 'var(--accent)' }}>
                📊 {showImport ? 'סגור' : 'Excel'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── ממתינים לך ──────────────────────────────────────────────────────────
          The four students who need an action, at the head of the screen. The filter
          below already returns this set; showing it as a worklist is what removes the
          scrolling — a row with organizations is ~500px tall, so eleven students span
          about five phone screens (measured 2026-08-10). */}
      {(() => {
        const waiting = scoped
          .map(s => ({ s, st: statusById.get(s.id) }))
          .filter(x => x.st && x.st.turn === 'ours' && x.st.action)
          .sort((a, b) => (b.st!.key === 'submission_pending' ? 1 : 0) - (a.st!.key === 'submission_pending' ? 1 : 0));
        if (!waiting.length) return null;
        return (
          <div data-waiting-queue={waiting.length} className="mb-5"
            style={{ border: '1px solid var(--divider-strong)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px',
              background: 'rgba(185,28,28,0.06)', borderBottom: '1px solid var(--divider)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#b91c1c' }} />
              <span style={{ flex: 1, fontWeight: 800, fontSize: 13, color: '#b91c1c' }}>ממתינים לך</span>
              <span style={{ fontSize: 11, fontWeight: 800, background: '#b91c1c', color: '#fff',
                padding: '1px 9px', borderRadius: 999 }}>{waiting.length}</span>
            </div>
            {waiting.map(({ s, st }) => (
              <div key={s.id} data-waiting-row={s.id}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px',
                  borderBottom: '1px solid var(--divider)' }}>
                <button type="button" onClick={() => setEditing(s)}
                  title="פתח כרטיס"
                  style={{ flex: '0 1 auto', minWidth: 78, maxWidth: '48%', textAlign: 'right',
                    fontWeight: 700, fontSize: 13, background: 'transparent', border: 'none',
                    color: 'var(--ink)', cursor: 'pointer', padding: 0,
                    // `flex: none` with no truncation meant a long name pushed this row —
                    // and with it the whole page — wider than the screen. The row list
                    // truncates its names; this queue did not (found 2026-08-11).
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </button>
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--text-soft)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {st!.sub || st!.headline}
                </span>
                <button type="button" data-waiting-action={st!.action!.id}
                  onClick={() => {
                    // Jump to the student's own row and let the strip run the action, so the
                    // queue never becomes a second implementation of the same flow.
                    const el = document.querySelector(`[data-student-row="${s.id}"]`);
                    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    const btn = el?.querySelector('[data-strip-action]') as HTMLButtonElement | null;
                    if (btn) setTimeout(() => btn.click(), 320); else setEditing(s);
                  }}
                  style={{ flex: 'none', fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 7,
                    border: '1px solid #b91c1c', color: '#b91c1c', background: 'transparent', cursor: 'pointer' }}>
                  {st!.action!.short}
                </button>
              </div>
            ))}
          </div>
        );
      })()}

      {showImport && (
        <div className="mb-8">
          <ExcelImport kind="students" data={data} userName={userName} onDone={() => { setShowImport(false); onRefresh(); }} />
        </div>
      )}

      {/* Status strip */}
      <div className="mono text-[12px] uppercase tracking-[0.16em] flex items-center gap-4 flex-wrap mb-10" style={{ color: 'var(--text-soft)' }}>
        <RefreshButton onRefresh={onRefresh} />
        {saveMsg && <span style={{ color: 'var(--accent)' }}>· {saveMsg}</span>}
        {saving && <span className="opacity-75">· שומר...</span>}
      </div>

      {/* Search — full width on mobile, above tabs */}
      <div className="mb-3">
        <input
          type="search"
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          placeholder="חפש לפי שם, טלפון, עיר, ארגון..."
          className="input w-full"
          style={{ padding: '10px 14px', fontSize: '14px' }}
        />
      </div>

      {/* Stage tabs — Ramzor style */}
      <div className="ramzor-bar mb-8">
        {([
          ['all',       'הכל',           counts.total,      null    ],
          ['prep',      'הכנה',          counts.prep,       'amber' ],
          ['placed',    'שובצו',         counts.placed,     'green' ],
          ['hired',     'נקלטו',         counts.hired,      'green' ],
          ['completed', 'סיימו פרקטיקום', counts.completed, 'amber' ],
          ['notplaced', 'טרם שובצו',    counts.notplaced,  'gray'  ],
        ] as const).map(([key, label, n, dot]) => {
          const active = filters.stage === key;
          const borderCol = dot
            ? `var(--tl-${dot})`
            : 'var(--accent)';
          return (
            <button
              key={key}
              onClick={() => setFilters(f => ({ ...f, stage: key }))}
              className={`ramzor-tab${active ? ' active' : ''}`}
              style={{ borderColor: active ? borderCol : 'transparent' }}
            >
              {dot && <StatusDot status={dot as DotStatus} size={7} />}
              <span className="mono text-[11px] uppercase tracking-[0.13em] font-semibold">{label}</span>
              <span className="serif text-[18px] leading-none">{n}</span>
            </button>
          );
        })}
      </div>


      {/* Whose-turn filter — the axis the placement strip is organised around, so the
          list can be worked as a queue: what do WE owe, what are we waiting on. */}
      {turnCounts.all > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <span className="mono text-[10px] uppercase tracking-[0.14em] shrink-0" style={{ color: 'var(--text-soft)' }}>אצל מי הכדור:</span>
          {([
            ['all', 'הכל', null],
            ['ours', TURN_LABEL.ours, TURN_COLOR.ours],
            ['student', TURN_LABEL.student, TURN_COLOR.student],
            ['employer', TURN_LABEL.employer, TURN_COLOR.employer],
            ['closed', TURN_LABEL.closed, TURN_COLOR.closed],
          ] as const).map(([key, label, col]) => {
            const active = filters.turn === key;
            const n = turnCounts[key] ?? 0;
            return (
              <button
                key={key}
                data-turn-filter={key}
                onClick={() => setFilters(f => ({ ...f, turn: key as Filters['turn'] }))}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full border mono text-[10px] uppercase tracking-[0.12em] font-semibold transition-colors"
                style={{
                  borderColor: active ? (col || 'var(--accent)') : 'var(--divider)',
                  color: active ? (col || 'var(--accent)') : 'var(--text-soft)',
                  background: active ? `${col || 'var(--accent)'}14` : 'transparent',
                }}>
                {col && <span style={{ width: 6, height: 6, borderRadius: '50%', background: col }} />}
                {label}
                <span style={{ opacity: 0.75 }}>{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Dot-color filter chips (item 9) */}
      <div className="flex flex-wrap gap-2 mb-6 items-center">
        <span className="mono text-[10px] uppercase tracking-[0.14em] shrink-0" style={{ color: 'var(--text-soft)' }}>סטטוס:</span>
        {([
          ['all',   'הכל',            null   ],
          ['green', 'שובצו / נקלטו',  'green'],
          ['amber', 'הכנה / סיימו',   'amber'],
          ['gray',  'ממתינים',         'gray' ],
        ] as const).map(([key, label, dot]) => {
          const active = filters.dotFilter === key;
          const dotBg: Record<string, string> = { green: 'rgba(16,185,129,0.08)', amber: 'rgba(217,119,6,0.08)', gray: 'rgba(0,0,0,0.05)' };
          return (
            <button
              key={key}
              onClick={() => setFilters(f => ({ ...f, dotFilter: key }))}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full border mono text-[10px] uppercase tracking-[0.12em] font-semibold transition-colors"
              style={{
                borderColor: active ? (dot ? `var(--tl-${dot})` : 'var(--accent)') : 'var(--divider)',
                color: active ? (dot ? `var(--tl-${dot})` : 'var(--accent)') : 'var(--text-soft)',
                background: active ? (dot ? dotBg[dot] : 'rgba(122,30,43,0.06)') : 'transparent',
              }}
            >
              {dot && <StatusDot status={dot} size={6} />}
              {label}
            </button>
          );
        })}
      </div>

      {/* Selection + group-mail action row (Candidates-style) — always above the
          list. Checkboxes on each row select individuals; "בחר הכל" grabs the
          whole current filter; the actions send to whoever is ticked. */}
      {filtered.length > 0 && (
        <div className="mb-6 flex gap-3 items-center flex-wrap">
          <button
            onClick={() => {
              const allSelected = filtered.every(s => selectedIds.has(s.id));
              setSelectedIds(allSelected ? new Set() : new Set(filtered.map(s => s.id)));
            }}
            className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
            style={{ color: filtered.every(s => selectedIds.has(s.id)) && filtered.length > 0 ? 'var(--accent)' : 'var(--text-soft)', whiteSpace: 'nowrap' }}>
            {filtered.every(s => selectedIds.has(s.id)) && filtered.length > 0 ? '✕ בטל הכל' : `☑ בחר הכל (${filtered.length})`}
          </button>
          {selectedIds.size > 0 && (
            <span className="mono text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>{selectedIds.size} נבחרו</span>
          )}
          {selectedIds.size > 0 && (
            <button onClick={() => { setMailMode('selected'); setMailSubject(''); setMailBody(''); setShowMailModal(true); }} style={btnSmall()}>📧 מייל Outlook</button>
          )}
          {selectedIds.size > 0 && (
            <button style={btnSmall()} onClick={() => {
              const people = Array.from(selectedIds).map(id => all.find(s => s.id === id)).filter(Boolean) as Student[];
              openEmailConfirm('acceptance', people.filter(s => s.email).map(s => ({ id: s.id, name: s.name, email: s.email! })));
            }}>✓ הודעת קבלה ({selectedIds.size})</button>
          )}
          {selectedIds.size > 0 && (
            <button style={{ ...btnSmall(), borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => {
              const people = Array.from(selectedIds).map(id => all.find(s => s.id === id)).filter(Boolean) as Student[];
              openEmailConfirm('rejection', people.filter(s => s.email).map(s => ({ id: s.id, name: s.name, email: s.email! })));
            }}>✗ הודעת דחייה ({selectedIds.size})</button>
          )}
          {selectedIds.size > 0 && (
            <button onClick={() => setSelectedIds(new Set())} className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70" style={{ color: 'var(--text-soft)' }}>ביטול בחירה</button>
          )}
        </div>
      )}

      {/* List */}
      <section>
        {filtered.length === 0 ? (
          <div className="py-24 text-center">
            <div className="serif text-[26px]" style={{ color: 'var(--ink)' }}>אין סטודנטים להצגה</div>
            <div className="mt-3 text-[14px]" style={{ color: 'var(--text-soft)' }}>נסה להסיר סינון או להוסיף חדש.</div>
          </div>
        ) : context.courseId === '__all__' ? (
          groupByYearCourse(filtered, courses, context).map(group => (
            <div key={`${group.year}||${group.courseId}`}>
              <GroupHeader year={group.year} courseName={group.courseName} count={group.items.length} showYear={group.showYear} />
              <ul>
                {group.items.map(s => (
                  <StudentRow key={s.id} s={s} onEdit={() => setEditing(s)} employers={employers}
                    status={statusById.get(s.id)} onAction={a => runPlacementAction(s, a)}
                    pinned={pinnedId === s.id} onTogglePin={() => setPinnedId(pinnedId === s.id ? null : s.id)}
                    selected={selectedIds.has(s.id)}
                    onToggleSelect={() => {
                      const next = new Set(selectedIds);
                      next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                      setSelectedIds(next);
                    }} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <ul>
            {filtered.map(s => (
              <StudentRow key={s.id} s={s} onEdit={() => setEditing(s)} employers={employers}
                    status={statusById.get(s.id)} onAction={a => runPlacementAction(s, a)}
                pinned={pinnedId === s.id} onTogglePin={() => setPinnedId(pinnedId === s.id ? null : s.id)}
                selected={selectedIds.has(s.id)}
                onToggleSelect={() => {
                  const next = new Set(selectedIds);
                  next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                  setSelectedIds(next);
                }} />
            ))}
          </ul>
        )}
      </section>

      {remindBar && (
        <div data-remind-bar
          style={{ position: 'fixed', insetInline: 12, bottom: 12, zIndex: 350, display: 'flex',
            alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '11px 14px', borderRadius: 12,
            background: 'var(--bg)', border: '1px solid var(--divider-strong)',
            boxShadow: '0 12px 40px rgba(61,15,20,0.22)', maxWidth: 560, marginInline: 'auto' }}>
          <span style={{ flex: 1, minWidth: 170, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            נפתחה תזכורת ל‑{remindBar.orgName} · {remindBar.studentName} ({remindBar.days} ימים)
            <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--text-soft)' }}>
              אשר/י רק אם התזכורת נשלחה בפועל — השעון יתחיל מחדש.
            </span>
          </span>
          <button type="button" data-remind-confirm
            onClick={async () => {
              const b = remindBar; setRemindBar(null);
              const now = new Date().toISOString();
              const next = ((data as any).dispatches || []).map((d: any) => {
                if (d.studentId !== b.studentId || d.result !== 'pending') return d;
                const chased = b.targets.some(t =>
                  (t.slotId && d.slotId) ? d.slotId === t.slotId : d.employerId === t.employerId);
                return chased ? { ...d, remindedAt: now, reminders: (d.reminders || 0) + 1 } : d;
              });
              setSaving(true);
              const saved = await saveSnapshot({ ...data, dispatches: next }, { name: userName },
                { action: 'נשלחה תזכורת למעסיק', entity: 'סטודנט', target: b.studentName });
              setSaving(false);
              if (saved.ok) { onRefresh(); showToast(`✓ נרשמה תזכורת ל‑${b.orgName}`, 'success'); }
              else showToast('שגיאה בשמירה: ' + (saved.error || ''), 'error');
            }}
            style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: 'none',
              background: '#15803d', color: '#fff', cursor: 'pointer' }}>
            ✓ נשלחה
          </button>
          <button type="button" data-remind-close onClick={() => setRemindBar(null)} aria-label="סגור"
            style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--divider)',
              background: 'transparent', color: 'var(--text-soft)', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {sentBar && (
        <div data-sent-bar
          style={{ position: 'fixed', insetInline: 12, bottom: 12, zIndex: 350, display: 'flex',
            alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '11px 14px', borderRadius: 12,
            background: 'var(--bg)', border: '1px solid var(--divider-strong)',
            boxShadow: '0 12px 40px rgba(61,15,20,0.22)', maxWidth: 560, marginInline: 'auto' }}>
          <span style={{ flex: 1, minWidth: 160, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            ✓ נרשם: קו״ח ל‑{sentBar.orgNames.join(', ')} · {sentBar.studentName}
          </span>
          <button type="button" data-sent-bar-undo
            onClick={() => {
              const b = sentBar; setSentBar(null);
              // Re-read the student: the one captured when the send started still has
              // slotId === null, so undoing from it freed the preference but left the
              // place reserved.
              const fresh = (data.students || []).find((x: Student) => x.id === b.studentId);
              if (fresh) runPlacementAction(fresh, { id: 'unsend', targetOrg: b.orgNames[0] } as any);
            }}
            style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8,
              border: '1px solid #b45309', background: 'transparent', color: '#b45309', cursor: 'pointer' }}>
            ↩︎ לא נשלח — בטל
          </button>
          <button type="button" data-sent-bar-close onClick={() => setSentBar(null)}
            aria-label="סגור"
            style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--divider)',
              background: 'transparent', color: 'var(--text-soft)', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Row-level send confirmation. Same contract as the card's: the app opens the
          compose window, and only an explicit "it went" takes the place. */}
      {rowSend && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(26,22,18,0.6)' }}>
          <div role="dialog" aria-modal="true" data-row-send-confirm
            style={{ background: 'var(--bg)', border: '1px solid var(--divider)', borderRadius: 16, maxWidth: 460, width: '100%', padding: '22px 24px', textAlign: 'right', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
            <div className="serif" style={{ fontSize: 22, color: 'var(--ink)', marginBottom: 8 }}>
              {rowSend.channel === 'whatsapp' ? 'נפתח WhatsApp' : 'נפתח חלון מייל'}
            </div>
            <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-soft)', margin: 0 }}>
              המערכת פותחת את ההודעה — היא <b>לא שולחת בעצמה</b>. אשר/י רק אחרי שההודעה
              נשלחה בפועל אל <b>{rowSend.entries.map(e => e.orgName).join(', ')}</b> עבור <b>{rowSend.student.name}</b>.
            </p>
            {/* Who it actually reaches — the planner knew this all along and never said it. */}
            <div data-send-recipient style={{ marginTop: 9, padding: '8px 11px', borderRadius: 8,
              background: 'var(--accent-soft)', fontSize: 12.5, lineHeight: 1.6 }}>
              {rowSend.entries.map(e => (
                <div key={e.orgName}>
                  <span style={{ color: 'var(--text-soft)' }}>נמען: </span>
                  <b>{e.contactName || e.orgName}</b>
                  {e.missingContact
                    ? <span style={{ color: '#b91c1c', fontWeight: 700 }}> · אין {rowSend.channel === 'whatsapp' ? 'טלפון' : 'כתובת'} לארגון</span>
                    : <span dir="ltr" style={{ color: 'var(--text-soft)' }}> · {e.recipient}</span>}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, padding: '8px 11px', borderRadius: 8, background: 'rgba(185,28,28,0.08)', color: '#b91c1c', fontWeight: 600, fontSize: 12.5 }}>
              ⚠ אישור תופס את המקום בארגון. אם לא נשלח — בחר/י "לא נשלח", והמקום יישאר פנוי.
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 18, flexWrap: 'wrap' }}>
              <button type="button" data-row-send-yes
                onClick={async () => {
                  const rs = rowSend; setRowSend(null);
                  const res = applyDispatch({
                    student: rs.student, employers, dispatches: (data as any).dispatches || [],
                    entries: rs.entries, userName, newId: () => randomId('d'),
                  });
                  const nextStudents = all.map(x => x.id === rs.student.id ? res.student : x);
                  setSaving(true);
                  const saved = await saveSnapshot(
                    { ...data, students: nextStudents, employers: res.employers, dispatches: res.dispatches },
                    { name: userName },
                    { action: 'קו״ח נשלחו', entity: 'סטודנט', target: rs.student.name },
                  );
                  setSaving(false);
                  if (saved.ok) {
                    onRefresh();
                    // Stays on screen until dismissed — you may only discover Outlook
                    // did not send after switching to it and back.
                    setSentBar({ studentId: rs.student.id, studentName: rs.student.name, orgNames: rs.entries.map(e => e.orgName) });
                  } else showToast('שגיאה בשמירה: ' + (saved.error || ''), 'error');
                }}
                style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 9, border: 'none', background: '#15803d', color: '#fff', cursor: 'pointer' }}>
                ✓ נשלח — סמן ותפוס מקום
              </button>
              <button type="button" data-row-send-no
                onClick={() => { setRowSend(null); showToast('לא נרשמה שליחה — המקום נשאר פנוי', 'info'); }}
                style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 9, border: '1px solid var(--divider-strong)', background: 'transparent', color: 'var(--text-soft)', cursor: 'pointer' }}>
                לא נשלח
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Outlook group email modal — works in two modes:
          • bucket  = email a whole division (course+year scoped), chosen here
          • selected = the rows ticked via "בחר מספר" */}
      {showMailModal && (() => {
        const isBucket = mailMode === 'bucket';
        const recipients = mailRecipients;
        const withEmail = recipients.filter(s => s.email);
        const noEmail = recipients.filter(s => !s.email);
        const ctxCourse = context.courseId && context.courseId !== '__all__'
          ? (courses.find(c => c.id === context.courseId)?.name || 'קורס נבחר')
          : 'כל הקורסים';
        const ctxYear = context.year && context.year !== '__all__' ? context.year : 'כל השנים';
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(26,22,18,0.55)' }}>
          <div data-mail-modal className="rounded-2xl border p-8 max-w-[560px] w-full mx-4" style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 20px 60px rgba(26,22,18,0.3)', maxHeight: '92vh', overflowY: 'auto' }}>
            <div className="flex items-baseline justify-between mb-1">
              <div className="serif text-[22px]" style={{ color: 'var(--ink)' }}>{isBucket ? 'מייל לקבוצת סטודנטים' : 'מייל קבוצתי ב‑Outlook'}</div>
              <button onClick={() => setShowMailModal(false)} className="mono text-[11px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100" style={{ color: 'var(--ink)' }}>✕</button>
            </div>
            <div className="mono text-[10.5px] uppercase tracking-[0.14em] mb-4" style={{ color: 'var(--text-soft)' }}>
              {isBucket ? `${ctxCourse} · ${ctxYear} · נפתח ב‑Outlook שלך` : 'הנבחרים · נפתח ב‑Outlook שלך'}
            </div>

            {/* Division selector (bucket mode only) */}
            {isBucket && (
              <div className="flex flex-wrap gap-2 mb-4">
                {MAIL_BUCKETS.map(b => {
                  const n = scoped.filter(b.test).length;
                  const active = mailBucket === b.key;
                  return (
                    <button key={b.key} onClick={() => setMailBucket(b.key)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border mono text-[11px] font-semibold transition-colors"
                      style={{
                        borderColor: active ? 'var(--accent)' : 'var(--divider)',
                        color: active ? 'white' : 'var(--text-soft)',
                        background: active ? 'var(--accent)' : 'transparent',
                      }}>
                      {b.label}<span style={{ opacity: 0.7 }}>{n}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Recipient summary */}
            <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(122,30,43,0.06)' }}>
              <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold mb-1.5" style={{ color: 'var(--accent)' }}>
                {withEmail.length} נמענים
              </div>
              <div data-mail-recipients className="text-[12.5px] leading-[1.7]" style={{ color: 'var(--ink)', maxHeight: 120, overflowY: 'auto' }}>
                {recipients.length === 0 ? 'אין סטודנטים בקבוצה זו.' : recipients.map(s => s.name).filter(Boolean).join(' · ')}
              </div>
            </div>
            {noEmail.length > 0 && (
              <div className="mb-4 p-3 rounded-lg text-[12.5px]" style={{ background: 'rgba(180,60,60,0.08)', color: '#b03030', border: '1px solid rgba(180,60,60,0.2)' }}>
                ⚠ ללא מייל (לא ייכללו): {noEmail.map(s => s.name).join(', ')}
              </div>
            )}
            <label className="block mb-3">
              <span className="mono text-[11px] uppercase tracking-[0.14em] mb-1 block" style={{ color: 'var(--text-soft)' }}>נושא</span>
              <input value={mailSubject} onChange={e => setMailSubject(e.target.value)} className="input w-full" style={{ padding: '10px 14px', fontSize: '14px' }} placeholder="נושא ההודעה..." />
            </label>
            <label className="block mb-5">
              <span className="mono text-[11px] uppercase tracking-[0.14em] mb-1 block" style={{ color: 'var(--text-soft)' }}>תוכן</span>
              <textarea value={mailBody} onChange={e => setMailBody(e.target.value)} rows={5} className="input w-full" style={{ padding: '10px 14px', fontSize: '14px', resize: 'vertical' }} placeholder="תוכן ההודעה..." />
            </label>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowMailModal(false)} className="btn">ביטול</button>
              <button
                disabled={withEmail.length === 0}
                onClick={() => {
                  const emails = withEmail.map(s => s.email).filter(Boolean) as string[];
                  if (emails.length === 0) { showToast('לאף אחד בקבוצה זו אין מייל רשום', 'error'); return; }
                  const bcc = emails.join(',');
                  openMailto(`mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`);
                  showToast(`✓ נפתח Outlook ל‑${emails.length} נמענים`, 'success');
                  setShowMailModal(false);
                  setMailSubject(''); setMailBody('');
                  if (!isBucket) { setSelectedIds(new Set()); }
                }}
                style={{ ...btnPrimary(), opacity: withEmail.length === 0 ? 0.5 : 1, cursor: withEmail.length === 0 ? 'not-allowed' : 'pointer' }}
              >📧 פתח ב‑Outlook →</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Email confirmation modal ── */}
      {emailConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(26,22,18,0.6)' }}>
          <div className="rounded-2xl border p-8 max-w-[560px] w-full mx-4" style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
            <div className="flex items-baseline justify-between mb-1">
              <div className="serif text-[24px]" style={{ color: 'var(--ink)' }}>
                {emailConfirm.type === 'acceptance' ? '✉ הודעת קבלה' : '✉ הודעת דחייה'}
              </div>
              <button onClick={() => setEmailConfirm(null)} className="mono text-[11px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100" style={{ color: 'var(--ink)' }}>✕</button>
            </div>
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-5" style={{ color: 'var(--text-soft)' }}>
              בדוק/י לפני שליחה — המייל ייצא רק לאחר אישורך
            </div>
            <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--divider)' }}>
              <div className="mono text-[10px] uppercase tracking-[0.15em] mb-2 font-semibold" style={{ color: 'var(--text-soft)' }}>
                שולחים ל‑{emailConfirm.recipients.length} נמענים
              </div>
              <div className="text-[13px] leading-[1.7]" style={{ color: 'var(--ink)' }}>
                {emailConfirm.recipients.map(r => r.name).join(' · ')}
              </div>
              {emailConfirm.recipients.length > 1 && (
                <div className="mono text-[10.5px] mt-2" style={{ color: 'var(--text-soft)' }}>
                  {'ⓘ שליחה קבוצתית — כולם ב‑BCC, ללא שם אישי ({{שם}} יוחלף ב‑[שם הנמען])'}
                </div>
              )}
            </div>
            <label className="block mb-3">
              <span className="mono text-[11px] uppercase tracking-[0.14em] mb-1 block" style={{ color: 'var(--text-soft)' }}>נושא</span>
              <input value={emailConfirm.subject} onChange={e => setEmailConfirm(p => p ? { ...p, subject: e.target.value } : null)} className="input w-full" style={{ padding: '10px 14px', fontSize: '14px' }} />
            </label>
            <label className="block mb-2">
              <span className="mono text-[11px] uppercase tracking-[0.14em] mb-1 block" style={{ color: 'var(--text-soft)' }}>תוכן</span>
              <textarea value={emailConfirm.body} onChange={e => setEmailConfirm(p => p ? { ...p, body: e.target.value } : null)} rows={7} className="input w-full" style={{ padding: '10px 14px', fontSize: '13.5px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
            </label>
            <div className="mono text-[10.5px] mb-5" style={{ color: 'var(--text-soft)' }}>
              {'ⓘ ניתן לערוך נושא ותוכן. לנמען יחיד — {{שם}} יוחלף בשמו האישי.'}
            </div>
            <div className="flex gap-3 justify-between items-center">
              <button onClick={() => setEmailConfirm(null)} style={{ ...btnSecondary(), fontSize: '12px' }}>ביטול — אל תשלח</button>
              <button onClick={sendConfirmedEmail} style={{ ...btnPrimary(), fontSize: '13px' }}>
                📧 פתח ב‑Outlook ({emailConfirm.recipients.length}) →
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialog && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => setDeleteDialog(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg)',
              borderRadius: '16px',
              padding: '28px 28px 24px',
              maxWidth: '400px',
              width: '100%',
              boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
              border: '1px solid var(--divider)',
            }}
          >
            <div className="serif text-[22px] mb-1" style={{ color: 'var(--ink)' }}>מחיקת סטודנט</div>
            <div className="text-[14px] mb-6 leading-[1.6]" style={{ color: 'var(--text-soft)' }}>
              כיצד למחוק את <strong style={{ color: 'var(--ink)' }}>{deleteDialog.name}</strong>?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => confirmDeleteAll(deleteDialog)}
                style={{ ...btnPrimary(), width: '100%', textAlign: 'right' }}
              >
                מחק הכל — כולל מועמדות →
              </button>
              <button
                onClick={() => confirmKeepAsCandidate(deleteDialog)}
                style={{ ...btnSecondary(), width: '100%', textAlign: 'right' }}
              >
                הסר כסטודנט — השאר כמועמד
              </button>
              <button
                onClick={() => setDeleteDialog(null)}
                className="mono text-[11px] uppercase tracking-[0.14em] font-semibold"
                style={{ color: 'var(--text-soft)', paddingTop: '6px' }}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {(editing || creating) && (
        <StudentEditor
          student={editing}
          courses={courses}
          years={years}
          employers={employers}
          defaultCourseId={context.courseId}
          defaultYear={context.year}
          onSave={handleSave}
          onAutoSave={editing ? handleAutoSave : undefined}
          onDelete={editing ? handleDelete : undefined}
          onClose={() => { setEditing(null); setCreating(false); }}
          onApproveSuggestion={async (emp, ctx) => {
            // Mirror the Employers-page approve: persist the private employer (with a
            // reserved place for the student's course), set the student's
            // firstChoiceOrg, AND dismiss the suggestion — all in ONE save. The old
            // handler wrote only employers, so firstChoiceOrg (set in the editor's
            // local form) was silently lost and the suggestion re-appeared in the
            // banner (dismissedSuggestionIds is the real "handled" marker since
            // seen_at is RLS-blocked).
            const empWithPlace = ctx.courseId ? setCourseCapacity(emp, ctx.courseId, 1) : emp;
            const updatedEmps = [...employers, empWithPlace];
            const updatedStudents = (data.students || []).map((s: Student) => s.id === ctx.studentId
              ? { ...s, firstChoiceOrg: ctx.firstChoiceOrgName, firstChoiceResult: s.firstChoiceResult || 'pending' } as Student
              : s);
            const dismissed = ctx.suggestionId
              ? Array.from(new Set([...(((data as any).dismissedSuggestionIds as string[]) || []), ctx.suggestionId]))
              : (((data as any).dismissedSuggestionIds as string[]) || []);
            setSaving(true);
            const res = await saveSnapshot(
              { ...data, employers: updatedEmps, students: updatedStudents, dismissedSuggestionIds: dismissed },
              { name: userName },
              { action: 'אישר הצעת ארגון', entity: 'ארגון', target: emp.name }
            );
            setSaving(false);
            if (res.ok) {
              (data.employers as any) = updatedEmps;
              (data.students as any) = updatedStudents;
              (data as any).dismissedSuggestionIds = dismissed;
              showToast('✓ הצעת הארגון אושרה — נוסף כארגון פרטי ונקבע כבחירה ראשונה', 'success');
              onRefresh();
            } else {
              showToast('שגיאה בשמירה: ' + (res.error || ''), 'error');
            }
          }}
          placementExtras={editing ? {
            allStudents: all,
            dispatches: data.dispatches || [],
            approvalRequests: data.employerApprovalRequests || [],
            placementSettings: data.placementSettings || {},
            userName,
            onDataChange: async (patch: Partial<PracticumData>) => {
              setSaving(true);
              const res = await saveSnapshot({ ...data, ...patch }, { name: userName });
              setSaving(false);
              if (res.ok) onRefresh();
              else showToast('שגיאה בשמירה: ' + (res.error || ''), 'error');
            },
          } : undefined}
        />
      )}
    </main>
  );
}

export function GroupHeader({ year, courseName, count, showYear }: { year: string; courseName: string; count: number; showYear: boolean }) {
  return (
    <div className="flex items-center gap-3 pt-8 pb-2 sticky top-[88px] z-10"
      style={{ background: 'var(--bg)', borderBottom: '1px solid var(--divider)' }}>
      {showYear && (
        <>
          <span className="chapter-mark">{year}</span>
          <span style={{ color: 'var(--divider)', fontWeight: 300 }}>·</span>
        </>
      )}
      <span className="serif text-[17px]" style={{ color: 'var(--ink)' }}>{courseName}</span>
      <span className="mono text-[11px] px-2 py-0.5 rounded-full"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{count}</span>
    </div>
  );
}

/* The contact-button look — one 36px outline circle per channel, wine on the page
   ground. Hoisted out of StudentRow (values unchanged) and exported so the
   candidates page renders the SAME control instead of its own emoji set; Yariv
   2026-08-13: "האיקונים של התקשורת בדף מועמד נראים מוזר … ידמו לאיקונים הקיימים
   בדף סטודנט". One definition means the two rows cannot drift apart again. */
export const contactBtn = 'inline-grid place-items-center w-9 h-9 rounded-full shrink-0 transition-colors hover:bg-[rgba(122,30,43,0.06)]';
export const contactStyle = { background: 'var(--bg)', border: '0.5px solid rgba(122,30,43,0.25)', color: 'var(--accent)' } as const;

function StudentRow({ s, onEdit, pinned, onTogglePin, selected, onToggleSelect, employers = [], status, onAction }: {
  s: Student; onEdit: () => void; pinned: boolean; onTogglePin: () => void;
  selected?: boolean; onToggleSelect?: () => void; employers?: Employer[];
  status?: PlacementStatus; onAction?: (a: PlacementAction) => void;
}) {
  const placed = !!s.acceptedOrg;
  // Hosting org contact — so the coordinator can reach the EMPLOYER straight from the
  // list (distinct from the student-contact icons on the right). Resolved fuzzily.
  const hostEmp = placed ? resolveEmployerForOrg(s.acceptedOrg, employers) : undefined;
  const hostPhone = hostEmp?.contactPhone || '';
  const hostEmail = firstEmailOf(hostEmp?.contactEmail);
  // Shared contact actions — the STUDENT and the ORG use the same handlers + the same
  // icon buttons (identical style + size), so the two contact rows read as one system.
  const canDial = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)')?.matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
  const doCall = (phone: string, label: string) => { const tel = phone.replace(/[^\d+]/g, ''); if (canDial) { window.location.href = `tel:${tel}`; } else if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(phone).then(() => showToast(`📞 ${label}: ${phone} · הועתק`, 'success'), () => showToast(`📞 ${phone}`, 'info')); } else { showToast(`📞 ${phone}`, 'info'); } };
  const toWa = (phone: string) => { let n = phone.replace(/[^\d]/g, ''); if (n.startsWith('0')) n = '972' + n.slice(1); return n; };
  const stuCall = (e: any) => { e.stopPropagation(); if (s.phone) doCall(s.phone, s.name || ''); };
  const stuWa = (e: any) => { e.stopPropagation(); if (s.phone) window.open(`https://wa.me/${toWa(s.phone)}`, '_blank'); };
  const stuMail = (e: any) => { e.stopPropagation(); if (s.email) openMailto(`mailto:${s.email}?subject=${encodeURIComponent(`פרקטיקום — ${s.name || ''}`)}`); };
  const orgCall = (e: any) => { e.stopPropagation(); if (hostPhone) doCall(hostPhone, hostEmp?.name || ''); };
  const orgWa = (e: any) => { e.stopPropagation(); if (hostPhone) window.open(`https://wa.me/${toWa(hostPhone)}?text=${encodeURIComponent(`שלום, בנוגע ל${s.name || ''} המתמחה אצלכם בפרקטיקום — `)}`, '_blank'); };
  const orgMail = (e: any) => { e.stopPropagation(); if (hostEmail) openMailto(`mailto:${hostEmail}?subject=${encodeURIComponent(`פרקטיקום — ${s.name || ''}`)}`); };
  const hired = !!s.hired;
  const completed = !!s.practicumCompleted;
  const prepPassed = !!s.preparation?.passed;

  const dotStatus: DotStatus =
    completed ? 'amber' :
    hired || placed ? 'green' :
    prepPassed ? 'amber' :
    'gray';

  const stage =
    completed ? 'סיים/סיימה פרקטיקום' :
    hired ? 'נקלט/ה לעבודה' :
    placed ? 'בהתנסות' :
    prepPassed ? 'בחיפוש ארגון' :
    s.fromCandidate ? 'ממתין/ה להכנה' :
    'פעיל/ה';

  return (
    <li className="relative group" data-info-row data-student-row={s.id}>
      {/* The between-students separator is the PRIMARY divider: thicker + the stronger token.
          NB: not the `border-b` class — a global `.border-b{…!important}` rule pins that to the
          light --divider, so the border is set inline (no class) to win the cascade. */}
      <div
        onClick={onTogglePin}
        className="py-4 cursor-pointer hover:bg-[rgba(122,30,43,0.02)]"
        style={{ borderBottom: '2px solid var(--divider-strong)', background: selected ? 'rgba(122,30,43,0.04)' : undefined }}
      >
        {/* The card splits into two zones — STUDENT (right, in RTL): name · status tags ·
            the student's own contacts + edit; and ORG (left): the hosting org + how to
            reach it. A hairline divider makes the split unmistakable. */}
        <div className="flex items-stretch gap-4">
          {/* ── STUDENT zone (right) ── */}
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span
                role="checkbox"
                aria-checked={selected}
                title="בחר/י לשליחת מייל קבוצתי"
                onClick={e => { e.stopPropagation(); onToggleSelect?.(); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  border: `2px solid ${selected ? 'var(--accent)' : 'var(--divider)'}`,
                  background: selected ? 'var(--accent)' : 'transparent',
                  color: 'white', fontSize: 11, cursor: 'pointer',
                }}
              >{selected ? '✓' : ''}</span>
              <StatusDot status={dotStatus} size={9} />
              <div className="serif text-[20px] leading-tight tracking-tight flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>
                {s.name || 'ללא שם'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
                {(!s.phone || !s.email) && <NeedsUpdate />}
                {s.cvUrl && !prepPassed && !placed && !hired && !completed && <Tag label="📄" muted />}
                {prepPassed && !placed && !hired && !completed && <Tag label="✓ הכנה" muted />}
                {s.cvUpdatedUrl ? <Tag label="CV ✓" /> : prepPassed && <Tag label="CV נדרש" color="#b45309" />}
                {/* Placement and completion are INDEPENDENT facts — "סיים" must not hide
                    where the student did the practicum (Yariv 2026-07-29). A finished
                    student shows both: נקלט/ה + ✓ סיים. */}
                {placed && !hired && <Tag label="שובץ/ה" />}
                {hired && <Tag label="נקלט/ה" solid />}
                {completed && <Tag label="✓ סיים" color="#b45309" />}
                {hasEmployerFeedback(s) && <Tag label="✓ משוב" color="#15803d" />}
                {s.acceptanceEmailSent && <Tag label="✉ קבלה" muted />}
                {s.rejectionEmailSent && <Tag label="✉ דחייה" muted />}
              </div>
              {/* Open-card (edit) — a BARE pencil (no capsule) in the empty left area of the tag
                  block, vertically centred between the tag lines. Pulled OUT of the contact row
                  so that row now mirrors the org's exactly (call/WhatsApp/mail); a bare glyph
                  (vs a filled circle) no longer reads as sitting on the student↔org hairline.
                  title stays exactly "ערוך" — several gate cells locate it by that title. */}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onEdit(); }}
                title="ערוך"
                aria-label="ערוך / פתח כרטיס סטודנט"
                className="shrink-0 self-center grid place-items-center w-9 h-9 -my-1 rounded-md transition-colors hover:bg-[rgba(122,30,43,0.08)] active:scale-95"
                style={{ color: 'var(--accent)', background: 'transparent', border: 'none' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </div>
            <div className="flex items-center gap-2 mt-auto pt-1" onClick={e => e.stopPropagation()}>
              {s.phone && <button type="button" onClick={stuCall} title="התקשר לסטודנט/ית" aria-label="התקשר לסטודנט/ית" className={contactBtn} style={contactStyle}><PhoneIcon size={16} /></button>}
              {s.phone && <button type="button" onClick={stuWa} title="WhatsApp לסטודנט/ית" aria-label="WhatsApp לסטודנט/ית" className={contactBtn} style={contactStyle}><WhatsAppIcon size={16} /></button>}
              {s.email && <button type="button" onClick={stuMail} title="מייל לסטודנט/ית" aria-label="מייל לסטודנט/ית" className={contactBtn} style={contactStyle}><MailIcon size={16} /></button>}
            </div>
          </div>

          {/* ── divider + ORG zone (left) ──
              The student↔org split is SECONDARY to the between-students separator, so this
              hairline stays on the lighter --divider token and is inset vertically (shorter
              than the full card height) — it reads as a within-card guide, not a row break. */}
          <div style={{ width: '1px', background: 'var(--divider)', flexShrink: 0, margin: '3px 0' }} />
          <div className="flex flex-col gap-1.5 shrink-0" style={{ width: '38%', maxWidth: 190 }} onClick={e => e.stopPropagation()}>
            {placed ? (
              <>
                <div className="flex items-center gap-1.5 min-w-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
                    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M9 7h1M9 11h1M9 15h1M14 7h1M14 11h1M14 15h1"/>
                  </svg>
                  <span className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--accent)' }}>{s.acceptedOrg}</span>
                </div>
                {hostEmp && (hostPhone || hostEmail) ? (
                  <div className="flex items-center gap-2 mt-auto pt-1">
                    {hostPhone && <button type="button" onClick={orgCall} title={`התקשר לארגון ${hostEmp.name}`} aria-label={`התקשר לארגון ${hostEmp.name}`} className={contactBtn} style={contactStyle}><PhoneIcon size={16} /></button>}
                    {hostPhone && <button type="button" onClick={orgWa} title={`WhatsApp לארגון ${hostEmp.name}`} aria-label={`WhatsApp לארגון ${hostEmp.name}`} className={contactBtn} style={contactStyle}><WhatsAppIcon size={16} /></button>}
                    {hostEmail && <button type="button" onClick={orgMail} title={`מייל לארגון ${hostEmp.name}`} aria-label={`מייל לארגון ${hostEmp.name}`} className={contactBtn} style={contactStyle}><MailIcon size={16} /></button>}
                  </div>
                ) : (
                  <span className="mono text-[10px] mt-auto pt-1" style={{ color: 'var(--text-soft)' }}>אין פרטי קשר לארגון</span>
                )}
              </>
            ) : (
              <span className="text-[11.5px] my-auto" style={{ color: 'var(--text-soft)' }}>טרם שובץ/ה בארגון</span>
            )}
          </div>
        </div>

        {/* Placement strip — always present on a practicum row, so an absent strip can
            never be read as "no information" (Yariv 2026-08-09). The card grows; nothing
            above it moves. */}
        {status && onAction && (
          <div style={{ marginTop: 12 }}>
            <PlacementStrip status={status} employers={employers} onAction={onAction} />
          </div>
        )}
      </div>

      {/* Hover + pinned details popover */}
      <Popover pinned={pinned} onRequestClose={onTogglePin}>
        <div className="flex items-baseline justify-between gap-3 pb-3 mb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
          <div>
            {/* A name is user data and can be long; without a break rule it pushed the
                popover — and the page — past the screen (found 2026-08-11 by stressing
                the widest data-bearing name on each screen). */}
            <div className="serif text-[22px] leading-[1.15]"
              style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>{s.name}</div>
            <div className="mono text-[10.5px] uppercase tracking-[0.14em] mt-1" style={{ color: 'var(--accent)' }}>
              שלב: {stage}
            </div>
          </div>
          {pinned && (
            <button type="button" onClick={onTogglePin} title="סגור"
              className="shrink-0 grid place-items-center w-7 h-7 rounded-full border mono text-[12px] font-semibold opacity-70 hover:opacity-100"
              style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>
              ✕
            </button>
          )}
        </div>

        <div className="space-y-1.5 text-[13px]">
          <DetailRow label="טלפון" value={s.phone} />
          <DetailRow label="מייל" value={s.email} />
          <DetailRow label="עיר" value={s.city} />
          <DetailRow label="שנה" value={s.year} />
          <DetailRow label="הכנה" value={prepPassed ? `עבר/ה ${s.preparation?.date ? '· ' + new Date(s.preparation.date).toLocaleDateString('he-IL') : ''}` : 'טרם'} />
          <DetailRow label="שובץ ב" value={s.acceptedOrg} accent />
          <DetailRow label="שעות" value={s.hoursApproved ? `${s.hoursApproved} מאושרות / ${s.hoursReported || 0} דיווח` : undefined} />
          <DetailRow label="CV" value={s.cvUrl ? '✓ זמין' : undefined} />
          <DetailRow label="CV מעודכן" value={s.cvUpdatedUrl ? '✓ הוגש' : prepPassed ? '⚠ נדרש' : undefined} accent={!!s.cvUpdatedUrl} warn={!s.cvUpdatedUrl && prepPassed} />
          {s.notes && <DetailRow label="הערות" value={s.notes} />}
        </div>
      </Popover>
    </li>
  );
}

/**
 * Shared popover wrapper that flips above the row when near viewport bottom
 * so details aren't cut off. Used by Students/Candidates/Employers rows.
 */
export function Popover({ pinned, children, onRequestClose }: { pinned: boolean; children: any; onRequestClose?: () => void }) {
  const [flipUp, setFlipUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const el = ref.current?.parentElement as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popoverHeight = 360; // approximate
    const viewportHeight = window.innerHeight;
    setFlipUp(rect.bottom + popoverHeight > viewportHeight - 20);
  }, [pinned]);

  // Bulletproof dismissal: Escape and any click/tap outside the popover close it.
  // Without this the only way out is the small ✕, and if that single target ever
  // misses (overlap, hover quirk, mis-tap) the card feels "stuck".
  useEffect(() => {
    if (!pinned || !onRequestClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onRequestClose(); };
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onRequestClose();
    };
    document.addEventListener('keydown', onKey);
    // Defer attaching the outside-listener so the click that OPENED the popover
    // (still propagating) doesn't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('touchstart', onDown);
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [pinned, onRequestClose]);

  return (
    <div
      ref={ref}
      data-popover-open={pinned ? 'true' : undefined}
      className={`absolute z-40 right-0 rounded-xl shadow-xl border p-5 transition-opacity ${flipUp ? 'bottom-full mb-1' : 'top-full mt-1'} ${pinned ? 'opacity-100 visible' : 'invisible opacity-0 pointer-events-none'}`}
      style={{
        background: 'var(--bg)',
        borderColor: 'var(--divider)',
        boxShadow: '0 16px 48px rgba(26, 22, 18, 0.2)',
        // Capped to the viewport — see InfoPopover: an `invisible` absolute box wider than
        // the screen still widens the PAGE, which is what made the list scroll sideways.
        minWidth: 'min(360px, calc(100vw - 28px))', maxWidth: 'min(440px, calc(100vw - 28px))',
      }}
      onClick={e => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function DetailRow({ label, value, accent, warn }: { label: string; value?: string | number | null; accent?: boolean; warn?: boolean }) {
  if (value == null || value === '' || value === 0) return null;
  const color = accent ? 'var(--accent)' : warn ? '#b45309' : 'var(--ink)';
  return (
    <div className="flex items-baseline gap-3">
      <span className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold w-20 shrink-0" style={{ color: 'var(--text-soft)' }}>
        {label}
      </span>
      <span style={{ color }}>{String(value)}</span>
    </div>
  );
}

export function RowActions({
  phone, email, name, onEdit, calendarUrl, onCalendar,
}: { phone?: string; email?: string; name?: string; onEdit: () => void; calendarUrl?: string; onCalendar?: () => void }) {
  function call() {
    if (!phone) return;
    const tel = phone.replace(/[^\d+]/g, '');
    // On a real phone (touch device) tel: dials natively. On desktop tel: is a
    // silent no-op — there's no phone app to hand off to — which reads as a
    // dead button. So on desktop we give visible feedback instead: copy the
    // number to the clipboard and toast it, the same way WhatsApp opens a tab.
    const canDial = typeof window !== 'undefined' && (
      window.matchMedia?.('(pointer: coarse)')?.matches ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    );
    if (canDial) {
      window.location.href = `tel:${tel}`;
      return;
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(phone).then(
        () => showToast(`📞 ${phone} · המספר הועתק`, 'success'),
        () => showToast(`📞 ${phone}`, 'info'),
      );
    } else {
      showToast(`📞 ${phone}`, 'info');
    }
  }
  function wa() {
    if (!phone) return;
    let n = phone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}`, '_blank');
  }
  function mail() {
    if (!email) return;
    const subject = encodeURIComponent(`פרקטיקום — ${name || ''}`);
    openMailto(`mailto:${email}?subject=${subject}`);
  }
  function cal() {
    if (onCalendar) { onCalendar(); return; }
    if (calendarUrl) window.open(calendarUrl, '_blank');
  }
  // Contact buttons: bumped from 28px → 32px for an easier mouse target.
  const btn = "w-8 h-8 rounded-full border grid place-items-center transition-colors hover:bg-[rgba(122,30,43,0.08)] shrink-0";
  const style = { borderColor: 'var(--divider)', color: 'var(--ink)' };
  return (
    <div className="flex items-center gap-2">
      {calendarUrl !== undefined && calendarUrl && (
        <button type="button" onClick={cal} title="פתח ב-Outlook" className={btn} style={style}>📅</button>
      )}
      {phone && <button type="button" onClick={call} title="התקשר" className={btn} style={style}>📞</button>}
      {phone && <button type="button" onClick={wa} title="WhatsApp" className={btn} style={style}>💬</button>}
      {email && <button type="button" onClick={mail} title="מייל" className={btn} style={style}>✉</button>}
      {/* Edit = the PRIMARY action, and the one users reach for most. The old
          28px outline circle was a small target that only "lit up" on hovering
          its exact centre, so off-centre clicks felt dead and you had to click
          several times to enter edit mode. Now: a 40px tap target, always tinted
          (so it visibly reads as a button without needing hover), with a roomy
          hit zone. title + aria-label keep selectors/accessibility intact. */}
      <button type="button" onClick={onEdit} title="ערוך" aria-label="ערוך"
        className="w-10 h-10 rounded-full border grid place-items-center transition-transform hover:brightness-95 active:scale-95 shrink-0"
        style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'rgba(122,30,43,0.10)' }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
    </div>
  );
}

export function NeedsUpdate() {
  return (
    <span className="mono text-[9.5px] uppercase tracking-[0.14em] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: 'rgba(180,60,60,0.1)', color: '#b03030', border: '1px solid rgba(180,60,60,0.25)' }}>
      נדרש עדכון
    </span>
  );
}

export function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');
  function handleClick() {
    if (phase !== 'idle') return;
    setPhase('loading');
    onRefresh();
    setTimeout(() => setPhase('done'), 1100);
    setTimeout(() => setPhase('idle'), 2600);
  }
  return (
    <button
      onClick={handleClick}
      disabled={phase !== 'idle'}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all duration-200 disabled:cursor-default"
      style={{
        borderColor: phase === 'done' ? 'var(--accent)' : 'var(--divider)',
        color: phase === 'done' ? 'var(--accent)' : 'var(--ink)',
        background: phase === 'done' ? 'rgba(122,30,43,0.06)' : 'transparent',
        fontSize: '11px',
        letterSpacing: '0.13em',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          fontSize: '13px',
          lineHeight: 1,
          animation: phase === 'loading' ? 'practicum-spin 0.7s linear infinite' : 'none',
          transform: phase === 'done' ? 'none' : undefined,
        }}
      >
        {phase === 'done' ? '✓' : '↻'}
      </span>
      <span className="mono font-semibold uppercase" style={{ letterSpacing: '0.13em', fontSize: '11px' }}>
        {phase === 'done' ? 'עודכן' : phase === 'loading' ? 'מעדכן...' : 'רענן'}
      </span>
    </button>
  );
}

/* ── StatusDot ─────────────────────────────────────────────────────────
   Shared traffic-light dot used across Students, Candidates, Lectures.
   Import from here: import { StatusDot } from './StudentsPage'          */
export type DotStatus = 'gray' | 'amber' | 'green' | 'teal' | 'red';

export function StatusDot({ status, size = 9 }: { status: DotStatus; size?: number }) {
  const bg: Record<DotStatus, string> = {
    gray:  'var(--tl-gray)',
    amber: 'var(--tl-amber)',
    green: 'var(--tl-green)',
    teal:  '#0d9488',
    red:   'var(--tl-red)',
  };
  const c = bg[status];
  return (
    <span
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        background: c,
        boxShadow: `0 0 0 2.5px ${c}2a`,
      }}
    />
  );
}

function Tag({ label, solid, muted, color }: { label: string; solid?: boolean; muted?: boolean; color?: string }) {
  if (muted) {
    return (
      <span className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2.5 py-0.5 rounded-full"
        style={{ color: 'var(--text-soft)', background: 'transparent', border: '1px solid var(--divider)' }}>
        {label}
      </span>
    );
  }
  if (color) {
    return (
      <span className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2.5 py-0.5 rounded-full"
        style={{ color: '#fff', background: color }}>
        {label}
      </span>
    );
  }
  return (
    <span className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2.5 py-0.5 rounded-full"
      style={{
        color: solid ? 'var(--bg)' : 'var(--accent)',
        background: solid ? 'var(--accent)' : 'rgba(122, 30, 43, 0.08)',
      }}>
      {label}
    </span>
  );
}
