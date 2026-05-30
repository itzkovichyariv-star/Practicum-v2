import { useEffect, useMemo, useRef, useState } from 'react';
import { btnPrimary, btnSecondary, btnSmall } from '../lib/design';
import type { Student, Candidate, PracticumData } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear, groupByYearCourse } from './pageShared';
import { saveSnapshot, randomId } from '../lib/dataApi';
import { showToast } from '../lib/toast';
import StudentEditor from './StudentEditor';
import PlacementPanel from './PlacementPanel';
import ExcelImport from './ExcelImport';
// email sending is via Outlook (mailto:) — no direct API imports needed
import { openMailto } from '../lib/openMailto';

type Filters = {
  search: string;
  stage: 'all' | 'prep' | 'placed' | 'hired' | 'completed' | 'notplaced';
  dotFilter: 'all' | 'green' | 'amber' | 'gray';
};

const emptyFilters: Filters = { search: '', stage: 'all', dotFilter: 'all' };

// In-app alert: candidate-suggested organizations awaiting the coordinator's approval.
function PendingSuggestionsBanner() {
  const [pending, setPending] = useState<Array<{ id: string; name: string | null; email: string; org: string }>>([]);
  useEffect(() => {
    let alive = true;
    supabase.from('cv_updates')
      .select('id, name, email, suggested_org')
      .is('seen_at', null)
      .not('suggested_org', 'is', null)
      .order('uploaded_at', { ascending: false })
      .then(({ data }) => {
        if (!alive || !data) return;
        setPending(data
          .filter((r: any) => r.suggested_org?.name)
          .map((r: any) => ({ id: r.id, name: r.name, email: r.email, org: r.suggested_org.name })));
      });
    return () => { alive = false; };
  }, []);
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
  const [selectMode, setSelectMode] = useState(false);
  const [showMailModal, setShowMailModal] = useState(false);
  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');

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
    setSelectedIds(new Set()); setSelectMode(false);
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
    setSaving(true);
    const res = await saveSnapshot(
      { ...data, students: nextStudents, candidates: nextCandidates },
      { name: userName },
      { action: 'נמחק לחלוטין', entity: 'סטודנט', target: student.name }
    );
    setSaving(false);
    if (res.ok) {
      (data.students as Student[]) = nextStudents;
      (data.candidates as Candidate[]) = nextCandidates;
      onRefresh();
      showToast(`✓ ${student.name} נמחק/ה לחלוטין (כולל מועמדות)`, 'success');
    } else {
      showToast('שגיאה: ' + (res.error || ''), 'error');
    }
  }

  async function confirmKeepAsCandidate(student: Student) {
    setDeleteDialog(null);
    await persistAndRefresh(all.filter(s => s.id !== student.id), `✓ ${student.name} הוסר/ה כסטודנט, נשמר/ה כמועמד`);
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
      <PendingSuggestionsBanner />
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
            <div className="flex gap-2 flex-wrap justify-end">
              <button
                onClick={() => { setSelectMode(s => !s); if (selectMode) setSelectedIds(new Set()); }}
                className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
                style={{ color: selectMode ? 'var(--accent)' : 'var(--text-soft)' }}>
                {selectMode ? '✕ בטל מצב בחירה' : '☑ בחר מספר'}
              </button>
              {selectMode && (
                <button
                  onClick={() => {
                    const allSelected = filtered.every(s => selectedIds.has(s.id));
                    setSelectedIds(allSelected ? new Set() : new Set(filtered.map(s => s.id)));
                  }}
                  className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
                  style={{ color: filtered.every(s => selectedIds.has(s.id)) && filtered.length > 0 ? 'var(--accent)' : 'var(--text-soft)' }}>
                  {filtered.every(s => selectedIds.has(s.id)) && filtered.length > 0 ? '✕ בטל הכל' : '☑ בחר הכל'}
                </button>
              )}
              <button onClick={() => setShowImport(s => !s)}
                className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
                style={{ color: 'var(--accent)' }}>
                📊 {showImport ? 'סגור' : 'Excel'}
              </button>
            </div>
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
                    selectMode={selectMode}
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
              <StudentRow key={s.id} s={s} onEdit={() => setEditing(s)}
                pinned={pinnedId === s.id} onTogglePin={() => setPinnedId(pinnedId === s.id ? null : s.id)}
                onRevert={() => handleRevertToCandidate(s)}
                selectMode={selectMode}
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

      {/* Floating bulk-email action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl"
          style={{
            transform: 'translateX(-50%)',
            background: 'var(--ink)',
            color: 'white',
            minWidth: 360,
          }}
        >
          <span className="mono text-[12px] uppercase tracking-[0.14em] font-semibold opacity-70 shrink-0">
            {selectedIds.size} נבחרו
          </span>
          <span style={{ opacity: 0.3 }}>·</span>
          <button
            style={{ ...btnSmall(), background: 'white', color: 'var(--ink)', border: 'none', fontSize: '11.5px' }}
            onClick={() => {
              const people = Array.from(selectedIds).map(id => all.find(s => s.id === id)).filter(Boolean) as Student[];
              openEmailConfirm('acceptance', people.filter(s => s.email).map(s => ({ id: s.id, name: s.name, email: s.email! })));
            }}
          >✓ הודעת קבלה</button>
          <button
            style={{ ...btnSmall(), background: 'transparent', color: 'rgba(255,255,255,0.8)', borderColor: 'rgba(255,255,255,0.35)', fontSize: '11.5px' }}
            onClick={() => {
              const people = Array.from(selectedIds).map(id => all.find(s => s.id === id)).filter(Boolean) as Student[];
              openEmailConfirm('rejection', people.filter(s => s.email).map(s => ({ id: s.id, name: s.name, email: s.email! })));
            }}
          >✗ הודעת דחייה</button>
          <button
            style={{ ...btnSmall(), background: 'transparent', color: 'rgba(255,255,255,0.85)', borderColor: 'rgba(255,255,255,0.35)', fontSize: '11.5px' }}
            onClick={() => setShowMailModal(true)}
          >📧 מייל Outlook</button>
          <button
            onClick={() => { setSelectedIds(new Set()); setSelectMode(false); }}
            className="mono text-[10.5px] uppercase tracking-[0.14em] opacity-50 hover:opacity-100"
            style={{ color: 'white' }}>
            ✕
          </button>
        </div>
      )}

      {/* Outlook group email modal */}
      {showMailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(26,22,18,0.55)' }}>
          <div className="rounded-2xl border p-8 max-w-[520px] w-full mx-4" style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 20px 60px rgba(26,22,18,0.3)' }}>
            <div className="flex items-baseline justify-between mb-5">
              <div className="serif text-[22px]" style={{ color: 'var(--ink)' }}>מייל קבוצתי ב‑Outlook</div>
              <button onClick={() => setShowMailModal(false)} className="mono text-[11px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100" style={{ color: 'var(--ink)' }}>✕</button>
            </div>
            {/* Selected names */}
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-4 p-3 rounded-lg" style={{ background: 'rgba(122,30,43,0.06)', color: 'var(--ink)' }}>
              {Array.from(selectedIds).map(id => all.find(s => s.id === id)?.name).filter(Boolean).join(' · ')}
            </div>
            {/* Warn about missing emails */}
            {(() => {
              const noEmail = Array.from(selectedIds).map(id => all.find(s => s.id === id)).filter(s => s && !s.email).map(s => s!.name);
              return noEmail.length > 0 ? (
                <div className="mb-4 p-3 rounded-lg text-[12.5px]" style={{ background: 'rgba(180,60,60,0.08)', color: '#b03030', border: '1px solid rgba(180,60,60,0.2)' }}>
                  ⚠ ללא מייל (לא ייכלל/ו): {noEmail.join(', ')}
                </div>
              ) : null;
            })()}
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
                onClick={() => {
                  const people = Array.from(selectedIds).map(id => all.find(s => s.id === id)).filter(Boolean) as Student[];
                  const emails = people.map(s => s.email).filter(Boolean) as string[];
                  if (emails.length === 0) { showToast('לאף אחד מהנבחרים אין מייל רשום', 'error'); return; }
                  const bcc = emails.join(',');
                  openMailto(`mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`);
                  showToast(`✓ נפתח Outlook ל‑${emails.length} נמענים`, 'success');
                  setShowMailModal(false);
                  setMailSubject(''); setMailBody('');
                  setSelectedIds(new Set()); setSelectMode(false);
                }}
                style={btnPrimary()}
              >📧 פתח ב‑Outlook →</button>
            </div>
          </div>
        </div>
      )}

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
          onApproveSuggestion={async (emp) => {
            const updatedEmps = [...employers, emp];
            setSaving(true);
            const res = await saveSnapshot(
              { ...data, employers: updatedEmps },
              { name: userName },
              { action: 'אישר הצעת ארגון', entity: 'ארגון', target: emp.name }
            );
            setSaving(false);
            if (res.ok) {
              (data.employers as any) = updatedEmps;
              showToast('✓ הצעת הארגון אושרה — נוסף כארגון פרטי', 'success');
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

function StudentRow({ s, onEdit, pinned, onTogglePin, onRevert, selectMode, selected, onToggleSelect }: {
  s: Student; onEdit: () => void; pinned: boolean; onTogglePin: () => void; onRevert?: () => void;
  selectMode?: boolean; selected?: boolean; onToggleSelect?: () => void;
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
        onClick={selectMode ? onToggleSelect : onTogglePin}
        className="py-4 border-b cursor-pointer hover:bg-[rgba(122,30,43,0.02)]"
        style={{ borderColor: 'var(--divider)', background: selected ? 'rgba(122,30,43,0.04)' : undefined }}
      >
        {/* Line 1: checkbox (selectMode) · dot · name · tags */}
        <div className="flex items-center gap-2 min-w-0 mb-1.5">
          {selectMode && (
            <span
              onClick={e => { e.stopPropagation(); onToggleSelect?.(); }}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                border: `2px solid ${selected ? 'var(--accent)' : 'var(--divider)'}`,
                background: selected ? 'var(--accent)' : 'transparent',
                color: 'white', fontSize: 11, cursor: 'pointer',
              }}
            >{selected ? '✓' : ''}</span>
          )}
          <StatusDot status={dotStatus} size={9} />
          <div className="serif text-[20px] leading-tight tracking-tight flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>
            {s.name || 'ללא שם'}
          </div>
          <div className="flex items-center gap-1 flex-wrap justify-end" style={{ maxWidth: '55%', flexShrink: 0 }}>
            {(!s.phone || !s.email) && <NeedsUpdate />}
            {s.cvUrl && !prepPassed && !placed && !hired && !completed && <Tag label="📄" muted />}
            {prepPassed && !placed && !hired && !completed && <Tag label="✓ הכנה" muted />}
            {s.cvUpdatedUrl ? <Tag label="CV ✓" /> : prepPassed && <Tag label="CV נדרש" color="#b45309" />}
            {placed && !hired && !completed && <Tag label="שובץ/ה" />}
            {hired && !completed && <Tag label="נקלט/ה" solid />}
            {completed && <Tag label="✓ סיים" color="#b45309" />}
            {s.acceptanceEmailSent && <Tag label="✉ קבלה" muted />}
            {s.rejectionEmailSent && <Tag label="✉ דחייה" muted />}
          </div>
        </div>
        {/* Line 2: contact info · actions */}
        <div className="flex items-center gap-2 pr-5" onClick={e => e.stopPropagation()}>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] flex-1 min-w-0" style={{ color: 'var(--text-soft)' }}>
            {s.phone && <span dir="ltr">{s.phone}</span>}
            {s.email && <span className="truncate" style={{ maxWidth: 'min(200px, 50vw)' }}>{s.email}</span>}
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
      className={`absolute z-40 right-0 rounded-xl shadow-xl border p-5 transition-opacity ${flipUp ? 'bottom-full mb-1' : 'top-full mt-1'} ${pinned ? 'opacity-100 visible' : 'invisible opacity-0 pointer-events-none'}`}
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
    openMailto(`mailto:${email}?subject=${subject}`);
  }
  function cal() {
    if (onCalendar) { onCalendar(); return; }
    if (calendarUrl) window.open(calendarUrl, '_blank');
  }
  const btn = "w-7 h-7 rounded-full border grid place-items-center transition-colors hover:bg-[rgba(122,30,43,0.08)]";
  const style = { borderColor: 'var(--divider)', color: 'var(--ink)' };
  return (
    <div className="flex items-center gap-1.5">
      {calendarUrl !== undefined && calendarUrl && (
        <button type="button" onClick={cal} title="פתח ב-Outlook" className={btn} style={style}>📅</button>
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
