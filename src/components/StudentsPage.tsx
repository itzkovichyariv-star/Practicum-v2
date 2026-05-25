import { useEffect, useMemo, useRef, useState } from 'react';
import type { Student, Candidate } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear, groupByYearCourse } from './pageShared';
import { saveSnapshot, randomId } from '../lib/dataApi';
import { showToast } from '../lib/toast';
import StudentEditor from './StudentEditor';
import ExcelImport from './ExcelImport';

type Filters = {
  search: string;
  stage: 'all' | 'prep' | 'placed' | 'hired' | 'completed' | 'notplaced';
};

const emptyFilters: Filters = { search: '', stage: 'all' };

export default function StudentsPage({ data, context, userName, onRefresh }: PageProps) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [editing, setEditing] = useState<Student | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [cvUpdates, setCvUpdates] = useState<Record<string, { id: string; cv_file_path: string; uploaded_at: string }>>({});

  useEffect(() => {
    supabase.from('cv_updates')
      .select('id, email, cv_file_path, uploaded_at')
      .is('seen_at', null)
      .then(({ data: rows }) => {
        if (!rows) return;
        const map: Record<string, { id: string; cv_file_path: string; uploaded_at: string }> = {};
        for (const row of rows) {
          const key = (row.email || '').toLowerCase();
          if (!map[key] || row.uploaded_at > map[key].uploaded_at) {
            map[key] = { id: row.id, cv_file_path: row.cv_file_path, uploaded_at: row.uploaded_at };
          }
        }
        setCvUpdates(map);
      });
  }, []);

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

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return scoped.filter(s => {
      if (filters.stage === 'prep' && !s.preparation?.passed) return false;
      if (filters.stage === 'placed' && !s.acceptedOrg) return false;
      if (filters.stage === 'hired' && !s.hired) return false;
      if (filters.stage === 'completed' && !s.practicumCompleted) return false;
      if (filters.stage === 'notplaced' && (s.acceptedOrg || s.hired || s.practicumCompleted)) return false;
      if (q) {
        const hay = [s.name, s.phone, s.email, s.city, s.acceptedOrg, s.notes].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  }, [scoped, filters]);

  const counts = useMemo(() => ({
    total: scoped.length,
    prep: scoped.filter(s => s.preparation?.passed).length,
    placed: scoped.filter(s => s.acceptedOrg).length,
    hired: scoped.filter(s => s.hired).length,
    completed: scoped.filter(s => s.practicumCompleted).length,
    notplaced: scoped.filter(s => !s.acceptedOrg && !s.hired && !s.practicumCompleted).length,
  }), [scoped]);

  async function persistAndRefresh(next: Student[], msg: string) {
    setSaving(true);
    setSaveMsg(null);
    const nextData = { ...data, students: next };
    const res = await saveSnapshot(nextData, { name: userName });
    setSaving(false);
    if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
    setSaveMsg(msg);
    showToast(msg + ' · נשמר בענן ☁️', 'success');
    (data.students as Student[]) = next;
    onRefresh();
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function handleSave(s: Student) {
    const idx = all.findIndex(x => x.id === s.id);
    const previous = idx >= 0 ? all[idx] : null;
    const next = idx >= 0 ? [...all] : [...all, s];
    if (idx >= 0) next[idx] = s;
    setEditing(null); setCreating(false);

    // Auto-increment filledPositions when acceptedOrg is newly set
    const orgJustSet = s.acceptedOrg && !previous?.acceptedOrg;
    if (orgJustSet) {
      const empIdx = employers.findIndex(e => e.name === s.acceptedOrg);
      if (empIdx >= 0) {
        const updatedEmps = [...employers];
        const emp = updatedEmps[empIdx];
        updatedEmps[empIdx] = { ...emp, filledPositions: (emp.filledPositions || 0) + 1 };
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

    await persistAndRefresh(next, idx >= 0 ? '✓ הסטודנט/ית עודכנו' : '✓ סטודנט/ית נוצר');
  }

  async function handleAutoSave(s: Student) {
    const idx = all.findIndex(x => x.id === s.id);
    if (idx < 0) return;
    const next = [...all];
    next[idx] = s;
    await persistAndRefresh(next, '✓ נשמר אוטומטית');
    // Do NOT close the editor
  }

  async function handleDelete(id: string) {
    setEditing(null);
    await persistAndRefresh(all.filter(s => s.id !== id), '✓ הסטודנט/ית נמחקו');
  }

  async function handleRevertToCandidate(s: Student) {
    const newCandidate: Candidate = {
      id: randomId('cand'),
      name: s.name,
      phone: s.phone || '',
      email: s.email || '',
      city: s.city || '',
      courseId: s.courseId || '',
      year: s.year || '',
      applicationDate: '',
      cvUrl: s.cvUrl || '',
      applicationUrl: '',
      submittedAt: undefined,
      interviewDate: '',
      interviewTime: '',
      interviewResult: 'pending',
      notes: `הוחזר ממצב סטודנט`,
    };
    const nextStudents = all.filter(x => x.id !== s.id);
    const nextCandidates = [...(data.candidates as Candidate[] || []), newCandidate];
    setSaving(true);
    const res = await saveSnapshot(
      { ...data, students: nextStudents, candidates: nextCandidates },
      { name: userName },
      { action: 'הוחזר למועמד', entity: 'סטודנט', target: s.name }
    );
    setSaving(false);
    if (res.ok) {
      (data.students as Student[]) = nextStudents;
      (data.candidates as Candidate[]) = nextCandidates;
      setEditing(null);
      onRefresh();
      showToast(`✓ ${s.name} הועבר/ה בחזרה לרשימת המועמדים`, 'success');
    } else {
      showToast('שגיאה: ' + (res.error || ''), 'error');
    }
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-10 pt-14 pb-28">
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
            <button onClick={() => setCreating(true)} style={{
              display: 'inline-block', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
              background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>+ חדש/ה →</button>
            <button onClick={() => setShowImport(s => !s)}
              className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
              style={{ color: 'var(--accent)' }}>
              📊 {showImport ? 'סגור' : 'Excel'}
            </button>
          </div>
        </div>
      </section>

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
                  <StudentRow key={s.id} s={s} onEdit={() => setEditing(s)}
                    pinned={pinnedId === s.id} onTogglePin={() => setPinnedId(pinnedId === s.id ? null : s.id)}
                    onRevert={() => handleRevertToCandidate(s)}
                    cvUpdate={s.email ? cvUpdates[(s.email || '').toLowerCase()] : undefined}
                    onCvUpdateSeen={async (updateId, filePath) => {
                      await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', updateId);
                      const idx = all.findIndex(x => x.id === s.id);
                      if (idx >= 0) {
                        const next = [...all];
                        next[idx] = { ...next[idx], cvUpdatedUrl: `storage://candidate-uploads/${filePath}` };
                        await persistAndRefresh(next, `✓ CV מעודכן נשמר עבור ${s.name}`);
                      }
                      setCvUpdates(prev => { const n = { ...prev }; delete n[(s.email || '').toLowerCase()]; return n; });
                    }} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <ul>
            {filtered.map(s => (
              <StudentRow key={s.id} s={s} onEdit={() => setEditing(s)}
                pinned={pinnedId === s.id} onTogglePin={() => setPinnedId(pinnedId === s.id ? null : s.id)}
                onRevert={() => handleRevertToCandidate(s)}
                cvUpdate={s.email ? cvUpdates[(s.email || '').toLowerCase()] : undefined}
                onCvUpdateSeen={async (updateId, filePath) => {
                  await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', updateId);
                  const idx = all.findIndex(x => x.id === s.id);
                  if (idx >= 0) {
                    const next = [...all];
                    next[idx] = { ...next[idx], cvUpdatedUrl: `storage://candidate-uploads/${filePath}` };
                    await persistAndRefresh(next, `✓ CV מעודכן נשמר עבור ${s.name}`);
                  }
                  setCvUpdates(prev => { const n = { ...prev }; delete n[(s.email || '').toLowerCase()]; return n; });
                }} />
            ))}
          </ul>
        )}
      </section>

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

function StudentRow({ s, onEdit, pinned, onTogglePin, onRevert, cvUpdate, onCvUpdateSeen }: {
  s: Student; onEdit: () => void; pinned: boolean; onTogglePin: () => void; onRevert?: () => void;
  cvUpdate?: { id: string; cv_file_path: string; uploaded_at: string };
  onCvUpdateSeen?: (id: string, filePath: string) => void;
}) {
  const placed = !!s.acceptedOrg;
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
    <li className="relative group" data-info-row>
      <div
        onClick={onTogglePin}
        className="py-4 border-b cursor-pointer hover:bg-[rgba(122,30,43,0.02)]"
        style={{ borderColor: 'var(--divider)' }}
      >
        {/* Line 1: dot · name · tags */}
        <div className="flex items-center gap-2 min-w-0 mb-1.5">
          <StatusDot status={dotStatus} size={9} />
          <div className="serif text-[20px] leading-tight tracking-tight flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>
            {s.name || 'ללא שם'}
          </div>
          <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
            {(!s.phone || !s.email) && <NeedsUpdate />}
            {s.cvUrl && !prepPassed && !placed && !hired && !completed && <Tag label="📄" muted />}
            {prepPassed && !placed && !hired && !completed && <Tag label="✓ הכנה" muted />}
            {s.cvUpdatedUrl ? <Tag label="CV ✓" color="#15803d" /> : prepPassed && <Tag label="CV נדרש" color="#b45309" />}
            {placed && !hired && !completed && <Tag label="שובץ/ה" />}
            {hired && !completed && <Tag label="נקלט/ה" solid />}
            {completed && <Tag label="✓ סיים" color="#b45309" />}
            {cvUpdate && (
              <button
                type="button"
                onClick={async e => {
                  e.stopPropagation();
                  const { data: urlData } = await supabase.storage.from('candidate-uploads').getPublicUrl(cvUpdate.cv_file_path);
                  window.open(urlData.publicUrl, '_blank');
                  onCvUpdateSeen?.(cvUpdate.id, cvUpdate.cv_file_path);
                }}
                title={`CV מעודכן הועלה — ${new Date(cvUpdate.uploaded_at).toLocaleDateString('he-IL')}`}
                className="mono text-[10px] uppercase tracking-[0.13em] font-semibold shrink-0 px-2.5 py-1 rounded-full whitespace-nowrap animate-pulse"
                style={{ color: '#fff', background: '#d97706', border: 'none' }}>
                CV ✦ חדש
              </button>
            )}
          </div>
        </div>
        {/* Line 2: contact info · actions */}
        <div className="flex items-center gap-2 pr-5" onClick={e => e.stopPropagation()}>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] flex-1 min-w-0" style={{ color: 'var(--text-soft)' }}>
            {s.phone && <span dir="ltr">{s.phone}</span>}
            {s.email && <span className="truncate max-w-[200px]">{s.email}</span>}
            {s.city && <span>· {s.city}</span>}
            {placed && <span style={{ color: 'var(--accent)' }}>· {s.acceptedOrg}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={e => { e.stopPropagation(); onRevert(); }}
              className="mono text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-1 rounded-full border opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ borderColor: 'var(--divider)', color: 'var(--text-soft)' }}
              title="החזר למועמד">
              ↩ מועמד
            </button>
            <RowActions phone={s.phone} email={s.email} name={s.name} onEdit={onEdit} />
          </div>
        </div>
      </div>

      {/* Hover + pinned details popover */}
      <Popover pinned={pinned}>
        <div className="flex items-baseline justify-between gap-3 pb-3 mb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
          <div>
            <div className="serif text-[22px] leading-[1.15]" style={{ color: 'var(--ink)' }}>{s.name}</div>
            <div className="mono text-[10.5px] uppercase tracking-[0.14em] mt-1" style={{ color: 'var(--accent)' }}>
              שלב: {stage}
            </div>
          </div>
          {pinned && (
            <button type="button" onClick={onTogglePin}
              className="mono text-[10px] uppercase tracking-[0.14em] font-semibold hover:opacity-60"
              style={{ color: 'var(--text-soft)' }}>
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
          <DetailRow label="CV מעודכן" value={s.cvUpdatedUrl ? '✓ הוגש' : prepPassed ? '⚠ נדרש' : undefined} accent={!!s.cvUpdatedUrl} />
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
export function Popover({ pinned, children }: { pinned: boolean; children: any }) {
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

  return (
    <div
      ref={ref}
      className={`absolute z-40 right-0 rounded-xl shadow-xl border p-5 transition-opacity ${flipUp ? 'bottom-full mb-1' : 'top-full mt-1'} ${pinned ? 'opacity-100 visible' : 'invisible opacity-0 group-hover:visible group-hover:opacity-100'}`}
      style={{
        background: 'var(--bg)',
        borderColor: 'var(--divider)',
        boxShadow: '0 16px 48px rgba(26, 22, 18, 0.2)',
        minWidth: 360, maxWidth: 440,
      }}
      onClick={e => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function DetailRow({ label, value, accent }: { label: string; value?: string | number | null; accent?: boolean }) {
  if (value == null || value === '' || value === 0) return null;
  return (
    <div className="flex items-baseline gap-3">
      <span className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold w-20 shrink-0" style={{ color: 'var(--text-soft)' }}>
        {label}
      </span>
      <span style={{ color: accent ? 'var(--accent)' : 'var(--ink)' }}>{String(value)}</span>
    </div>
  );
}

export function RowActions({
  phone, email, name, onEdit, calendarUrl,
}: { phone?: string; email?: string; name?: string; onEdit: () => void; calendarUrl?: string }) {
  function call() {
    if (!phone) return;
    window.location.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
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
    window.location.href = `mailto:${email}?subject=${subject}`;
  }
  function cal() {
    if (calendarUrl) window.open(calendarUrl, '_blank');
  }
  const btn = "w-7 h-7 rounded-full border grid place-items-center transition-colors hover:bg-[rgba(122,30,43,0.08)]";
  const style = { borderColor: 'var(--divider)', color: 'var(--ink)' };
  return (
    <div className="flex items-center gap-1.5">
      {calendarUrl !== undefined && calendarUrl && (
        <button type="button" onClick={cal} title="הוסף ליומן Outlook" className={btn} style={style}>📅</button>
      )}
      {phone && <button type="button" onClick={call} title="התקשר" className={btn} style={style}>📞</button>}
      {phone && <button type="button" onClick={wa} title="WhatsApp" className={btn} style={style}>💬</button>}
      {email && <button type="button" onClick={mail} title="מייל" className={btn} style={style}>✉</button>}
      <button type="button" onClick={onEdit} title="ערוך"
        className={btn} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
