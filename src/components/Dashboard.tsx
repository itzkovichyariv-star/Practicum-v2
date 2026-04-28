import { useMemo } from 'react';
import type { Lecture } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear } from './pageShared';
import { RefreshButton } from './StudentsPage';

function hebDate(d: Date) {
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  return days[d.getDay()];
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / (86400 * 1000));
}

function timeAgo(ts: string): string {
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return `לפני ${m} ד׳`;
  const h = Math.round(m / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  const days = Math.round(h / 24);
  if (days < 7) return `לפני ${days} ימים`;
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

export default function Dashboard({
  data, context, onContext, userName, lastUpdated, lastEditor, onRefresh, onNavigate,
}: PageProps) {
  const students = data.students || [];
  const employers = data.employers || [];
  const candidates = data.candidates || [];
  const lectures = data.lectures || [];

  // Scoped data
  const scopedStudents = students.filter(s => sameContext(s, context));
  const scopedEmployers = employers.filter(e => sameContext(e, context));
  const scopedCandidates = candidates.filter(c => sameContext(c, context));
  const scopedLectures = lectures.filter(l => sameContext(l, context));

  // Stats
  const completedCount = scopedStudents.filter(s => s.practicumCompleted).length;
  const hiredCount     = scopedStudents.filter(s => s.hired).length;
  const activeCount    = scopedStudents.filter(s => s.acceptedOrg && !s.practicumCompleted).length;
  const placementRate  = scopedStudents.length
    ? Math.round((hiredCount / scopedStudents.length) * 100)
    : 0;
  const totalPositions = scopedEmployers.reduce((sum, e) => sum + (Number(e.positions) || 0), 0);
  const filledPositions = scopedEmployers.reduce((sum, e) => sum + (Number(e.filledPositions) || 0), 0);
  const openPositions = Math.max(0, totalPositions - filledPositions);

  // Upcoming lectures (next 14 days, scoped, sorted)
  const now = new Date();
  const upcoming = scopedLectures
    .filter(l => l.date && l.status !== 'בוטל')
    .map(l => ({ lec: l, date: new Date(l.date!) }))
    .filter(x => !isNaN(x.date.getTime()) && x.date >= new Date(now.toDateString()))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 5);

  const weekLectures = scopedLectures
    .filter(l => l.date && l.status !== 'בוטל')
    .map(l => ({ lec: l, date: new Date(l.date!) }))
    .filter(x => !isNaN(x.date.getTime())
      && x.date >= new Date(now.toDateString())
      && daysBetween(now, x.date) <= 7)
    .length;

  // Action items / alerts
  type Alert = { key: string; title: string; desc: string; action?: { label: string; onClick: () => void } };
  const alerts: Alert[] = [];

  // Prep alerts (lectures 7-14 days away) — with "send prep email" action
  const prepWindow = scopedLectures
    .filter(l => l.date)
    .map(l => ({ l, d: new Date(l.date!) }))
    .filter(x => !isNaN(x.d.getTime()))
    .filter(x => {
      const days = daysBetween(now, x.d);
      return days >= 3 && days <= 14;  // widened to 3-14 days
    });
  if (prepWindow.length) {
    alerts.push({
      key: 'prep',
      title: `${prepWindow.length === 1 ? 'הרצאה קרובה — הכנה נדרשת' : `${prepWindow.length} הרצאות קרובות — הכנה נדרשת`}`,
      desc: prepWindow.slice(0, 3).map(x =>
        `${x.l.topic || x.l.courseName || 'הרצאה'} · בעוד ${daysBetween(now, x.d)} ימים`
      ).join(' · '),
      action: {
        label: 'שלח תזכורת הכנה למרצה',
        onClick: () => {
          const lec = prepWindow[0].l;
          if (!lec.lecturerEmail) {
            alert(`למרצה "${lec.lecturer || ''}" אין מייל במערכת. פתח את ההרצאה כדי להוסיף.`);
            return;
          }
          const days = daysBetween(now, new Date(lec.date!));
          const subject = encodeURIComponent(`תזכורת הכנה — ${lec.topic || lec.courseName || 'הרצאה'} (בעוד ${days} ימים)`);
          const body = encodeURIComponent(
`שלום ${lec.lecturer || ''},

מזכיר/ה לקראת ההרצאה בעוד ${days} ימים:

נושא: ${lec.topic || ''}
קורס: ${lec.courseName || ''}
תאריך: ${lec.date}
שעה: ${lec.startTime || ''}${lec.endTime ? '–' + lec.endTime : ''}
מיקום: ${lec.location || lec.link || ''}

אנא אשר קבלת המייל ותן לי לדעת אם יש שינויים או צרכים לוגיסטיים.

תודה,
ד"ר יריב איצקוביץ
`);
          window.location.href = `mailto:${encodeURIComponent(lec.lecturerEmail)}?subject=${subject}&body=${body}`;
        },
      },
    });
  }

  // Students who passed prep but haven't submitted anywhere
  const readyNotSubmitted = scopedStudents.filter(s =>
    s.preparation?.passed && !s.acceptedOrg && !s.hired
  ).length;
  if (readyNotSubmitted > 0) {
    alerts.push({
      key: 'ready',
      title: `${readyNotSubmitted} סטודנטים עברו הכנה וטרם שובצו`,
      desc: 'דורש מעקב או תזכורת להגשת מועמדות',
    });
  }

  // Candidates waiting (no interview date)
  const candsWaiting = scopedCandidates.filter(c =>
    !c.interviewDate && c.interviewResult !== 'failed'
  ).length;
  if (candsWaiting > 0) {
    alerts.push({
      key: 'cands',
      title: `${candsWaiting} מועמדים ממתינים לראיון`,
      desc: 'לא נקבע מועד ראיון',
    });
  }

  // Hired but missing feedback
  const missingFeedback = scopedStudents.filter(s =>
    (s.acceptedOrg || s.hired) && !s.feedbackText && (s.hoursReported || 0) > 0
  ).length;
  if (missingFeedback > 0) {
    alerts.push({
      key: 'fb',
      title: `${missingFeedback} סטודנטים ללא חוו״ד מהארגון`,
      desc: 'צברו שעות — מוכנים לבקשת חוות דעת',
    });
  }

  // Context label
  const courses = data.courses || [];
  const contextLabel = useMemo(() => {
    const cLabel = context.courseId === '__all__' ? 'כל הקורסים' : (courses.find(c => c.id === context.courseId)?.name || context.courseId);
    const yLabel = context.year === '__all__' ? 'כל השנים' : context.year;
    return { course: cLabel, year: yLabel, isAll: context.courseId === '__all__' };
  }, [context, courses]);

  // Per-course breakdown (only when viewing all courses)
  const courseBreakdown = useMemo(() => {
    if (context.courseId !== '__all__') return [];
    const courseMap = new Map(courses.map(c => [c.id, c]));
    const map = new Map<string, { key: string; courseName: string; year: string; total: number; active: number; completed: number; hired: number }>();
    for (const s of students) {
      if (context.year !== '__all__' && normalizeYear(s.year) !== normalizeYear(context.year)) continue;
      const key = `${s.courseId}||${normalizeYear(s.year)}`;
      if (!map.has(key)) {
        map.set(key, {
          key, year: normalizeYear(s.year) || '—',
          courseName: courseMap.get(s.courseId)?.name || s.courseId || '—',
          total: 0, active: 0, completed: 0, hired: 0,
        });
      }
      const row = map.get(key)!;
      row.total++;
      if (s.acceptedOrg && !s.practicumCompleted) row.active++;
      if (s.practicumCompleted) row.completed++;
      if (s.hired) row.hired++;
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year.localeCompare(a.year, 'he');
      return a.courseName.localeCompare(b.courseName, 'he');
    });
  }, [students, courses, context]);

  const today = new Date();
  const engMonths = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const engDays = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const todayLine = `${today.getDate()} ${engMonths[today.getMonth()]} ${today.getFullYear()} · ${engDays[today.getDay()]}`;

  return (
    <main className="max-w-[1200px] mx-auto px-10 pt-6 pb-28">

        {/* Hero */}
        <section className="flex flex-col md:grid md:grid-cols-[1fr_auto] gap-6 md:gap-10 items-start md:items-end pt-4 pb-8 border-b mb-8" style={{ borderColor: 'var(--divider)' }}>
          <div>
            <div className="chapter-mark with-sigil mb-2">I · דשבורד</div>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="mono text-[11px] uppercase tracking-[0.14em] px-2.5 py-1 rounded-full"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--divider)' }}>
                {contextLabel.course}
              </span>
              <span className="mono text-[11px]" style={{ color: 'var(--text-soft)' }}>·</span>
              <span className="mono text-[11px] uppercase tracking-[0.14em] px-2.5 py-1 rounded-full"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--divider)' }}>
                {contextLabel.year}
              </span>
            </div>
            <h1 className="serif text-[40px] leading-[1.12] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
              שלום, <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{userName}</em>.
            </h1>
            <p className="text-[18px] max-w-[620px] leading-[1.55]" style={{ color: 'var(--ink)', opacity: 0.78 }}>
              {buildHeroBlurb(upcoming.length, readyNotSubmitted, placementRate)}
            </p>
          </div>
          <div className="text-left">
            <div className="small-caps mb-2">Today</div>
            <div className="serif text-[32px] leading-[1.05] tracking-tight" style={{ color: 'var(--ink)' }}>
              {hebDate(today)}
            </div>
            <div className="mono text-[11.5px] tracking-[0.18em] mt-2 uppercase" style={{ color: 'var(--text-soft)' }}>
              {todayLine}
            </div>
          </div>
        </section>

        {/* Status strip — compact, right below hero */}
        <div className="mono text-[12px] uppercase tracking-[0.16em] flex items-center gap-3 flex-wrap mb-8" style={{ color: 'var(--text-soft)' }}>
          <RefreshButton onRefresh={onRefresh} />
          {lastUpdated && (
            <span className="opacity-75">
              · עודכן {new Date(lastUpdated).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}
              {lastEditor ? ` ע״י ${lastEditor}` : ''}
            </span>
          )}
        </div>

        {/* Stats — no header, tight to hero */}
        <section className="mb-10">
          <div className="grid grid-cols-2 md:grid-cols-4 stats-grid">
            <Stat label="סטודנטים" num={String(scopedStudents.length)} delta={`${activeCount} בהתנסות · ${hiredCount} נקלטו`} primary />
            <Stat label="סיימו פרקטיקום" num={String(completedCount)}
              delta={scopedStudents.length ? `${Math.round((completedCount/scopedStudents.length)*100)}% מהסטודנטים` : '—'}
              color="#b45309" />
            <Stat label="מעסיקים" num={String(scopedEmployers.length)} delta={`${totalPositions > 0 ? totalPositions + ' מקומות פרקטיקום' : '—'}`} />
            <Stat label="מועמדים" num={String(scopedCandidates.length)} delta={candsWaiting ? `${candsWaiting} ממתינים` : '—'} />
          </div>
        </section>

        {/* Per-course breakdown — shown only when viewing all courses */}
        {contextLabel.isAll && courseBreakdown.length > 0 && (
          <section className="mb-10">
            <SectionHead title="סיכום לפי קורסים" />
            {/* Column headers */}
            <div className="mono text-[10px] uppercase tracking-[0.16em] pb-2 mb-1 grid gap-4"
              style={{ gridTemplateColumns: '1fr repeat(4, 80px)', borderBottom: '1px solid var(--divider)', color: 'var(--text-soft)' }}>
              <span>קורס · שנה</span>
              <span className="text-center">סטודנטים</span>
              <span className="text-center" style={{ color: '#c0506a' }}>בהתנסות</span>
              <span className="text-center" style={{ color: '#b45309' }}>סיימו</span>
              <span className="text-center" style={{ color: 'var(--accent)' }}>נקלטו</span>
            </div>
            {courseBreakdown.map(row => (
              <div key={row.key}
                role="button" tabIndex={0}
                onClick={() => onContext?.({ courseId: row.courseId, year: row.year })}
                onKeyDown={e => e.key === 'Enter' && onContext?.({ courseId: row.courseId, year: row.year })}
                className="py-4 grid gap-4 items-center border-b cursor-pointer transition-colors"
                style={{ gridTemplateColumns: '1fr repeat(4, 80px)', borderColor: 'var(--divider)', background: 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(122,30,43,0.035)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                {/* Name + year */}
                <div className="flex items-center gap-2 group">
                  <div>
                    <div className="serif text-[17px] leading-[1.2]" style={{ color: 'var(--ink)' }}>{row.courseName}</div>
                    <div className="mono text-[10.5px] uppercase tracking-[0.12em] mt-0.5" style={{ color: 'var(--text-soft)' }}>{row.year}</div>
                  </div>
                  <span className="serif text-[16px] opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--accent)' }}>←</span>
                </div>
                {/* סטודנטים */}
                <div className="text-center">
                  <span className="serif text-[26px] leading-none" style={{ color: 'var(--ink)' }}>{row.total}</span>
                </div>
                {/* בהתנסות */}
                <div className="text-center">
                  <span className="serif text-[22px] leading-none font-normal" style={{ color: '#c0506a' }}>{row.active}</span>
                  <div className="mono text-[10px]" style={{ color: 'var(--text-soft)' }}>מתוך {row.total}</div>
                </div>
                {/* סיימו */}
                <div className="text-center">
                  <span className="serif text-[22px] leading-none font-normal" style={{ color: '#b45309' }}>{row.completed}</span>
                  <div className="mono text-[10px]" style={{ color: 'var(--text-soft)' }}>מתוך {row.total}</div>
                </div>
                {/* נקלטו */}
                <div className="text-center">
                  <span className="serif text-[22px] leading-none font-normal" style={{ color: 'var(--accent)' }}>{row.hired}</span>
                  <div className="mono text-[10px]" style={{ color: 'var(--text-soft)' }}>מתוך {row.total}</div>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Progress rings — placement overview */}
        {(scopedStudents.length > 0 || scopedCandidates.length > 0) && (
          <section className="mb-14">
            <div className="flex flex-wrap items-center gap-8 md:gap-14 pt-6 pb-8 border-t border-b" style={{ borderColor: 'var(--divider)' }}>
              {scopedStudents.length > 0 && (
                <div className="flex items-center gap-5">
                  <ProgressRing value={activeCount} max={scopedStudents.length} label="בהתנסות" color="#c0506a" />
                  <div>
                    <div className="mono text-[10.5px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--text-soft)' }}>בהתנסות</div>
                    <div className="text-[13.5px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
                      <span style={{ color: '#c0506a', fontWeight: 600 }}>{activeCount}</span> מתוך {scopedStudents.length}
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
                      {scopedStudents.filter(s => s.preparation?.passed && !s.acceptedOrg && !s.practicumCompleted).length} מוכנים · ממתינים לשיבוץ
                    </div>
                  </div>
                </div>
              )}
              {scopedStudents.length > 0 && (
                <div className="flex items-center gap-5">
                  <ProgressRing value={completedCount} max={scopedStudents.length} label="סיימו" color="#b45309" />
                  <div>
                    <div className="mono text-[10.5px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--text-soft)' }}>סיום פרקטיקום</div>
                    <div className="text-[13.5px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
                      <span style={{ color: '#b45309', fontWeight: 600 }}>{completedCount}</span> מתוך {scopedStudents.length}
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--text-soft)' }}>מילאו חובות שעות</div>
                  </div>
                </div>
              )}
              {scopedStudents.length > 0 && (
                <div className="flex items-center gap-5">
                  <ProgressRing value={hiredCount} max={scopedStudents.length} label="נקלטו" color="var(--accent)" />
                  <div>
                    <div className="mono text-[10.5px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--text-soft)' }}>נקלטו לעבודה</div>
                    <div className="text-[13.5px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{hiredCount}</span> מתוך {scopedStudents.length}
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--text-soft)' }}>לאחר סיום הפרקטיקום</div>
                  </div>
                </div>
              )}
              {scopedCandidates.length > 0 && (
                <div className="flex items-center gap-5">
                  <ProgressRing value={scopedCandidates.filter(c => c.interviewResult === 'passed').length} max={scopedCandidates.length} label="עברו ראיון" color="var(--accent)" />
                  <div>
                    <div className="mono text-[10.5px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--text-soft)' }}>מועמדים</div>
                    <PipelineMini candidates={scopedCandidates} />
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Upcoming lectures */}
        <section className="mb-12">
          <SectionHead
            title="הרצאות קרובות"
            onRightClick={() => onNavigate('lectures')}
            rightLabel="כל ההרצאות →"
          />
          {upcoming.length === 0 ? (
            <EmptyLine text="אין הרצאות מתוכננות בהקשר זה" />
          ) : (
            <div>
              {upcoming.map(({ lec, date }) => (
                <LectureRow key={lec.id} lec={lec} date={date} now={now} />
              ))}
            </div>
          )}
        </section>

        {/* Alerts */}
        <section className="mb-12">
          <SectionHead title="דורש תשומת לב" />
          {alerts.length === 0 ? (
            <EmptyLine text="אין סימונים פתוחים" />
          ) : (
            <ul>
              {alerts.map(a => (
                <li key={a.key} className="py-5 border-b flex gap-5 items-baseline" style={{ borderColor: 'var(--divider)' }}>
                  <span className="mono text-[12px] uppercase tracking-[0.18em] font-semibold pt-1 w-6 shrink-0" style={{ color: 'var(--accent)' }}>
                    {String(alerts.findIndex(x => x.key === a.key) + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1">
                    <div className="serif text-[22px] leading-[1.3]" style={{ color: 'var(--ink)' }}>{a.title}</div>
                    <div className="text-[14.5px] mt-1.5 leading-[1.5]" style={{ color: 'var(--text-soft)' }}>{a.desc}</div>
                  </div>
                  {a.action && (
                    <button
                      onClick={a.action.onClick}
                      className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-3.5 py-1.5 rounded-full whitespace-nowrap"
                      style={{ background: 'var(--accent)', color: 'var(--bg)' }}
                    >
                      📧 {a.action.label} <span className="serif">→</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent activity */}
        {(data as any).history && (data as any).history.length > 0 && (
          <section className="mb-12">
            <SectionHead title="פעילות אחרונה" rightLabel={`${(data as any).history.length} פעולות`} />
            <ul>
              {((data as any).history || []).slice(0, 8).map((h: any, i: number) => (
                <li key={i} className="py-3 border-b flex items-baseline gap-5 text-[14px]" style={{ borderColor: 'var(--divider)' }}>
                  <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold w-20 shrink-0" style={{ color: 'var(--accent)' }}>
                    {timeAgo(h.ts)}
                  </span>
                  <span className="mono text-[11px] uppercase tracking-[0.14em] w-16 shrink-0" style={{ color: 'var(--text-soft)' }}>
                    {h.who}
                  </span>
                  <span style={{ color: 'var(--ink)' }} className="flex-1">
                    {h.action} <strong>{h.entity}</strong> — {h.target}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

    </main>
  );
}

/* ====== Subcomponents ====== */

function SectionHead({
  title, rightLabel, onRightClick,
}: { title: string; rightLabel?: string; onRightClick?: () => void }) {
  return (
    <div className="section-head flex items-baseline justify-between gap-4 md:gap-10 mb-6 pb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
      <h2 className="section-head-title serif text-[28px] md:text-[38px] tracking-tight leading-[1.15]" style={{ color: 'var(--ink)' }}>{title}</h2>
      {rightLabel && (
        onRightClick ? (
          <button
            onClick={onRightClick}
            className="mono text-[12px] uppercase tracking-[0.18em] font-semibold hover:opacity-60 whitespace-nowrap"
            style={{ color: 'var(--accent)' }}
          >
            {rightLabel}
          </button>
        ) : (
          <span className="mono text-[12px] uppercase tracking-[0.18em] whitespace-nowrap" style={{ color: 'var(--text-soft)' }}>{rightLabel}</span>
        )
      )}
    </div>
  );
}

/* Stat card.
   Hierarchy redesign: the *label* now anchors the card with real weight
   (17px Instrument Sans semibold, ink color). The number is still the star
   but no longer swamps the label. Delta is demoted to muted unless primary.
   Only the primary stat gets the accent delta — reduces color noise across 4 cards. */
function Stat({
  label, num, delta, primary, color,
}: { label: string; num: string; delta: string; primary?: boolean; color?: string }) {
  return (
    <div
      className="px-4 md:px-7 py-4 md:py-0 border-b md:border-b-0 border-l first:border-l-0 first:pr-0 last:pl-0"
      style={{ borderColor: 'var(--divider)' }}
    >
      <div className="stat-label mb-2 md:mb-3">{label}</div>
      <div className="stat-num serif text-[52px] md:text-[68px] font-normal leading-[0.9] tracking-tight"
        style={{ color: color || 'var(--ink)' }}>
        {num}
      </div>
      <div
        className="mt-4 text-[13.5px] leading-[1.5]"
        style={{ color: primary ? 'var(--accent)' : color ? color : 'var(--text-soft)', opacity: color ? 0.8 : 1 }}
      >
        {delta}
      </div>
    </div>
  );
}

function LectureRow({ lec, date, now }: { lec: Lecture; date: Date; now: Date }) {
  const daysFrom = daysBetween(now, date);
  const m = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'][date.getMonth()];
  const isUrgent = daysFrom <= 3;
  return (
    <div
      className="py-5 border-b last:border-b-0"
      style={{ borderColor: 'var(--divider)' }}
    >
      {/* Mobile: flex row; Desktop: grid */}
      <div className="flex gap-5 md:grid md:grid-cols-[88px_1fr_auto] md:gap-7 items-start md:items-baseline">
        <div className="shrink-0 text-center md:text-right w-12 md:w-auto">
          <div className="mono text-[10px] md:text-[11.5px] uppercase tracking-[0.2em] font-semibold" style={{ color: 'var(--text-soft)' }}>{m}</div>
          <div className="lecture-date-num serif text-[34px] md:text-[46px] leading-none tracking-tight mt-1"
            style={{ color: isUrgent ? 'var(--accent)' : 'var(--ink)' }}>
            {String(date.getDate()).padStart(2, '0')}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="serif text-[18px] md:text-[24px] leading-[1.3] tracking-tight mb-1" style={{ color: 'var(--ink)' }}>
            {lec.topic || lec.courseName || 'הרצאה'}
            {isUrgent && (
              <span className="mr-2 align-middle mono text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
                בעוד {daysFrom} י׳
              </span>
            )}
          </div>
          <div className="text-[13px] md:text-[14.5px] leading-[1.5]" style={{ color: 'var(--text-soft)' }}>
            {[lec.courseName, lec.lecturer, lec.startTime, lec.location || lec.institution]
              .filter(Boolean).join(' · ')}
          </div>
          {/* Status shown inline on mobile */}
          <span className="inline-block md:hidden mono text-[10px] uppercase tracking-[0.16em] font-semibold mt-1.5"
            style={{ color: 'var(--text-soft)' }}>{lec.status || '—'}</span>
        </div>
        {/* Status on desktop only */}
        <span className="hidden md:inline mono text-[11.5px] uppercase tracking-[0.2em] font-semibold whitespace-nowrap" style={{ color: 'var(--text-soft)' }}>
          {lec.status || '—'}
        </span>
      </div>
    </div>
  );
}

/* ModuleCard → flat list row. No border box, no backdrop-blur,
   no rounded-xl. Just a link row with label, count and an arrow.
   Affordance from the hover color shift + arrow, not a framed card. */
function ModuleCard({
  label, count, onClick, status,
}: { label: string; count: number | null; onClick: () => void; status: 'v1' | 'v2' }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-baseline justify-between py-5 border-b transition-colors w-full text-right"
      style={{ borderColor: 'var(--divider)' }}
    >
      <div className="flex items-baseline gap-3">
        <span className="serif text-[26px] tracking-tight transition-colors group-hover:[color:var(--accent)]" style={{ color: 'var(--ink)' }}>{label}</span>
        <span className="mono text-[10.5px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-soft)' }}>
          {status}
        </span>
      </div>
      <div className="flex items-baseline gap-5">
        <span className="mono text-[12px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-soft)' }}>
          {count !== null ? `${count} רשומות` : 'פתח'}
        </span>
        <span className="serif text-[22px] transition-transform group-hover:-translate-x-1" style={{ color: 'var(--accent)' }}>→</span>
      </div>
    </button>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="py-6 text-[15px] leading-[1.5]" style={{ color: 'var(--text-soft)' }}>
      {text}
    </div>
  );
}

/* ── Progress ring ─────────────────────────────────────────────────────── */
function ProgressRing({
  value, max, label, color = 'var(--accent)', size = 88,
}: { value: number; max: number; label: string; color?: string; size?: number }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const sw = 7;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--divider)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          className="ring-fill" />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 1, textAlign: 'center',
      }}>
        <span className="serif" style={{ fontSize: size * 0.24, lineHeight: 1, color: 'var(--ink)' }}>
          {Math.round(pct * 100)}%
        </span>
        <span className="mono" style={{
          fontSize: 8, letterSpacing: '0.09em', textTransform: 'uppercase',
          color: 'var(--text-soft)', maxWidth: size - 14, lineHeight: 1.2,
        }}>
          {label}
        </span>
      </div>
    </div>
  );
}

/* ── Pipeline mini — horizontal bar showing candidate breakdown ─────────── */
function PipelineMini({ candidates }: { candidates: any[] }) {
  const total = candidates.length;
  if (total === 0) return null;
  const waiting = candidates.filter(c => !c.interviewDate && c.interviewResult !== 'failed').length;
  const interview = candidates.filter(c => c.interviewDate && (!c.interviewResult || c.interviewResult === 'pending')).length;
  const passed = candidates.filter(c => c.interviewResult === 'passed').length;
  const failed = candidates.filter(c => c.interviewResult === 'failed').length;
  const segments: { n: number; color: string; label: string }[] = [
    { n: waiting,   color: 'var(--tl-gray)',  label: 'ממתינים' },
    { n: interview, color: 'var(--tl-amber)', label: 'ראיון' },
    { n: passed,    color: 'var(--tl-green)', label: 'עברו' },
    { n: failed,    color: 'var(--tl-red)',   label: 'לא עברו' },
  ].filter(s => s.n > 0);
  return (
    <div style={{ minWidth: 140 }}>
      {/* Bar */}
      <div className="flex rounded-full overflow-hidden h-2 mb-2" style={{ gap: 1.5, background: 'var(--divider)' }}>
        {segments.map(s => (
          <div key={s.label} style={{ flex: s.n, background: s.color, minWidth: 4, borderRadius: '999px' }} />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.map(s => (
          <span key={s.label} className="mono text-[10.5px]" style={{ color: s.color }}>
            {s.n} {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ====== Helpers ====== */

function buildHeroBlurb(upcoming: number, readyNotSubmitted: number, placementRate: number) {
  const parts: string[] = [];
  if (upcoming > 0) parts.push(`${upcoming} הרצאות מתוכננות קדימה`);
  if (readyNotSubmitted > 0) parts.push(`${readyNotSubmitted} סטודנטים עברו הכנה וטרם שובצו`);
  if (placementRate > 0) parts.push(`שיעור השמה ${placementRate}%`);
  if (parts.length === 0) return 'בחר קורס + שנה כדי לראות את הנתונים.';
  return parts.join(' · ');
}

function nextLectureHint(date: Date) {
  const days = daysBetween(new Date(), date);
  if (days === 0) return '⚡ היום';
  if (days === 1) return '⚡ מחר';
  if (days <= 7) return `בעוד ${days} ימים`;
  return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}
