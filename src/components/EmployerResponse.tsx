/**
 * The employer's answer page — /r?t=<dispatchId>
 *
 * Yariv chose routes א + ג (2026-08-10): the employer answers through a link, and we
 * chase underneath. The fact that shapes it is his — "הוא מזמין לראיון ואחרי ראיון הוא
 * לוחץ על הקישור … לפעמים חודש וחצי" — so the answer is NOT one step. This page asks
 * only the question that fits where the process has actually reached, and never asks
 * whether a student was accepted before an interview has happened.
 *
 * The token is the dispatch id: it identifies one send to one employer for one student,
 * so a link can never answer for somebody else. Same public, no-login shape as the
 * employer feedback form at /f.
 */

import { useEffect, useState } from 'react';
import { publicSupabase as supabase } from '../lib/supabase';
import { saveSnapshot } from '../lib/dataApi';
import { responseStageOf, applyEmployerAnswer, type EmployerAnswer, type ResponseStage } from '../lib/dispatch';
import type { PracticumData } from '../lib/supabase';

type Phase = 'loading' | 'ready' | 'saving' | 'done' | 'error';

export default function EmployerResponse() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [err, setErr] = useState('');
  const [data, setData] = useState<PracticumData | null>(null);
  const [ctx, setCtx] = useState<{ student: any; orgName: string; empName: string; contact: string; stage: ResponseStage } | null>(null);
  const [date, setDate] = useState('');
  const [outcome, setOutcome] = useState('');

  const token = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('t') || new URLSearchParams(window.location.search).get('token') || '')
    : '';

  useEffect(() => {
    (async () => {
      if (!token) { setErr('הקישור חסר מזהה. אנא השתמשו בקישור מהמייל.'); setPhase('error'); return; }
      const { data: rows, error } = await supabase
        .from('practicum_data').select('data').eq('org_id', 'default').limit(1);
      if (error || !rows?.length) { setErr('לא הצלחנו לטעון את הפרטים. נסו שוב מאוחר יותר.'); setPhase('error'); return; }
      const d = rows[0].data as PracticumData;
      const disp = (d.dispatches || []).find((x: any) => x.id === token);
      if (!disp) { setErr('הקישור אינו תקף או שפג תוקפו.'); setPhase('error'); return; }
      const student = (d.students || []).find((s: any) => s.id === disp.studentId);
      const emp = (d.employers || []).find((e: any) => e.id === disp.employerId);
      if (!student || !emp) { setErr('הפנייה כבר אינה במערכת.'); setPhase('error'); return; }
      const stage = responseStageOf({ student, orgName: emp.name });
      setData(d);
      setCtx({ student, orgName: emp.name, empName: emp.name, contact: emp.contactPerson || '', stage });
      setPhase(stage === 'answered' ? 'done' : 'ready');
    })();
  }, [token]);

  async function answer(a: EmployerAnswer) {
    if (!data || !ctx) return;
    setPhase('saving');
    const res = applyEmployerAnswer({
      student: ctx.student, employers: (data.employers || []) as any,
      dispatches: (data.dispatches || []) as any, orgName: ctx.orgName, answer: a,
    });
    const next = {
      ...data,
      students: (data.students || []).map((s: any) => s.id === ctx.student.id ? res.student : s),
      employers: res.employers, dispatches: res.dispatches,
    };
    const saved = await saveSnapshot(next as any, { name: `מעסיק — ${ctx.empName}` },
      { action: 'תשובת מעסיק', entity: 'ארגון', target: `${ctx.empName} · ${ctx.student.name}` });
    if (!saved.ok) { setErr('השמירה נכשלה. נסו שוב, או השיבו במייל.'); setPhase('error'); return; }
    setOutcome(
      a.kind === 'invite' ? 'תודה — נעדכן את הסטודנט/ית שתוזמנו לראיון.'
      : a.kind === 'accepted' ? 'תודה רבה! נעדכן את הסטודנט/ית שהתקבל/ה.'
      : a.kind === 'still_reviewing' ? 'תודה — נחזור אליכם בהמשך.'
      : 'תודה על העדכון. נמשיך עם הסטודנט/ית לארגון אחר.');
    setPhase('done');
  }

  const card: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--divider)', borderRadius: 16,
    padding: '26px 24px', maxWidth: 460, margin: '40px auto', direction: 'rtl', textAlign: 'right',
    boxShadow: '0 16px 48px rgba(61,15,20,0.10)',
  };
  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({
    display: 'block', width: '100%', padding: '13px 16px', borderRadius: 10, marginTop: 9,
    fontSize: 15, fontWeight: 700, cursor: 'pointer', border: '1px solid transparent',
    background: bg, color: fg, fontFamily: 'inherit',
  });
  const ghost: React.CSSProperties = { ...btn('transparent', 'var(--text-soft)'), border: '1px solid var(--divider-strong)' };

  if (phase === 'loading') return <div style={card}>טוען…</div>;
  if (phase === 'error') return <div style={card}><div className="serif" style={{ fontSize: 21, marginBottom: 8 }}>לא ניתן להציג</div><p style={{ color: 'var(--text-soft)', fontSize: 14 }}>{err}</p></div>;
  if (phase === 'done') return (
    <div style={card} data-response-done>
      <div className="serif" style={{ fontSize: 23, marginBottom: 8 }}>✓ נרשם</div>
      <p style={{ color: 'var(--text-soft)', fontSize: 14.5, lineHeight: 1.7 }}>
        {outcome || 'התשובה כבר נרשמה. תודה!'}
      </p>
    </div>
  );

  const s = ctx!;
  return (
    <div style={card} data-response-stage={s.stage}>
      <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>
        פרקטיקום · אוניברסיטת אריאל
      </div>
      <div className="serif" style={{ fontSize: 24, margin: '8px 0 4px', lineHeight: 1.2 }}>
        {s.contact ? `שלום ${s.contact},` : 'שלום,'}
      </div>

      {s.stage === 'awaiting_reply' && (
        <>
          <p style={{ fontSize: 14.5, lineHeight: 1.75, color: 'var(--ink)' }}>
            שלחנו אליכם את קורות החיים של <b>{s.student.name}</b>.
            נשמח לדעת איך להתקדם — גם תשובה שלילית עוזרת לנו.
          </p>
          <button type="button" data-answer="invite" style={btn('#15803d')}
            onClick={() => answer({ kind: 'invite', interviewDate: date })}>
            📅 אשמח לזמן לראיון
          </button>
          <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-soft)', marginTop: 7 }}>
            תאריך הראיון (לא חובה — אפשר לתאם גם ישירות)
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '9px 11px',
                borderRadius: 9, border: '1px solid var(--divider)', fontFamily: 'inherit', fontSize: 14 }} />
          </label>
          <button type="button" data-answer="still_reviewing" style={ghost}
            onClick={() => answer({ kind: 'still_reviewing' })}>⏳ עדיין בבדיקה — חזרו אליי</button>
          <button type="button" data-answer="not_suitable" style={{ ...ghost, color: '#b91c1c', borderColor: '#b91c1c' }}
            onClick={() => answer({ kind: 'not_suitable' })}>✕ לא מתאים לנו</button>
        </>
      )}

      {s.stage === 'interview_booked' && (
        <>
          <p style={{ fontSize: 14.5, lineHeight: 1.75, color: 'var(--ink)' }}>
            הראיון עם <b>{s.student.name}</b> קבוע ל‑{new Date(s.student.placementInterviewDate).toLocaleDateString('he-IL')}.
            אם משהו השתנה — עדכנו אותנו כאן.
          </p>
          <button type="button" data-answer="still_reviewing" style={ghost}
            onClick={() => answer({ kind: 'still_reviewing' })}>הראיון עדיין קבוע</button>
          <button type="button" data-answer="not_suitable" style={{ ...ghost, color: '#b91c1c', borderColor: '#b91c1c' }}
            onClick={() => answer({ kind: 'not_suitable' })}>✕ בטלנו — לא מתאים</button>
        </>
      )}

      {s.stage === 'awaiting_decision' && (
        <>
          <p style={{ fontSize: 14.5, lineHeight: 1.75, color: 'var(--ink)' }}>
            הראיון עם <b>{s.student.name}</b> כבר התקיים. <b>מה הוחלט?</b>
          </p>
          <button type="button" data-answer="accepted" style={btn('#15803d')}
            onClick={() => answer({ kind: 'accepted' })}>✓ מתקבל/ת אלינו</button>
          <button type="button" data-answer="not_accepted" style={{ ...ghost, color: '#b91c1c', borderColor: '#b91c1c' }}
            onClick={() => answer({ kind: 'not_accepted' })}>✕ לא מתקבל/ת</button>
          <button type="button" data-answer="still_reviewing" style={ghost}
            onClick={() => answer({ kind: 'still_reviewing' })}>⏳ טרם הוחלט</button>
        </>
      )}

      <p style={{ fontSize: 11.5, color: 'var(--text-soft)', marginTop: 16, lineHeight: 1.6 }}>
        לכל שאלה אפשר להשיב למייל שממנו הגיע הקישור.
      </p>
    </div>
  );
}
