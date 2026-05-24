import { useMemo, useState } from 'react';
import type { Employer } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { normalizeYear } from './pageShared';
import { saveSnapshot } from '../lib/dataApi';
import { showToast } from '../lib/toast';
import EmployerEditor from './EmployerEditor';
import { RowActions, Popover, NeedsUpdate, RefreshButton } from './StudentsPage';
import ExcelImport from './ExcelImport';

/** Returns the courseIds of an employer, supporting both old and new format */
function empCourseIds(e: Employer): string[] {
  if (e.courseIds && e.courseIds.length > 0) return e.courseIds;
  if (e.courseId) return [e.courseId];
  return [];
}

export default function EmployersPage({ data, context, userName, onRefresh }: PageProps) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Employer | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const all = data.employers || [];
  const courses = data.courses || [];
  const students = data.students || [];

  const years = useMemo(() => {
    const set = new Set<string>();
    courses.forEach(c => c.year && set.add(normalizeYear(c.year)));
    (data.academicYears || []).forEach(y => set.add(normalizeYear(y)));
    return Array.from(set).sort().reverse();
  }, [courses, data.academicYears]);

  // Employers are filtered by courseIds (new) or courseId (legacy).
  // Year filter: check if any linked course matches the selected year.
  const scoped = useMemo(() => all.filter(e => {
    const ids = empCourseIds(e);
    if (context.courseId !== '__all__') {
      // context.courseId may be a course name — expand to all matching IDs
      const allowedIds = new Set(
        courses.filter(c => c.name === context.courseId || c.id === context.courseId).map(c => c.id)
      );
      if (!ids.some(id => allowedIds.has(id))) return false;
    }
    if (context.year !== '__all__') {
      const matches = ids.some(cid => {
        const course = courses.find(c => c.id === cid);
        return course && normalizeYear(course.year) === normalizeYear(context.year);
      });
      if (!matches) return false;
    }
    return true;
  }), [all, context, courses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter(e => {
      if (!q) return true;
      const hay = [e.name, e.contactPerson, e.contactEmail, e.location].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  }, [scoped, search]);

  const totalPositions = scoped.reduce((s, e) => s + (Number(e.positions) || 0), 0);
  const filledPositions = scoped.reduce((s, e) => s + (Number(e.filledPositions) || 0), 0);
  const openPositions = Math.max(0, totalPositions - filledPositions);

  async function persistAndRefresh(next: Employer[], msg: string) {
    setSaving(true); setSaveMsg(null);
    const res = await saveSnapshot({ ...data, employers: next }, { name: userName });
    setSaving(false);
    if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
    setSaveMsg(msg);
    showToast(msg + ' · נשמר בענן ☁️', 'success');
    (data.employers as Employer[]) = next;
    onRefresh();
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function handleSave(e: Employer) {
    const idx = all.findIndex(x => x.id === e.id);
    const next = idx >= 0 ? [...all] : [...all, e];
    if (idx >= 0) next[idx] = e;
    setEditing(null); setCreating(false);
    await persistAndRefresh(next, idx >= 0 ? '✓ עודכן' : '✓ נוסף');
  }

  async function handleDelete(id: string) {
    setEditing(null);
    await persistAndRefresh(all.filter(e => e.id !== id), '✓ נמחק');
  }

  return (
    <main className="max-w-[1200px] mx-auto px-10 pt-14 pb-28">
      <section className="pt-4 pb-14 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">IV · מעסיקים</div>
        <div className="flex items-end justify-between gap-10">
          <div>
            <h1 className="serif text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>מעסיקים</h1>
            <p className="text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
              {scoped.length === 0
                ? 'אין מעסיקים בהקשר הנוכחי.'
                : `${scoped.length} ארגונים · ${totalPositions} משרות · ${openPositions} פתוחות · ${filledPositions} מאוישות`}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setCreating(true)} className="btn btn-primary whitespace-nowrap">
              + מעסיק חדש <span className="serif text-[16px]">→</span>
            </button>
            <button onClick={() => setShowImport(i => !i)} className="btn whitespace-nowrap">
              ⬆ ייבוא Excel
            </button>
          </div>
        </div>
      </section>

      <div className="mono text-[12px] uppercase tracking-[0.16em] flex items-center gap-4 flex-wrap mb-10" style={{ color: 'var(--text-soft)' }}>
        <RefreshButton onRefresh={onRefresh} />
        {saveMsg && <span style={{ color: 'var(--accent)' }}>· {saveMsg}</span>}
        {saving && <span className="opacity-75">· שומר...</span>}
      </div>

      {showImport && (
        <section className="mb-8">
          <ExcelImport kind="employers" data={data} userName={userName} onDone={() => { setShowImport(false); onRefresh(); }} />
        </section>
      )}

      <section className="mb-10">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="חפש לפי שם ארגון, איש קשר, מייל, מיקום..."
          className="input w-full"
          style={{ padding: '10px 16px', fontSize: '14px' }}
        />
      </section>

      <section>
        {filtered.length === 0 ? (
          <div className="py-24 text-center">
            <div className="serif text-[26px]" style={{ color: 'var(--ink)' }}>אין מעסיקים להצגה</div>
            <div className="mt-3 text-[14px]" style={{ color: 'var(--text-soft)' }}>נסה להסיר סינון או להוסיף חדש.</div>
          </div>
        ) : (
          <ul>
            {filtered.map(e => {
              const hiredHere = students.filter(s => s.acceptedOrg === e.name);
              const linkedCourses = empCourseIds(e).map(cid => courses.find(c => c.id === cid)).filter(Boolean);
              return <EmployerRow key={e.id} emp={e} hiredCount={hiredHere.length}
                linkedCourses={linkedCourses as any}
                onEdit={() => setEditing(e)} hiredNames={hiredHere.map(s => s.name)}
                pinned={pinnedId === e.id} onTogglePin={() => setPinnedId(pinnedId === e.id ? null : e.id)} />;
            })}
          </ul>
        )}
      </section>

      {(editing || creating) && (
        <EmployerEditor
          employer={editing}
          courses={courses}
          years={years}
          defaultCourseId={context.courseId}
          defaultYear={context.year}
          onSave={handleSave}
          onDelete={editing ? handleDelete : undefined}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </main>
  );
}

function EmployerRow({ emp, hiredCount, hiredNames, linkedCourses, onEdit, pinned, onTogglePin }: {
  emp: Employer; hiredCount: number; hiredNames: string[]; linkedCourses: { name: string; year?: string }[];
  onEdit: () => void; pinned: boolean; onTogglePin: () => void;
}) {
  const total = Number(emp.positions) || 0;
  const filled = Number(emp.filledPositions) || 0;
  const open = Math.max(0, total - filled);
  return (
    <li className="relative group" data-info-row>
      <div onClick={onTogglePin}
        className="py-5 border-b grid grid-cols-[1fr_auto_auto] gap-5 items-baseline cursor-pointer hover:bg-[rgba(122,30,43,0.02)]"
        style={{ borderColor: 'var(--divider)' }}>
        <div>
          <div className="serif text-[22px] leading-[1.2] tracking-tight mb-1" style={{ color: 'var(--ink)' }}>
            {emp.name}
            {emp.location && <span className="text-[14px] mr-3" style={{ color: 'var(--text-soft)' }}>· {emp.location}</span>}
          </div>
          <div className="text-[13.5px] flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--text-soft)' }}>
            {emp.contactPerson && <span>{emp.contactPerson}</span>}
            {emp.contactPhone && <span dir="ltr">{emp.contactPhone}</span>}
            {emp.contactEmail && <span>{emp.contactEmail}</span>}
          </div>
          {linkedCourses.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {linkedCourses.map(c => (
                <span key={c.name} className="mono text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)' }}>
                  {c.name} {c.year}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="text-left flex flex-col items-end gap-1">
          {(!emp.contactPhone || !emp.contactEmail) && <NeedsUpdate />}
          {total > 0 ? (
            <>
              <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: open > 0 ? 'var(--accent)' : 'var(--text-soft)' }}>
                {filled}/{total} משרות
              </span>
              {open > 0 && <span className="mono text-[10.5px] tracking-[0.12em]" style={{ color: 'var(--accent)' }}>· {open} פתוחות</span>}
            </>
          ) : (
            <span className="mono text-[10.5px] tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>
              {hiredCount > 0 ? `${hiredCount} סטודנטים` : 'לא סומן'}
            </span>
          )}
        </div>
        <div onClick={e => e.stopPropagation()}>
          <RowActions phone={emp.contactPhone} email={emp.contactEmail} name={emp.contactPerson || emp.name} onEdit={onEdit} />
        </div>
      </div>

      <Popover pinned={pinned}>
        <div className="flex items-baseline justify-between gap-3 pb-3 mb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
          <div>
            <div className="serif text-[22px] leading-[1.15]" style={{ color: 'var(--ink)' }}>{emp.name}</div>
            {emp.location && <div className="mono text-[10.5px] uppercase tracking-[0.14em] mt-1" style={{ color: 'var(--text-soft)' }}>{emp.location}</div>}
          </div>
          {pinned && <button onClick={onTogglePin} className="mono text-[10px] uppercase tracking-[0.14em] font-semibold opacity-60 hover:opacity-100">✕</button>}
        </div>
        <div className="space-y-1.5 text-[13px]">
          <DetailRowE label="איש קשר" value={emp.contactPerson} />
          <DetailRowE label="טלפון" value={emp.contactPhone} />
          <DetailRowE label="מייל" value={emp.contactEmail} />
          <DetailRowE label="משרות" value={total > 0 ? `${filled}/${total} · ${open} פתוחות` : undefined} />
          <DetailRowE label="סטודנטים שובצו" value={hiredNames.length > 0 ? hiredNames.join(', ') : undefined} accent={hiredNames.length > 0} />
        </div>
      </Popover>
    </li>
  );
}

function DetailRowE({ label, value, accent }: { label: string; value?: string | null; accent?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-3">
      <span className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold w-24 shrink-0" style={{ color: 'var(--text-soft)' }}>{label}</span>
      <span style={{ color: accent ? 'var(--accent)' : 'var(--ink)' }}>{value}</span>
    </div>
  );
}
