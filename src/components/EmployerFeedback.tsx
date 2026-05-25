/**
 * Public employer feedback form — /feedback?token=<feedbackToken>
 *
 * Uses the same evaluation structure as EvaluationForm (10 criteria, overall
 * score, recommendation, free-text fields). On submit, saves structured text
 * to student.feedbackText + feedbackSubmittedAt + hired.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { saveSnapshot } from '../lib/dataApi';
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

  const token = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token') || ''
    : '';

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
    if (!overallScore) { alert('אנא הזן ציון שביעות רצון כללית (0–100)'); return; }
    if (!recommendation) { alert('אנא בחר המלצה כוללת'); return; }
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
      setErrorMsg(res.error || 'שגיאה בשמירה');
      setPhase('error');
      return;
    }
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
      <form onSubmit={handleSubmit} className="max-w-[720px] mx-auto">

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
                  type="number" min={0} max={100}
                  value={overallScore}
                  onChange={e => setOverallScore(e.target.value)}
                  placeholder="___"
                  required
                  className="input w-32 text-center"
                  style={{ padding: '10px 14px', fontSize: '22px', fontWeight: 700 }}
                />
              </label>
            </div>
            <div>
              <div className="small-caps mb-2">המלצה כוללת *</div>
              <div className="flex flex-col gap-2">
                {['ממליץ/ה בחום', 'ממליץ/ה', 'ממליץ/ה עם הסתייגויות', 'לא ממליץ/ה'].map(opt => (
                  <label key={opt} className="flex items-center gap-2 text-[14px] cursor-pointer"
                    style={{ color: recommendation === opt ? 'var(--accent)' : 'var(--ink)', fontWeight: recommendation === opt ? 600 : 400 }}>
                    <input type="radio" name="recommendation" value={opt}
                      checked={recommendation === opt}
                      onChange={() => setRecommendation(opt)}
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

          <div className="text-[12px] mt-4 text-center" style={{ color: 'var(--text-soft)' }}>
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
