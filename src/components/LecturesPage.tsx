import { useMemo, useState } from 'react';
import type { Lecture } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear, outlookCalendarUrl } from './pageShared';
import { saveSnapshot } from '../lib/dataApi';
import { showToast } from '../lib/toast';
import * as ms from '../lib/msGraph';
import LectureEditor from './LectureEditor';
import { RowActions, NeedsUpdate, RefreshButton, StatusDot, type DotStatus } from './StudentsPage';

function hebMonth(d: Date) {
  return ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'][d.getMonth()];
}
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / (86400*1000));
}

type Filters = {
  search: string;
  status: string;  // '' = all
  type: string;
  semester: string;
  hidePast: boolean;
};

const emptyFilters: Filters = { search: '', status: '', type: '', semester: '', hidePast: true };

export default function LecturesPage({
  data, context, userName, onRefresh,
}: PageProps) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [editing, setEditing] = useState<Lecture | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const all = data.lectures || [];
  const courses = data.courses || [];

  const years = useMemo(() => {
    const set = new Set<string>();
    courses.forEach(c => c.year && set.add(normalizeYear(c.year)));
    (all).forEach(l => l.year && set.add(normalizeYear(l.year)));
    (data.academicYears || []).forEach(y => set.add(normalizeYear(y)));
    return Array.from(set).sort().reverse();
  }, [courses, all, data.academicYears]);

  const scoped = useMemo(() => all.filter(l => sameContext(l, context)), [all, context]);

  const now = new Date();
  const today = new Date(now.toDateString());

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return scoped.filter(l => {
      if (filters.status && l.status !== filters.status) return false;
      if (filters.type && l.type !== filters.type) return false;
      if (filters.semester && l.semester !== filters.semester) return false;
      if (filters.hidePast && l.date) {
        const d = new Date(l.date);
        if (!isNaN(d.getTime()) && d < today) return false;
      }
      if (q) {
        const hay = [l.topic, l.lecturer, l.courseName, l.institution, l.notes].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const ad = a.date ? new Date(a.date).getTime() : Infinity;
      const bd = b.date ? new Date(b.date).getTime() : Infinity;
      return ad - bd;
    });
  }, [scoped, filters, today]);

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    scoped.forEach(l => { m[l.status || 'לא ידוע'] = (m[l.status || 'לא ידוע'] || 0) + 1; });
    return m;
  }, [scoped]);

  const upcomingCount = scoped.filter(l => {
    if (!l.date) return false;
    const d = new Date(l.date);
    return !isNaN(d.getTime()) && d >= today && l.status !== 'בוטל';
  }).length;

  async function persistAfterChange(next: Lecture[], action: string, activityTarget?: string) {
    setSaving(true);
    setSaveMsg(null);
    const nextData = { ...data, lectures: next };
    const actVerb = action.includes('נוצרה') ? 'נוסף' : action.includes('נמחקה') ? 'נמחק' : 'עודכן';
    const res = await saveSnapshot(
      nextData,
      { name: userName },
      activityTarget ? { action: actVerb, entity: 'הרצאה', target: activityTarget } : undefined
    );
    setSaving(false);
    if (!res.ok) {
      setSaveMsg('שגיאה: ' + (res.error || ''));
      showToast('שגיאה בשמירה: ' + (res.error || ''), 'error');
      return;
    }
    setSaveMsg(action);
    showToast(action + ' · נשמר בענן ☁️', 'success');
    // mutate in place so UI refreshes on next render
    (data.lectures as Lecture[]) = next;
    onRefresh();
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function syncToOutlook(lec: Lecture, mode: 'create' | 'update' | 'delete'): Promise<Lecture> {
    if (!(await ms.isSignedIn())) return lec;
    if (!lec.date) return lec;
    try {
      if (mode === 'delete') {
        if (lec.graphEventId) await ms.deleteEvent(lec.graphEventId);
        return lec;
      }
      const payload: ms.EventInput = {
        subject: `${lec.type || 'הרצאה'}: ${lec.topic || lec.courseName || ''}`,
        startDate: lec.date,
        startTime: lec.startTime,
        endTime: lec.endTime,
        location: lec.link || lec.location || lec.institution,
        body: [lec.topic, lec.courseName ? 'קורס: ' + lec.courseName : '', lec.lecturer ? 'מרצה: ' + lec.lecturer : '', lec.notes || ''].filter(Boolean).join('\n'),
        attendeeEmails: lec.lecturerEmail ? [lec.lecturerEmail] : [],
      };
      if (mode === 'update' && lec.graphEventId) {
        await ms.updateEvent(lec.graphEventId, payload);
        return lec;
      }
      const created = await ms.createEvent(payload);
      return created?.id ? { ...lec, graphEventId: created.id } : lec;
    } catch (e) {
      console.warn('Outlook sync failed:', e);
      return lec;
    }
  }

  async function handleSave(lec: Lecture) {
    const idx = all.findIndex(l => l.id === lec.id);
    const synced = await syncToOutlook(lec, idx >= 0 ? 'update' : 'create');
    let next: Lecture[];
    let action: string;
    if (idx >= 0) {
      next = [...all];
      next[idx] = synced;
      action = '✓ ההרצאה עודכנה';
    } else {
      next = [...all, synced];
      action = '✓ הרצאה נוצרה';
    }
    setEditing(null);
    setCreating(false);
    await persistAfterChange(next, action, synced.topic || synced.courseName || 'הרצאה');
  }

  async function handleDelete(id: string) {
    const lec = all.find(l => l.id === id);
    if (lec) await syncToOutlook(lec, 'delete');
    const next = all.filter(l => l.id !== id);
    setEditing(null);
    await persistAfterChange(next, '✓ ההרצאה נמחקה', lec?.topic || lec?.courseName || 'הרצאה');
  }

  const presentStatuses = Array.from(new Set(scoped.map(l => l.status).filter(Boolean))) as string[];
  const presentTypes = Array.from(new Set(scoped.map(l => l.type).filter(Boolean))) as string[];

  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-10 pt-14 pb-28">

      {/* Hero */}
      <section className="pt-4 pb-14 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">II · הרצאות</div>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 md:gap-10">
          <div>
            <h1 className="serif text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
              הרצאות
            </h1>
            <p className="text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
              {buildHeadline(upcomingCount, scoped.length, statusCounts)}
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="btn btn-primary whitespace-nowrap self-start md:self-auto"
          >
            + הרצאה חדשה <span className="serif text-[16px]">→</span>
          </button>
        </div>

        {/* Status breakdown */}
        {scoped.length > 0 && (
          <div className="flex flex-wrap gap-x-9 gap-y-3 mt-10">
            {Object.entries(statusCounts).map(([status, n]) => (
              <div key={status}>
                <div className="mono text-[11px] uppercase tracking-[0.16em] font-medium mb-1" style={{ color: 'var(--text-soft)' }}>
                  {status}
                </div>
                <div className="serif text-[30px] leading-none tracking-tight" style={{ color: 'var(--ink)' }}>{n}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Status strip */}
      <div className="mono text-[12px] uppercase tracking-[0.16em] flex items-center gap-4 flex-wrap mb-10" style={{ color: 'var(--text-soft)' }}>
        <RefreshButton onRefresh={onRefresh} />
        {saveMsg && (
          <span style={{ color: saveMsg.startsWith('✓') ? 'var(--accent)' : 'var(--accent)' }}>
            · {saveMsg}
          </span>
        )}
        {saving && <span className="opacity-75">· שומר...</span>}
      </div>

      {/* Filters */}
      <section className="mb-10 flex flex-col md:flex-row flex-wrap gap-3 md:items-baseline">
        <input
          type="search"
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          placeholder="חפש לפי נושא, מרצה, קורס..."
          className="input w-full md:flex-1"
          style={{ padding: '10px 16px', fontSize: '14px' }}
        />
        <FilterSelect
          label="סטטוס"
          value={filters.status}
          onChange={v => setFilters(f => ({ ...f, status: v }))}
          options={presentStatuses}
        />
        <FilterSelect
          label="סוג"
          value={filters.type}
          onChange={v => setFilters(f => ({ ...f, type: v }))}
          options={presentTypes}
        />
        <FilterSelect
          label="סמסטר"
          value={filters.semester}
          onChange={v => setFilters(f => ({ ...f, semester: v }))}
          options={['א׳', 'ב׳', 'קיץ']}
        />
        <label className="inline-flex items-center gap-2 mono text-[12px] uppercase tracking-[0.14em] font-semibold cursor-pointer" style={{ color: 'var(--ink)' }}>
          <input
            type="checkbox"
            checked={filters.hidePast}
            onChange={e => setFilters(f => ({ ...f, hidePast: e.target.checked }))}
          />
          הסתר עבר
        </label>
      </section>

      {/* List */}
      <section>
        {filtered.length === 0 ? (
          <div className="py-24 text-center">
            <div className="serif text-[26px]" style={{ color: 'var(--ink)' }}>אין הרצאות להצגה</div>
            <div className="mt-3 text-[14px]" style={{ color: 'var(--text-soft)' }}>
              נסה לשנות את הסינון, או הוסף הרצאה חדשה.
            </div>
          </div>
        ) : (
          <ul>
            {filtered.map(lec => <LectureItem key={lec.id} lec={lec} now={now} onEdit={() => setEditing(lec)} />)}
          </ul>
        )}
      </section>

      {(editing || creating) && (
        <LectureEditor
          lecture={editing}
          courses={courses}
          years={years}
          defaultCourseId={context.courseId}
          defaultYear={context.year}
          typeOptions={Array.from(new Set(all.map(l => l.type).filter(Boolean))) as string[]}
          statusOptions={Array.from(new Set(all.map(l => l.status).filter(Boolean))) as string[]}
          onSave={handleSave}
          onDelete={editing ? handleDelete : undefined}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </main>
  );
}

/* ==== Subcomponents ==== */

function LectureItem({ lec, now, onEdit }: { lec: Lecture; now: Date; onEdit: () => void }) {
  const date = lec.date ? new Date(lec.date) : null;
  const valid = date && !isNaN(date.getTime());
  const days = valid ? daysBetween(new Date(now.toDateString()), date) : null;
  const isUpcoming = days !== null && days >= 0;
  const isUrgent = isUpcoming && days! <= 3;
  const isPast = days !== null && days < 0;
  const isCancelled = lec.status === 'בוטל';

  const dayColor = isUrgent ? 'var(--accent)' : isPast ? 'var(--text-soft)' : 'var(--ink)';

  return (
    <li className="py-5 border-b" style={{ borderColor: 'var(--divider)', opacity: isCancelled ? 0.5 : 1 }}>
      {/* Mobile: flex-col; Desktop: 4-col grid */}
      <div className="flex gap-4 md:grid md:grid-cols-[16px_90px_1fr_auto_auto] md:gap-6 md:items-baseline">

        {/* Traffic-light dot */}
        <div className="hidden md:flex items-start pt-3">
          <StatusDot status={
            isCancelled ? 'red' :
            isPast ? 'green' :
            lec.status === 'מאושר' ? 'amber' :
            'gray'
          } size={9} />
        </div>

      <div className="shrink-0 w-12 md:w-auto">
        {valid ? (
          <>
            <div className="mono text-[11px] uppercase tracking-[0.18em] font-semibold" style={{ color: 'var(--text-soft)' }}>
              {hebMonth(date!)}
            </div>
            <div className="serif text-[32px] md:text-[38px] leading-none tracking-tight mt-1" style={{ color: dayColor }}>
              {String(date!.getDate()).padStart(2, '0')}
            </div>
            {lec.startTime && (
              <div className="mono text-[11px] tracking-[0.1em] mt-1" style={{ color: 'var(--text-soft)' }}>
                {lec.startTime}
              </div>
            )}
          </>
        ) : (
          <div className="mono text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-soft)' }}>ללא תאריך</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <div className="serif text-[20px] md:text-[22px] leading-[1.2] tracking-tight mb-1" style={{ color: 'var(--ink)' }}>
            {lec.topic || 'ללא נושא'}
          </div>
          {lec.type && lec.type !== 'הרצאה' && (
            <span className="mono text-[10px] uppercase tracking-[0.12em] px-2.5 py-0.5 rounded-full border self-center" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
              {lec.type}
            </span>
          )}
        </div>
        <div className="text-[13px] md:text-[13.5px]" style={{ color: 'var(--text-soft)' }}>
          {[lec.courseName, lec.lecturer, lec.institution || lec.location].filter(Boolean).join(' · ')}
          {lec.semester && ` · סמ׳ ${lec.semester}`}
        </div>
        {(!lec.lecturer || !lec.lecturerPhone || !lec.lecturerEmail) && (
          <div className="mt-1"><NeedsUpdate /></div>
        )}
        {/* Status badge on mobile */}
        <div className="flex items-center gap-2 mt-2 md:hidden">
          <span
            className="mono text-[10px] uppercase tracking-[0.15em] font-semibold px-2.5 py-0.5 rounded-full"
            style={{
              color: isCancelled ? 'var(--text-soft)' : 'var(--accent)',
              background: isCancelled ? 'transparent' : 'rgba(122, 30, 43, 0.08)',
              border: isCancelled ? '1px solid var(--divider)' : 'none',
            }}
          >
            {lec.status || '—'}
          </span>
          {isUpcoming && !isCancelled && (
            <span className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: isUrgent ? 'var(--accent)' : 'var(--text-soft)' }}>
              {days === 0 ? 'היום' : days === 1 ? 'מחר' : `${days}י׳`}
            </span>
          )}
        </div>
      </div>

      <div className="hidden md:flex text-left flex-col items-end gap-1.5">
        <span
          className="mono text-[11px] uppercase tracking-[0.15em] font-semibold whitespace-nowrap px-3 py-1 rounded-full"
          style={{
            color: isCancelled ? 'var(--text-soft)' : 'var(--accent)',
            background: isCancelled ? 'transparent' : 'rgba(122, 30, 43, 0.08)',
            border: isCancelled ? '1px solid var(--divider)' : 'none',
          }}
        >
          {lec.status || '—'}
        </span>
        {isUpcoming && !isCancelled && (
          <span className="mono text-[10.5px] uppercase tracking-[0.12em]" style={{ color: isUrgent ? 'var(--accent)' : 'var(--text-soft)' }}>
            {days === 0 ? 'היום' : days === 1 ? 'מחר' : `בעוד ${days} ימים`}
          </span>
        )}
      </div>

      <RowActions
        phone={lec.lecturerPhone}
        email={lec.lecturerEmail}
        name={lec.lecturer}
        onEdit={onEdit}
        calendarUrl={lec.date ? outlookCalendarUrl({
          subject: `${lec.type || 'הרצאה'}: ${lec.topic || lec.courseName || ''}`,
          startDate: lec.date,
          startTime: lec.startTime,
          endTime: lec.endTime,
          location: lec.link || lec.location || lec.institution,
          body: [lec.topic, lec.courseName ? 'קורס: ' + lec.courseName : '', lec.lecturer ? 'מרצה: ' + lec.lecturer : '', lec.notes || ''].filter(Boolean).join('\n'),
          attendeeEmail: lec.lecturerEmail,
        }) : undefined}
      />
      </div>
    </li>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="inline-flex items-center gap-2">
      <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--text-soft)' }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mono text-[13px] uppercase tracking-[0.12em] font-semibold bg-transparent border rounded-full cursor-pointer"
        style={{
          color: value ? 'var(--accent)' : 'var(--ink)',
          borderColor: 'var(--divider)',
          padding: '6px 26px 6px 14px',
          appearance: 'none',
          WebkitAppearance: 'none',
          backgroundImage:
            'linear-gradient(45deg, transparent 50%, var(--accent) 50%), linear-gradient(135deg, var(--accent) 50%, transparent 50%)',
          backgroundPosition: 'calc(100% - 10px) center, calc(100% - 6px) center',
          backgroundSize: '4px 4px',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <option value="">הכל</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function buildHeadline(upcoming: number, total: number, statusCounts: Record<string, number>): string {
  if (total === 0) return 'אין הרצאות בהקשר הנוכחי. לחץ על "+ הרצאה חדשה" כדי להתחיל.';
  const parts: string[] = [];
  if (upcoming > 0) parts.push(`${upcoming} עתידיות`);
  const approved = statusCounts['מאושר'] || 0;
  const pending = (statusCounts['ממתין לאישור'] || 0) + (statusCounts['בקשה נשלחה'] || 0);
  if (approved) parts.push(`${approved} מאושרות`);
  if (pending) parts.push(`${pending} ממתינות לאישור`);
  if (parts.length === 0) return `סה״כ ${total} הרצאות בהקשר הנוכחי.`;
  return parts.join(' · ');
}
