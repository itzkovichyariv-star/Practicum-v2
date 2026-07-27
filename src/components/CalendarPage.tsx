import { useEffect, useMemo, useState } from 'react';
import type { PageProps } from './pageShared';
import { sameContext, outlookCalendarUrl } from './pageShared';
import { supabase } from '../lib/supabase';

type CalEvent = {
  date: Date;
  title: string;
  type: 'lecture' | 'interview' | 'prep' | 'slot';
  status?: string;
  id: string;
  onClick?: () => void;
  calendarUrl?: string;
};

type SlotRow = {
  id: string; date: string; start_time: string; end_time: string;
  capacity: number; booked_count: number; course_name?: string; note?: string;
};

const HEB_DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Minimal hardcoded Jewish holidays (מועדים) for 2025–2027 Gregorian approximation
// Full integration with Hebcal API will be added later. For now, a calm subset.
const HEB_HOLIDAYS: Record<string, string> = {
  // 2025 / תשפ״ה
  '2025-09-23': 'ראש השנה', '2025-09-24': 'ראש השנה ב׳',
  '2025-10-02': 'יום כיפור',
  '2025-10-07': 'סוכות', '2025-10-14': 'שמחת תורה',
  '2025-12-14': 'חנוכה',
  // 2026 / תשפ״ו
  '2026-03-03': 'פורים',
  '2026-04-02': 'פסח', '2026-04-08': 'שביעי של פסח',
  '2026-04-22': 'יום העצמאות',
  '2026-05-22': 'שבועות',
  '2026-09-12': 'ראש השנה', '2026-09-13': 'ראש השנה ב׳',
  '2026-09-21': 'יום כיפור',
  '2026-09-26': 'סוכות', '2026-10-03': 'שמחת תורה',
  '2026-12-04': 'חנוכה',
  // 2027 / תשפ״ז
  '2027-02-22': 'פורים',
  '2027-04-22': 'פסח',
  '2027-05-12': 'יום העצמאות',
  '2027-06-11': 'שבועות',
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarPage({ data, context, onNavigate }: PageProps) {
  const now = new Date();
  const [cursor, setCursor] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [pinnedDay, setPinnedDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [pendingSubs, setPendingSubs] = useState<Array<{ id: string; name: string; email?: string; date: string; time: string }>>([]);

  // Load interview slots + pending submissions (candidates who booked but haven't been
  // accepted into the candidates table yet) from the public tables.
  useEffect(() => {
    (async () => {
      const [slotsRes, subsRes] = await Promise.all([
        supabase.from('public_interview_slots').select('*'),
        supabase.from('candidate_submissions').select('id, name, email, notes').eq('processed', false),
      ]);
      setSlots((slotsRes.data as SlotRow[]) || []);
      // Extract slot info from each submission's notes field
      const pending: Array<{ id: string; name: string; email?: string; date: string; time: string }> = [];
      ((subsRes.data as any[]) || []).forEach(s => {
        const m = String(s.notes || '').match(/בחר מועד ראיון:\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?:–\d{1,2}:\d{2})?)/);
        if (m) pending.push({ id: s.id, name: s.name, email: s.email, date: m[1], time: m[2] });
      });
      setPendingSubs(pending);
    })();
  }, []);

  // ESC closes the pinned popover; click-outside also closes
  useEffect(() => {
    if (!pinnedDay) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setPinnedDay(null); }
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-day-cell]')) setPinnedDay(null);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [pinnedDay]);

  const lectures = data.lectures || [];
  const candidates = data.candidates || [];
  // Interview Zoom link for a given ISO day: the day's own link, else the permanent
  // default room. Same resolution as RegistrationForm/notify-submission, so the invite
  // Yariv sends a candidate carries the SAME link they saw on screen and in their email.
  const zoomFor = (isoDate: string): string =>
    String((data.interviewZoomLinks || {})[String(isoDate).slice(0, 10)] || data.interviewZoomLinkDefault || '').trim();
  const students = data.students || [];

  const events = useMemo<CalEvent[]>(() => {
    const list: CalEvent[] = [];
    const courses = data.courses || [];
    lectures.filter(l => sameContext(l, context, courses)).forEach(l => {
      if (!l.date) return;
      const d = new Date(l.date);
      if (isNaN(d.getTime())) return;
      list.push({
        id: l.id,
        date: d,
        title: l.topic || l.courseName || 'הרצאה',
        type: 'lecture',
        status: l.status,
        onClick: () => onNavigate('lectures'),
        calendarUrl: outlookCalendarUrl({
          subject: `${l.type || 'הרצאה'}: ${l.topic || l.courseName || ''}`,
          startDate: l.date.slice(0, 10),
          startTime: l.startTime,
          endTime: l.endTime,
          location: l.link || l.location || l.institution,
          body: [l.topic, l.courseName ? 'קורס: ' + l.courseName : '', l.lecturer ? 'מרצה: ' + l.lecturer : '', l.notes || ''].filter(Boolean).join('\n'),
          attendeeEmail: l.lecturerEmail,
        }),
      });
    });
    candidates.filter(c => sameContext(c, context, courses)).forEach(c => {
      if (!c.interviewDate) return;
      const d = new Date(c.interviewDate);
      if (isNaN(d.getTime())) return;
      list.push({
        id: c.id,
        date: d,
        title: `ראיון · ${c.name}`,
        type: 'interview',
        status: c.interviewResult,
        onClick: () => onNavigate('candidates'),
        calendarUrl: outlookCalendarUrl({
          subject: `ראיון מועמד: ${c.name || ''}`,
          startDate: c.interviewDate.slice(0, 10),
          startTime: c.interviewTime ? c.interviewTime.split(/[-–]/)[0] : '10:00',
          endTime: c.interviewTime ? (c.interviewTime.split(/[-–]/)[1] || '10:45') : '10:45',
          location: zoomFor(c.interviewDate),
          body: [zoomFor(c.interviewDate) ? `קישור לראיון בזום: ${zoomFor(c.interviewDate)}` : '', 'נא להתחבר כמה דקות לפני המועד, במקום שקט ועם מצלמה פתוחה, ולהמתין בחדר ההמתנה בזום.'].filter(Boolean).join('\n'),
          attendeeEmail: c.email,
        }),
      });
    });
    students.filter(s => sameContext(s, context, courses)).forEach(s => {
      if (!s.preparation?.date) return;
      const d = new Date(s.preparation.date);
      if (isNaN(d.getTime())) return;
      list.push({
        id: s.id + '-prep',
        date: d,
        title: `הכנה · ${s.name}`,
        type: 'prep',
        onClick: () => onNavigate('students'),
        calendarUrl: outlookCalendarUrl({
          subject: `הכנה לפרקטיקום: ${s.name || ''}`,
          startDate: s.preparation.date.slice(0, 10),
        }),
      });
    });
    // Interview slots (availability) — show free slots in the calendar.
    // Excludes slots already fully booked (they become "interview" events via the candidate pipeline anyway).
    slots.forEach(s => {
      const d = new Date(s.date);
      if (isNaN(d.getTime())) return;
      const free = s.capacity - s.booked_count;
      if (free <= 0) return; // full slot — no need to show availability
      list.push({
        id: 'slot-' + s.id,
        date: d,
        title: `${s.start_time}–${s.end_time} · ${free}/${s.capacity} פנוי${s.course_name ? ' · ' + s.course_name : ''}`,
        type: 'slot',
        status: s.note,
        onClick: () => onNavigate('management'),
      });
    });
    // Pending submissions (candidates who booked an interview but haven't been accepted yet)
    pendingSubs.forEach(p => {
      const d = new Date(p.date);
      if (isNaN(d.getTime())) return;
      list.push({
        id: 'pending-' + p.id,
        date: d,
        title: `ראיון · ${p.name} · ${p.time}`,
        type: 'interview',
        status: 'pending',
        onClick: () => onNavigate('candidates'),
        calendarUrl: outlookCalendarUrl({
          subject: `ראיון מועמד: ${p.name}`,
          startDate: p.date,
          startTime: p.time.split('–')[0] || '10:00',
          endTime: p.time.split('–')[1] || '10:30',
          location: zoomFor(p.date),
          body: [zoomFor(p.date) ? `קישור לראיון בזום: ${zoomFor(p.date)}` : '', 'נא להתחבר כמה דקות לפני המועד, במקום שקט ועם מצלמה פתוחה, ולהמתין בחדר ההמתנה בזום.'].filter(Boolean).join('\n'),
          attendeeEmail: p.email,
        }),
      });
    });
    return list;
  }, [lectures, candidates, students, slots, pendingSubs, context, onNavigate]);

  const eventsByDay = useMemo(() => {
    const m: Record<string, CalEvent[]> = {};
    events.forEach(e => {
      const k = dayKey(e.date);
      (m[k] ||= []).push(e);
    });
    return m;
  }, [events]);

  const firstOfMonth = cursor;
  const year = firstOfMonth.getFullYear();
  const month = firstOfMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = firstOfMonth.getDay(); // 0 = Sunday

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthUpcoming = events
    .filter(e => e.date.getFullYear() === year && e.date.getMonth() === month)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  function goPrev() { setCursor(new Date(year, month - 1, 1)); }
  function goNext() { setCursor(new Date(year, month + 1, 1)); }
  function goToday() { setCursor(new Date(now.getFullYear(), now.getMonth(), 1)); }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-10 pt-14 pb-28">

      <section className="pt-4 pb-14 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">VI · לוח שנה</div>
        <div className="flex items-end justify-between gap-10 flex-wrap">
          <div>
            <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
              {HEB_MONTHS[month]} <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{year}</em>
            </h1>
            <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
              {monthUpcoming.length === 0
                ? 'אין אירועים מתוכננים לחודש זה בהקשר הנוכחי.'
                : `${monthUpcoming.length} אירועים השבוע/חודש · הרצאות, ראיונות, והכנות`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <NavBtn onClick={goPrev}>← חודש קודם</NavBtn>
            <NavBtn onClick={goToday} primary>היום</NavBtn>
            <NavBtn onClick={goNext}>חודש הבא →</NavBtn>
          </div>
        </div>
      </section>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-5 mb-6 mono text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--text-soft)' }}>
        <LegendDot color="var(--accent)" label="הרצאה" />
        <LegendDot color="#0a6e44" label="ראיון" />
        <LegendDot color="#4a6b8a" label="מועד פנוי" />
        <LegendDot color="#7a5a1e" label="הכנה" />
        <span className="opacity-60">· חגים יהודיים מודגשים ברקע אפור</span>
      </div>

      {/* Month grid */}
      <section className="mb-16">
        <div className="grid grid-cols-7 gap-0 border rounded-xl"
          style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.25)' }}>
          {HEB_DAYS.map(d => (
            <div key={d} className="py-3 text-center mono text-[11.5px] uppercase tracking-[0.16em] font-semibold border-b"
              style={{ color: 'var(--ink)', borderColor: 'var(--divider)', background: 'rgba(122,30,43,0.04)' }}>
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={i} className="h-28 border-t border-l"
                style={{ borderColor: 'var(--divider)' }}/>;
            }
            const cellDate = new Date(year, month, day);
            const key = dayKey(cellDate);
            const dayEvents = eventsByDay[key] || [];
            const holiday = HEB_HOLIDAYS[key];
            const isToday = key === dayKey(now);
            const hasEvents = dayEvents.length > 0;
            const isPinned = pinnedDay === key;
            const popoverOpen = isPinned; // stays open when pinned; hover-only via CSS group-hover
            return (
              <div
                key={i}
                data-day-cell
                onClick={() => hasEvents && setPinnedDay(isPinned ? null : key)}
                className={`h-28 border-t border-l p-2 overflow-visible flex flex-col gap-1 relative group ${hasEvents ? 'cursor-pointer' : ''}`}
                style={{
                  borderColor: 'var(--divider)',
                  background: isToday ? 'rgba(122, 30, 43, 0.1)' : holiday ? 'rgba(26, 22, 18, 0.04)' : 'transparent',
                  boxShadow: isToday ? 'inset 0 0 0 2px var(--accent)' : undefined,
                  zIndex: popoverOpen ? 30 : undefined,
                }}
              >
                <div className="flex items-baseline justify-between">
                  {isToday ? (
                    <span
                      className="serif text-[18px] leading-none rounded-full flex items-center justify-center"
                      style={{ width: 30, height: 30, background: 'var(--accent)', color: 'var(--bg)' }}
                    >
                      {day}
                    </span>
                  ) : (
                    <span
                      className="serif leading-none"
                      style={{
                        color: hasEvents ? 'var(--accent)' : 'var(--ink)',
                        fontSize: hasEvents ? '22px' : '20px',
                        fontWeight: hasEvents ? 600 : 400,
                      }}
                    >
                      {day}
                    </span>
                  )}
                  {holiday && <span className="mono text-[9px] uppercase tracking-[0.1em] opacity-70 truncate max-w-[70%]" title={holiday} style={{ color: 'var(--text-soft)' }}>{holiday}</span>}
                </div>
                {isToday && (
                  <span className="absolute bottom-1.5 right-2 mono text-[9px] uppercase tracking-[0.15em] font-bold"
                    style={{ color: 'var(--accent)' }}>היום</span>
                )}

                {/* Inline preview — first 2 events */}
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  {dayEvents.slice(0, 2).map(e => (
                    <span
                      key={e.id}
                      className="text-right text-[10.5px] truncate rounded px-1.5 py-0.5"
                      style={{
                        background: eventColor(e.type) + '22',
                        color: eventColor(e.type),
                        borderRight: `2px solid ${eventColor(e.type)}`,
                      }}
                    >
                      {e.title}
                    </span>
                  ))}
                  {dayEvents.length > 2 && (
                    <span className="text-[10px] mono tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>
                      +{dayEvents.length - 2} נוספים
                    </span>
                  )}
                </div>

                {/* Hover / pinned popover — full details */}
                {hasEvents && (
                  <div
                    className={`absolute top-full left-0 right-0 mt-1 ${isPinned ? '' : 'invisible group-hover:visible'} rounded-xl shadow-lg border p-3 flex flex-col gap-2 z-50`}
                    style={{
                      background: 'var(--bg)',
                      borderColor: 'var(--divider)',
                      boxShadow: '0 12px 40px rgba(26, 22, 18, 0.2)',
                      minWidth: 240,
                    }}
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <div className="flex items-baseline justify-between gap-2 pb-1.5 mb-1 border-b" style={{ borderColor: 'var(--divider)' }}>
                      <div className="serif text-[18px]" style={{ color: 'var(--ink)' }}>
                        {day} {HEB_MONTHS[month]}
                      </div>
                      <div className="mono text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>
                        {dayEvents.length} אירועים
                      </div>
                    </div>
                    {dayEvents.map(e => (
                      <div
                        key={e.id}
                        className="text-right rounded-md p-2 flex items-start gap-2 hover:bg-[rgba(122,30,43,0.06)] transition-colors"
                        style={{ borderRight: `3px solid ${eventColor(e.type)}` }}
                      >
                        <button onClick={e.onClick} className="flex-1 text-right">
                          <div className="text-[13px] leading-[1.3]" style={{ color: 'var(--ink)' }}>{e.title}</div>
                          <div className="mono text-[10px] uppercase tracking-[0.12em] mt-0.5" style={{ color: eventColor(e.type) }}>
                            {e.type === 'lecture' ? 'הרצאה' : e.type === 'interview' ? 'ראיון' : 'הכנה'}
                            {e.status && ` · ${e.status}`}
                          </div>
                        </button>
                        {e.calendarUrl && (
                          <button
                            type="button"
                            title="הוסף ליומן Outlook"
                            onClick={(ev) => { ev.stopPropagation(); window.open(e.calendarUrl, '_blank'); }}
                            className="w-7 h-7 rounded-full border grid place-items-center shrink-0 hover:bg-[rgba(122,30,43,0.1)]"
                            style={{ borderColor: 'var(--divider)', color: 'var(--ink)', fontSize: 12 }}
                          >📅</button>
                        )}
                      </div>
                    ))}
                    {isPinned && (
                      <button
                        onClick={() => setPinnedDay(null)}
                        className="mono text-[10px] uppercase tracking-[0.14em] text-center py-1 mt-1 hover:opacity-70"
                        style={{ color: 'var(--text-soft)' }}
                      >
                        סגור
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Upcoming list */}
      <section>
        <div className="flex items-baseline justify-between gap-10 mb-8 pb-5 border-b" style={{ borderColor: 'var(--divider)' }}>
          <h2 className="serif text-[30px] tracking-tight leading-[1.15]" style={{ color: 'var(--ink)' }}>אירועי החודש</h2>
          <span className="mono text-[12px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-soft)' }}>
            {monthUpcoming.length} אירועים
          </span>
        </div>
        {monthUpcoming.length === 0 ? (
          <div className="py-12 text-center text-[15px]" style={{ color: 'var(--text-soft)' }}>
            אין אירועים בחודש זה.
          </div>
        ) : (
          <ul>
            {monthUpcoming.map(e => (
              <li key={e.id} className="py-4 border-b flex items-baseline gap-5" style={{ borderColor: 'var(--divider)' }}>
                <div className="w-20 text-right">
                  <div className="serif text-[24px] leading-none" style={{ color: 'var(--ink)' }}>
                    {String(e.date.getDate()).padStart(2, '0')}
                  </div>
                  <div className="mono text-[10px] uppercase tracking-[0.16em] mt-1" style={{ color: 'var(--text-soft)' }}>
                    {HEB_DAYS[e.date.getDay()]}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-[15px]" style={{ color: 'var(--ink)' }}>{e.title}</div>
                  <div className="mono text-[10.5px] uppercase tracking-[0.14em] mt-1" style={{ color: eventColor(e.type) }}>
                    {e.type === 'lecture' ? 'הרצאה' : e.type === 'interview' ? 'ראיון' : 'הכנה'}
                    {e.status && ` · ${e.status}`}
                  </div>
                </div>
                <button onClick={e.onClick}
                  className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
                  style={{ color: 'var(--accent)' }}>
                  פתח ←
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

    </main>
  );
}

function eventColor(type: string): string {
  switch (type) {
    case 'lecture': return '#7a1e2b';
    case 'interview': return '#0a6e44';
    case 'prep': return '#7a5a1e';
    case 'slot': return '#4a6b8a';  // calm blue — indicates availability
    default: return '#1a1612';
  }
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function NavBtn({ children, onClick, primary }: { children: any; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick}
      className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold px-4 py-1.5 rounded-full border transition-colors"
      style={{
        color: primary ? 'var(--bg)' : 'var(--accent)',
        background: primary ? 'var(--accent)' : 'transparent',
        borderColor: 'var(--accent)',
      }}>
      {children}
    </button>
  );
}
