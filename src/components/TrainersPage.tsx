import { useMemo, useState } from 'react';
import { btnPrimary, btnSecondary } from '../lib/design';
import type { Trainer } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear, groupByYearCourse } from './pageShared';
import { saveSnapshot } from '../lib/dataApi';
import { showToast } from '../lib/toast';
import { RowActions, Popover, NeedsUpdate, RefreshButton, GroupHeader } from './StudentsPage';
import TrainerEditor from './TrainerEditor';
import ExcelImport from './ExcelImport';

export default function TrainersPage({ data, context, userName, onRefresh }: PageProps) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Trainer | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const all = data.trainers || [];
  const courses = data.courses || [];

  const years = useMemo(() => {
    const set = new Set<string>();
    courses.forEach(c => c.year && set.add(normalizeYear(c.year)));
    all.forEach(t => t.year && set.add(normalizeYear(t.year)));
    (data.academicYears || []).forEach(y => set.add(normalizeYear(y)));
    return Array.from(set).sort().reverse();
  }, [courses, all, data.academicYears]);

  const scoped = useMemo(() => all.filter(t => sameContext(t, context, courses)), [all, context, courses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter(t => {
      if (!q) return true;
      const hay = [t.name, t.organization, t.role, t.specialty, t.email, t.phone]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  }, [scoped, search]);

  async function persistAndRefresh(next: Trainer[], msg: string) {
    setSaving(true); setSaveMsg(null);
    const res = await saveSnapshot({ ...data, trainers: next }, { name: userName });
    setSaving(false);
    if (!res.ok) {
      setSaveMsg('שגיאה: ' + (res.error || ''));
      showToast('שגיאה בשמירה: ' + (res.error || ''), 'error');
      return;
    }
    setSaveMsg(msg);
    showToast(msg + ' · נשמר בענן ☁️', 'success');
    (data.trainers as Trainer[]) = next;
    onRefresh();
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function handleSave(t: Trainer) {
    const idx = all.findIndex(x => x.id === t.id);
    const next = idx >= 0 ? [...all] : [...all, t];
    if (idx >= 0) next[idx] = t;
    setEditing(null); setCreating(false);
    await persistAndRefresh(next, idx >= 0 ? '✓ עודכן' : '✓ נוסף');
  }

  async function handleDelete(id: string) {
    setEditing(null);
    await persistAndRefresh(all.filter(t => t.id !== id), '✓ נמחק');
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-10 pt-14 pb-28">

      {/* Hero */}
      <section className="pt-4 pb-14 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">V · מנחים/מרצים</div>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 md:gap-10">
          <div>
            <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
              מנחים/מרצים
            </h1>
            <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
              {scoped.length === 0
                ? 'אין מנחים/מרצים בהקשר הנוכחי. הוסף מנחה ראשון/ה.'
                : `${scoped.length} מנחים ומרצים`}
            </p>
            <div className="mt-5 p-4 rounded-xl text-[13.5px] leading-[1.7] max-w-[620px]"
              style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid var(--divider)', color: 'var(--ink)' }}>
              <span className="mono text-[10px] uppercase tracking-[0.14em] font-semibold block mb-2" style={{ color: 'var(--accent)' }}>מה מנחה/מרצה בהקשר הפרקטיקום?</span>
              הדף כולל <strong>שני סוגים</strong> של אנשי מקצוע:
              <ul className="mt-2 space-y-1 list-none">
                <li>🎤 <strong>מרצים/מנחי סדנאות</strong> — אנשי מקצוע חיצוניים שמרצים לסטודנטים במסגרת קורס הפרקטיקום (למשל: מרצה בנושא גיוס, מנחת LinkedIn, מרכז סימולציות).</li>
                <li>🏢 <strong>מנחים ארגוניים</strong> — איש קשר בארגון המאכסן שמלווה את הסטודנט/ית בשטח לאורך הפרקטיקום (mentor במקום העבודה).</li>
              </ul>
              <span className="block mt-2 text-[12px]" style={{ color: 'var(--text-soft)' }}>
                ניתן להבדיל בין השניים בשדה "תפקיד" (מרצה / מנחה ארגוני) ו"ארגון".
              </span>
            </div>
          </div>
          <div className="flex gap-2 self-start md:self-auto flex-wrap">
            <button onClick={() => setCreating(true)} style={btnPrimary()}>+ מנחה חדש/ה →</button>
            <button onClick={() => setShowImport(i => !i)} style={btnSecondary()}>⬆ ייבוא Excel</button>
          </div>
        </div>
      </section>

      {/* Status bar */}
      <div className="mono text-[12px] uppercase tracking-[0.16em] flex items-center gap-4 flex-wrap mb-10"
        style={{ color: 'var(--text-soft)' }}>
        <RefreshButton onRefresh={onRefresh} />
        {saveMsg && <span style={{ color: 'var(--accent)' }}>· {saveMsg}</span>}
        {saving && <span className="opacity-75">· שומר...</span>}
      </div>

      {/* Excel import panel */}
      {showImport && (
        <section className="mb-8">
          <ExcelImport kind="trainers" data={data} userName={userName} onDone={() => { setShowImport(false); onRefresh(); }} />
        </section>
      )}

      {/* Search */}
      <section className="mb-10">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="חפש לפי שם, ארגון, תפקיד, מייל..."
          className="input w-full"
          style={{ padding: '10px 16px', fontSize: '14px' }}
        />
      </section>

      {/* List */}
      <section>
        {filtered.length === 0 ? (
          <div className="py-24 text-center">
            <div className="serif text-[26px]" style={{ color: 'var(--ink)' }}>אין מנחים/מרצים להצגה</div>
            <div className="mt-3 text-[14px]" style={{ color: 'var(--text-soft)' }}>
              נסה להסיר סינון או הוסף מנחה/מרצה חדש/ה.
            </div>
          </div>
        ) : context.courseId === '__all__' ? (
          groupByYearCourse(filtered, courses, context).map(group => (
            <div key={`${group.year}||${group.courseId}`}>
              <GroupHeader year={group.year} courseName={group.courseName} count={group.items.length} showYear={group.showYear} />
              <ul>
                {group.items.map(t => (
                  <TrainerRow key={t.id} trainer={t} onEdit={() => setEditing(t)}
                    pinned={pinnedId === t.id} onTogglePin={() => setPinnedId(pinnedId === t.id ? null : t.id)} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <ul>
            {filtered.map(t => (
              <TrainerRow key={t.id} trainer={t} onEdit={() => setEditing(t)}
                pinned={pinnedId === t.id} onTogglePin={() => setPinnedId(pinnedId === t.id ? null : t.id)} />
            ))}
          </ul>
        )}
      </section>

      {(editing || creating) && (
        <TrainerEditor
          trainer={editing}
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

function TrainerRow({ trainer: t, onEdit, pinned, onTogglePin }: {
  trainer: Trainer;
  onEdit: () => void;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  return (
    <li className="relative group" data-info-row>
      <div
        onClick={onTogglePin}
        className="py-4 border-b cursor-pointer hover:bg-[rgba(122,30,43,0.02)]"
        style={{ borderColor: 'var(--divider)' }}
      >
        {/* Line 1: name + specialty badge */}
        <div className="flex items-center gap-2 min-w-0 mb-1.5">
          <div className="serif text-[20px] leading-tight tracking-tight flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>
            {t.name}
          </div>
          {t.specialty && (
            <span className="mono text-[10px] uppercase tracking-[0.13em] font-semibold px-2.5 py-1 rounded-full shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)' }}>
              {t.specialty}
            </span>
          )}
        </div>
        {/* Line 2: contact + actions */}
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <div className="text-[12.5px] flex flex-wrap gap-x-3 gap-y-0.5 flex-1 min-w-0" style={{ color: 'var(--text-soft)' }}>
            {t.organization && <span className="truncate" style={{ maxWidth: 'clamp(100px, 35vw, 160px)' }}>{t.organization}</span>}
            {t.role && <span>· {t.role}</span>}
            {t.phone && <span dir="ltr">{t.phone}</span>}
            {t.email && <span className="truncate" style={{ maxWidth: 'clamp(120px, 40vw, 200px)' }}>{t.email}</span>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {(!t.phone || !t.email) && <NeedsUpdate />}
            <RowActions phone={t.phone} email={t.email} name={t.name} onEdit={onEdit} />
          </div>
        </div>
      </div>

      {/* Popover on click */}
      <Popover pinned={pinned}>
        <div className="flex items-baseline justify-between gap-3 pb-3 mb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
          <div>
            <div className="serif text-[22px] leading-[1.15]" style={{ color: 'var(--ink)' }}>{t.name}</div>
            {t.organization && (
              <div className="mono text-[10.5px] uppercase tracking-[0.14em] mt-1" style={{ color: 'var(--text-soft)' }}>
                {t.organization}
              </div>
            )}
          </div>
          {pinned && (
            <button onClick={onTogglePin}
              className="mono text-[10px] uppercase tracking-[0.14em] font-semibold opacity-60 hover:opacity-100">
              ✕
            </button>
          )}
        </div>
        <div className="space-y-1.5 text-[13px]">
          <DetailRow label="תפקיד" value={t.role} />
          <DetailRow label="התמחות" value={t.specialty} />
          <DetailRow label="טלפון" value={t.phone} />
          <DetailRow label="מייל" value={t.email} />
          <DetailRow label="הערות" value={t.notes} />
        </div>
        {/* Quick-contact buttons inside popover */}
        <div className="flex gap-2 mt-4 pt-3 border-t" style={{ borderColor: 'var(--divider)' }}>
          {t.phone && (
            <>
              <a href={`tel:${t.phone.replace(/[^\d+]/g, '')}`}
                className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold px-3 py-1.5 rounded-full border hover:bg-[rgba(122,30,43,0.06)]"
                style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>
                📞 חייג
              </a>
              <a href={`https://wa.me/${t.phone.replace(/[^\d]/g, '').replace(/^0/, '972')}`}
                target="_blank" rel="noreferrer"
                className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold px-3 py-1.5 rounded-full border hover:bg-[rgba(122,30,43,0.06)]"
                style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>
                💬 WhatsApp
              </a>
            </>
          )}
          {t.email && (
            <a href={`mailto:${encodeURIComponent(t.email)}?subject=${encodeURIComponent('פרקטיקום — ' + t.name)}`}
              className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold px-3 py-1.5 rounded-full border hover:bg-[rgba(122,30,43,0.06)]"
              style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>
              ✉ מייל
            </a>
          )}
        </div>
      </Popover>
    </li>
  );
}

function DetailRow({ label, value, accent }: { label: string; value?: string | null; accent?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-3">
      <span className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold w-20 shrink-0"
        style={{ color: 'var(--text-soft)' }}>
        {label}
      </span>
      <span style={{ color: accent ? 'var(--accent)' : 'var(--ink)' }}>{value}</span>
    </div>
  );
}
