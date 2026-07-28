/**
 * Public employer feedback form — /feedback?token=<feedbackToken>
 *
 * Uses the same evaluation structure as EvaluationForm (10 criteria, overall
 * score, recommendation, free-text fields). On submit, saves structured text
 * to student.feedbackText + feedbackSubmittedAt + hired.
 */

import { useState, useEffect, useRef } from 'react';
import { publicSupabase as supabase } from '../lib/supabase';
import { saveSnapshot } from '../lib/dataApi';
import { useFormDraft, draftSavedLabel } from '../lib/useFormDraft';
import type { Student, PracticumData } from '../lib/supabase';

type Phase = 'loading' | 'not-found' | 'already-done' | 'form' | 'submitting' | 'done' | 'error';

const CRITERIA_GROUPS = [
  {
    label: 'יחסי אנוש ותקשורת',
    items: ['יחסי אנוש ועבודת צוות', 'כישורי תקשורת כתובים', 'כישורי תקשורת בעל‑פה'],
  },
  {
    label: 'מקצועיות ואחריות',
    items: ['אחריות ועמידה בזמנים', 'שליטה בתחום המקצועי', 'תרומה כללית לארגון'],
  },
  {
    label: 'יכולת ולמידה',
    items: ['יוזמה ועצמאות בעבודה', 'יכולת למידה והסתגלות', 'כישורי ניתוח וחשיבה', 'התמודדות עם לחץ'],
  },
];

type RatingMap = Record<string, number | 'na'>;

export default function EmployerFeedback() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [student, setStudent] = useState<Student | null>(null);
  const [allData, setAllData] = useState<PracticumData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Section ב — placement details
  const [mentor, setMentor] = useState('');
  const [mentorRole, setMentorRole] = useState('');
  const [period, setPeriod] = useState('');

  // Section ג — criteria ratings
  const [ratings, setRatings] = useState<RatingMap>({});
  const [groupNotes, setGroupNotes] = useState<Record<string, string>>({});

  // Section ד — overall
  const [overallScore, setOverallScore] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [hired, setHired] = useState(false);

  // Accept the short `/f?t=` link and the legacy `/feedback?token=` link so
  // links already sent to employers keep working. Trim to defend against a
  // stray space a mail client might append.
  const token = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('t')
        || new URLSearchParams(window.location.search).get('token')
        || '').trim()
    : '';

  // ── Nothing typed here may ever be lost ────────────────────────────────────
  // Two supervisors filled this form on 2026-07-09, could not submit (see the
  // validation fix in handleSubmit), and every word was unrecoverable — it lived
  // only in React memory. Persist continuously, keyed to this employer's own link.
  const draft = useFormDraft(
    token ? `practicum_draft_feedback_${token}` : null,
    'v2',
    { mentor, mentorRole, period, ratings, groupNotes, overallScore, recommendation, strengths, improvements, additionalNotes, hired },
    (v) => {
      if (v.mentor) setMentor(v.mentor as string);
      if (v.mentorRole) setMentorRole(v.mentorRole as string);
      if (v.period) setPeriod(v.period as string);
      if (v.ratings) setRatings(v.ratings as RatingMap);
      if (v.groupNotes) setGroupNotes(v.groupNotes as Record<string, string>);
      if (v.overallScore) setOverallScore(v.overallScore as string);
      if (v.recommendation) setRecommendation(v.recommendation as string);
      if (v.strengths) setStrengths(v.strengths as string);
      if (v.improvements) setImprovements(v.improvements as string);
      if (v.additionalNotes) setAdditionalNotes(v.additionalNotes as string);
      if (typeof v.hired === 'boolean') setHired(v.hired as boolean);
    },
  );

  // Which required field blocked the submit, so we can say so IN HEBREW, in place.
  const [missingField, setMissingField] = useState<'score' | 'recommendation' | null>(null);
  const scoreRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) { setPhase('not-found'); return; }
    load();
  }, [token]);

  async function load() {
    setPhase('loading');
    const { data: row, error } = await supabase
      .from('practicum_data')
      .select('data')
      .eq('org_id', 'default')
      .single();
    if (error || !row) { setPhase('not-found'); return; }
    const d = (row as any).data as PracticumData;
    const found = (d.students || []).find(s => s.feedbackToken === token);
    if (!found) { setPhase('not-found'); return; }
    if (found.feedbackSubmittedAt) { setPhase('already-done'); setStudent(found); return; }
    setStudent(found);
    setAllData(d);
    // Pre-fill mentor from employers list if available
    const emp = (d.employers || []).find(e => e.name === found.acceptedOrg);
    if (emp?.contactPerson) setMentor(emp.contactPerson);
    if (found.hoursReported) setPeriod(`${found.hoursReported} שעות`);
    setPhase('form');
  }

  function setRating(criterion: string, val: number | 'na') {
    setRatings(prev => ({ ...prev, [criterion]: val }));
  }

  function buildFeedbackJson(): string {
    return JSON.stringify({
      v: 2,
      mentor, mentorRole, period,
      ratings, groupNotes,
      overallScore, recommendation,
      strengths, improvements, additionalNotes,
      hired,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!student || !allData) return;
    // The form is <form noValidate>: the BROWSER must not police it. With the native
    // `required` active, Chrome blocked the submit with an English tooltip anchored to
    // a field ~930px above the button — off-screen on a phone — so the page appeared
    // to do nothing and these Hebrew checks below were unreachable dead code. Two
    // supervisors gave up that way (נעמה ביטרמן, שיראל קורן — 2026-07-09). We now
    // validate ourselves and SHOW the reason, in Hebrew, at the field.
    const focusMissing = (which: 'score' | 'recommendation') => {
      setMissingField(which);
      const el = which === 'score' ? scoreRef.current : recRef.current;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (which === 'score') setTimeout(() => scoreRef.current?.focus(), 350);
    };
    if (!overallScore) { focusMissing('score'); return; }
    if (!recommendation) { focusMissing('recommendation'); return; }
    setMissingField(null);
    setPhase('submitting');
    const now = new Date().toISOString();
    const feedbackText = buildFeedbackJson();
    const updatedStudent: Student = {
      ...student,
      feedbackText,
      hired,
      feedbackSubmittedAt: now,
    };
    const nextStudents = (allData.students || []).map(s =>
      s.id === student.id ? updatedStudent : s
    );
    const res = await saveSnapshot(
      { ...allData, students: nextStudents },
      { name: 'מעסיק (משוב)' },
      { action: 'משוב מעסיק התקבל', entity: 'סטודנט', target: student.name }
    );
    if (!res.ok) {
      // Keep the draft — the whole point is that a failed save never costs them
      // their work. They can retry from the same link with everything still filled.
      setErrorMsg(res.error || 'שגיאה בשמירה');
      setPhase('error');
      return;
    }
    draft.clear(); // safely stored server-side — only now is the local copy redundant
    setPhase('done');
  }

  if (phase === 'loading') return <PageShell><Spinner /></PageShell>;

  if (phase === 'not-found') return (
    <PageShell>
      <div className="text-center py-16">
        <div className="serif text-[32px] mb-3" style={{ color: 'var(--ink)' }}>הקישור אינו תקין</div>
        <div className="text-[15px]" style={{ color: 'var(--text-soft)' }}>ייתכן שהקישור פג תוקף או שגוי. פנה/י לרכזת הפרקטיקום.</div>
      </div>
    </PageShell>
  );

  if (phase === 'already-done') return (
    <PageShell>
      <div className="text-center py-16">
        <div className="text-[48px] mb-4">✅</div>
        <div className="serif text-[28px] mb-2" style={{ color: 'var(--ink)' }}>המשוב כבר התקבל</div>
        <div className="text-[15px]" style={{ color: 'var(--text-soft)' }}>
          המשוב עבור {student?.name} נשלח בתאריך{' '}
          {student?.feedbackSubmittedAt ? new Date(student.feedbackSubmittedAt).toLocaleDateString('he-IL') : ''}.
        </div>
      </div>
    </PageShell>
  );

  if (phase === 'done') return (
    <PageShell>
      <div className="text-center py-16">
        <div className="text-[48px] mb-4">🙏</div>
        <div className="serif text-[32px] mb-3" style={{ color: 'var(--ink)' }}>תודה על המשוב!</div>
        <div className="text-[15px]" style={{ color: 'var(--text-soft)' }}>
          המשוב עבור {student?.name} נשמר בהצלחה ורכזת הפרקטיקום קיבלה עותק.
        </div>
      </div>
    </PageShell>
  );

  if (phase === 'error') return (
    <PageShell>
      <div className="text-center py-16">
        <div className="serif text-[28px] mb-3" style={{ color: 'var(--ink)' }}>שגיאה בשמירת המשוב</div>
        <div className="text-[15px]" style={{ color: 'var(--text-soft)' }}>{errorMsg}</div>
        <button onClick={load} style={{
          display: 'inline-block', marginTop: '24px', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
          background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer',
        }}>נסה שוב</button>
      </div>
    </PageShell>
  );

  return (
    <PageShell>
      {/* noValidate — we validate in handleSubmit and show the reason in Hebrew at
          the field. Matches CvUpdateForm / CloudSignIn / PasswordGate; this form was
          the only public one still letting the browser block it silently. */}
      <form onSubmit={handleSubmit} noValidate className="max-w-[720px] mx-auto">
        {draft.restored && (
          <div data-draft-restored="1" className="rounded-xl px-4 py-3 mb-5 text-[13.5px]"
            style={{ background: 'rgba(21,128,61,0.08)', border: '1px solid rgba(21,128,61,0.35)', color: '#15803d', fontWeight: 600 }}>
            ✓ שוחזרו התשובות שהתחלת למלא במכשיר הזה. אפשר להמשיך מאותה נקודה.
          </div>
        )}

        {/* Header */}
        <header className="border-b pb-5 mb-8" style={{ borderColor: 'var(--divider)' }}>
          <div className="chapter-mark mb-2">Evaluation Form</div>
          <h1 className="serif text-[30px] leading-[1.1] tracking-tight mb-1" style={{ color: 'var(--ink)' }}>
            טופס הערכת סטודנט/ית
          </h1>
          <div className="text-[14px]" style={{ color: 'var(--text-soft)' }}>
            פרקטיקום במשאבי אנוש · אוניברסיטת אריאל
          </div>
          <div className="text-[13px] mt-1" style={{ color: 'var(--text-soft)' }}>
            תאריך מילוי: {new Date().toLocaleDateString('he-IL')}
          </div>
        </header>

        {/* א — פרטי הסטודנט */}
        <FSection letter="א" title="פרטי הסטודנט/ית">
          <ReadRow label="שם מלא" value={student?.name} />
          <ReadRow label="ארגון מאכסן" value={student?.acceptedOrg} />
        </FSection>

        {/* ב — פרטי ההשמה */}
        <FSection letter="ב" title="פרטי ההשמה">
          <InputRow label="שם המנחה בארגון" value={mentor} onChange={setMentor} />
          <InputRow label="תפקיד המנחה" value={mentorRole} onChange={setMentorRole} />
          <InputRow label="תקופת ההתנסות" value={period} onChange={setPeriod} placeholder="מ‑____ עד ____" />
        </FSection>

        {/* ג — הערכת קריטריונים */}
        <FSection letter="ג" title="הערכת תפקוד — דרג כל קריטריון (1 = נמוך מאוד, 5 = מצוין)">
          {CRITERIA_GROUPS.map(group => (
            <div key={group.label} className="mb-6">
              <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold mb-3"
                style={{ color: 'var(--text-soft)' }}>
                {group.label}
              </div>
              {group.items.map(item => (
                <div key={item} className="flex flex-wrap items-center gap-3 py-2.5 border-b"
                  style={{ borderColor: 'rgba(122,30,43,0.08)' }}>
                  <div className="flex-1 text-[14.5px] min-w-[180px]" style={{ color: 'var(--ink)' }}>{item}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {[1, 2, 3, 4, 5].map(n => (
                      <label key={n} className="flex items-center gap-1.5 text-[13px] cursor-pointer"
                        style={{ color: ratings[item] === n ? 'var(--accent)' : 'var(--ink)' }}>
                        <input type="radio" name={item} value={n}
                          checked={ratings[item] === n}
                          onChange={() => setRating(item, n)}
                          style={{ accentColor: 'var(--accent)' }} />
                        <span style={{ fontWeight: ratings[item] === n ? 700 : 400 }}>{n}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-1.5 text-[12px] cursor-pointer mr-1"
                      style={{ color: ratings[item] === 'na' ? 'var(--accent)' : 'var(--text-soft)' }}>
                      <input type="radio" name={item} value="na"
                        checked={ratings[item] === 'na'}
                        onChange={() => setRating(item, 'na')}
                        style={{ accentColor: 'var(--accent)' }} />
                      לא רלוונטי
                    </label>
                  </div>
                </div>
              ))}
              <div className="mt-3">
                <label className="block">
                  <span className="small-caps block mb-1.5 text-[11px]">הסבר / פירוט (אופציונלי)</span>
                  <textarea rows={2} value={groupNotes[group.label] || ''}
                    onChange={e => setGroupNotes(prev => ({ ...prev, [group.label]: e.target.value }))}
                    className="input w-full"
                    style={{ padding: '10px 14px', fontSize: '13.5px', resize: 'vertical' }} />
                </label>
              </div>
            </div>
          ))}
        </FSection>

        {/* ד — שביעות רצון כללית */}
        <FSection letter="ד" title="שביעות רצון כללית מהסטודנט/ית">
          <div className="rounded-lg p-4 mb-5"
            style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--divider)' }}>
            <div className="text-[13px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
              <strong>הערה חשובה:</strong> ציון זה מהווה <strong>50% מהציון הסופי בקורס</strong>,
              בהתאם למרכיבי הסילבוס: נוכחות ומחויבות, תרומה לארגון, יחסי אנוש, עמידה בדרישות.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block">
                <span className="small-caps block mb-2">ציון שביעות רצון כללית (0–100) *</span>
                <input
                  ref={scoreRef}
                  type="number" min={0} max={100}
                  value={overallScore}
                  onChange={e => { setOverallScore(e.target.value); if (missingField === 'score') setMissingField(null); }}
                  placeholder="___"
                  // `required` kept for screen readers; <form noValidate> stops the
                  // browser from blocking submission with an off-screen English tooltip.
                  required
                  aria-invalid={missingField === 'score'}
                  data-missing={missingField === 'score' ? '1' : '0'}
                  className="input w-32 text-center"
                  style={{ padding: '10px 14px', fontSize: '22px', fontWeight: 700,
                    borderColor: missingField === 'score' ? '#b91c1c' : undefined,
                    boxShadow: missingField === 'score' ? '0 0 0 3px rgba(185,28,28,0.15)' : undefined }}
                />
                {missingField === 'score' && (
                  <div className="text-[12.5px] font-semibold mt-1.5" style={{ color: '#b91c1c' }}>
                    יש להזין ציון שביעות רצון כללית (0–100) כדי לשלוח את המשוב.
                  </div>
                )}
              </label>
            </div>
            <div ref={recRef}>
              <div className="small-caps mb-2">המלצה כוללת *</div>
              {missingField === 'recommendation' && (
                <div className="text-[12.5px] font-semibold mb-2" style={{ color: '#b91c1c' }}>
                  יש לבחור המלצה כוללת כדי לשלוח את המשוב.
                </div>
              )}
              <div className="flex flex-col gap-2">
                {['ממליץ/ה בחום', 'ממליץ/ה', 'ממליץ/ה עם הסתייגויות', 'לא ממליץ/ה'].map(opt => (
                  <label key={opt} className="flex items-center gap-2 text-[14px] cursor-pointer"
                    style={{ color: recommendation === opt ? 'var(--accent)' : 'var(--ink)', fontWeight: recommendation === opt ? 600 : 400 }}>
                    <input type="radio" name="recommendation" value={opt}
                      checked={recommendation === opt}
                      onChange={() => { setRecommendation(opt); if (missingField === 'recommendation') setMissingField(null); }}
                      style={{ accentColor: 'var(--accent)' }} />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="small-caps block mb-1.5">חוזקות בולטות</span>
              <textarea rows={3} value={strengths} onChange={e => setStrengths(e.target.value)}
                className="input w-full" style={{ padding: '12px 14px', fontSize: '14px', resize: 'vertical' }} />
            </label>
            <label className="block">
              <span className="small-caps block mb-1.5">תחומים לשיפור / פידבק</span>
              <textarea rows={3} value={improvements} onChange={e => setImprovements(e.target.value)}
                className="input w-full" style={{ padding: '12px 14px', fontSize: '14px', resize: 'vertical' }} />
            </label>
            <label className="block">
              <span className="small-caps block mb-1.5">הערות נוספות</span>
              <textarea rows={3} value={additionalNotes} onChange={e => setAdditionalNotes(e.target.value)}
                className="input w-full" style={{ padding: '12px 14px', fontSize: '14px', resize: 'vertical' }} />
            </label>
          </div>
        </FSection>

        {/* ה — קליטה לעבודה ושליחה */}
        <FSection letter="ה" title="קליטה לעבודה ואישור">
          <label className="inline-flex items-center gap-3 cursor-pointer py-2 mb-6">
            <input type="checkbox" checked={hired} onChange={e => setHired(e.target.checked)}
              className="w-4 h-4" style={{ accentColor: 'var(--accent)' }} />
            <span className="text-[15px]" style={{ color: 'var(--ink)' }}>
              הסטודנט/ית נקלט/ה לעבודה בארגוננו בסיום הפרקטיקום
            </span>
          </label>

          <button type="submit" disabled={phase === 'submitting'} style={{
            display: 'block', width: '100%', padding: '16px', fontSize: '16px', fontWeight: 600,
            background: phase === 'submitting' ? 'var(--divider)' : 'var(--accent)',
            color: 'white', border: 'none', borderRadius: '12px',
            cursor: phase === 'submitting' ? 'not-allowed' : 'pointer',
            opacity: phase === 'submitting' ? 0.6 : 1,
          }}>
            {phase === 'submitting' ? 'שולח...' : 'שלח משוב →'}
          </button>

          {/* Say it out loud, so nobody retypes out of doubt or fears losing work. */}
          <div className="text-[12px] mt-3 text-center" data-draft-indicator={draft.savedAt ? '1' : '0'}
            style={{ color: draft.savedAt ? '#15803d' : 'var(--text-soft)', fontWeight: draft.savedAt ? 600 : 400 }}>
            {draft.savedAt
              ? `✓ ${draftSavedLabel(draft.savedAt)} — אפשר לחזור לקישור הזה ולהמשיך מאותה נקודה`
              : 'מה שתמלא/י נשמר אוטומטית במכשיר הזה — אפשר לחזור לקישור ולהמשיך'}
          </div>

          <div className="text-[12px] mt-3 text-center" style={{ color: 'var(--text-soft)' }}>
            המשוב יועבר ישירות לרכזת הפרקטיקום באוניברסיטת אריאל
          </div>
        </FSection>

      </form>
    </PageShell>
  );
}

function FSection({ letter, title, children }: { letter: string; title: string; children: any }) {
  return (
    <section className="mb-8">
      <h2 className="mono text-[12.5px] uppercase tracking-[0.14em] font-semibold pb-2 mb-4 border-b flex items-center gap-3"
        style={{ color: 'var(--accent)', borderColor: 'var(--divider)' }}>
        <span className="serif text-[16px] font-normal" style={{ color: 'var(--text-soft)' }}>{letter}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ReadRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline gap-4 py-2 border-b" style={{ borderColor: 'rgba(122,30,43,0.1)' }}>
      <div className="small-caps w-40 shrink-0" style={{ letterSpacing: '0.12em', color: 'var(--text-soft)' }}>{label}</div>
      <div className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>{value || '—'}</div>
    </div>
  );
}

function InputRow({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-baseline gap-4 py-2 border-b" style={{ borderColor: 'rgba(122,30,43,0.1)' }}>
      <div className="small-caps w-40 shrink-0" style={{ letterSpacing: '0.12em', color: 'var(--text-soft)' }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="flex-1 bg-transparent border-b outline-none text-[15px] py-1"
        style={{ color: 'var(--ink)', borderColor: 'var(--divider)' }} />
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-[800px] mx-auto px-6 pt-14 pb-28 min-h-screen">
      {children}
    </main>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-24 gap-3">
      <span style={{ fontSize: '22px', animation: 'practicum-spin 0.7s linear infinite', display: 'inline-block' }}>↻</span>
      <span className="mono text-[12px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>טוען...</span>
    </div>
  );
}
