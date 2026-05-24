import { useMemo, useState } from 'react';
import type { Candidate } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear, outlookCalendarUrl } from './pageShared';
import { saveSnapshot, randomId } from '../lib/dataApi';
import { showToast } from '../lib/toast';
import type { Student } from '../lib/supabase';
import CandidateEditor from './CandidateEditor';
import { RowActions, Popover, RefreshButton, StatusDot, type DotStatus } from './StudentsPage';
import SubmissionsInbox from './SubmissionsInbox';
import ExcelImport from './ExcelImport';

export default function CandidatesPage({ data, context, userName, onRefresh }: PageProps) {
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<'all' | 'pending' | 'passed' | 'failed'>('all');
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMsgModal, setShowMsgModal] = useState(false);
  const [msgSubject, setMsgSubject] = useState('');
  const [msgBody, setMsgBody] = useState('');

  const all = data.candidates || [];
  const courses = data.courses || [];

  const years = useMemo(() => {
    const set = new Set<string>();
    courses.forEach(c => c.year && set.add(normalizeYear(c.year)));
    all.forEach(c => c.year && set.add(normalizeYear(c.year)));
    (data.academicYears || []).forEach(y => set.add(normalizeYear(y)));
    return Array.from(set).sort().reverse();
  }, [courses, all, data.academicYears]);

  const scoped = useMemo(() => all.filter(c => sameContext(c, context, courses)), [all, context, courses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter(c => {
      if (stage !== 'all' && (c.interviewResult || 'pending') !== stage) return false;
      if (!q) return true;
      const hay = [c.name, c.phone, c.email].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  }, [scoped, search, stage]);

  const counts = useMemo(() => ({
    total: scoped.length,
    pending: scoped.filter(c => !c.interviewResult || c.interviewResult === 'pending').length,
    passed: scoped.filter(c => c.interviewResult === 'passed').length,
    failed: scoped.filter(c => c.interviewResult === 'failed').length,
  }), [scoped]);

  async function persistAndRefresh(next: Candidate[], msg: string) {
    setSaving(true); setSaveMsg(null);
    const res = await saveSnapshot({ ...data, candidates: next }, { name: userName });
    setSaving(false);
    if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
    setSaveMsg(msg);
    showToast(msg + ' · נשמר בענן ☁️', 'success');
    (data.candidates as Candidate[]) = next;
    onRefresh();
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function handleSave(c: Candidate) {
    // Auto-convert to student if interview passed and not yet converted
    const shouldAutoConvert = c.interviewResult === 'passed' && !c.convertedToStudentId;

    // REVERSE: if candidate was previously converted but result is now NOT 'passed',
    // remove the linked student record.
    const previous = all.find(x => x.id === c.id);
    const shouldReverse =
      previous?.convertedToStudentId &&
      c.interviewResult !== 'passed';

    if (shouldReverse) {
      if (!confirm(
        `המועמד/ת סומן/ה בעבר כ"עבר" והועבר/ה לסטודנטים.\n\n` +
        `שינוי התוצאה כעת ל‑"${c.interviewResult === 'failed' ? 'לא התקבל' : 'ממתין'}" יסיר את רשומת הסטודנט/ית המקושרת.\n\n` +
        `להמשיך?`
      )) return;

      const nextStudents = (data.students || []).filter(s => s.id !== previous!.convertedToStudentId);
      const clearedCandidate: Candidate = { ...c, convertedToStudentId: undefined };
      const idx = all.findIndex(x => x.id === c.id);
      const nextCandidates = [...all];
      nextCandidates[idx] = clearedCandidate;

      setSaving(true); setSaveMsg(null);
      const res = await saveSnapshot(
        { ...data, students: nextStudents, candidates: nextCandidates },
        { name: userName },
        { action: 'שינוי סטטוס → הוסר מסטודנטים', entity: 'מועמד', target: c.name }
      );
      setSaving(false);
      setEditing(null); setCreating(false);
      if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); return; }
      (data.students as any) = nextStudents;
      (data.candidates as Candidate[]) = nextCandidates;
      onRefresh();
      setSaveMsg('✓ הוסר מרשימת הסטודנטים');
      setTimeout(() => setSaveMsg(null), 3500);
      return;
    }

    if (shouldAutoConvert) {
      const conversionNotes = [
        c.evalScore != null ? `ציון ראיון: ${c.evalScore}` : '',
        c.preferredArea ? `תחום מבוקש: ${c.preferredArea}` : '',
        c.interviewSummary ? `סיכום ראיון: ${c.interviewSummary}` : '',
      ].filter(Boolean).join('\n');
      const newStudent: Student = {
        id: randomId('s'),
        name: c.name,
        phone: c.phone || '',
        email: c.email || '',
        courseId: c.courseId,
        year: c.year,
        cvUrl: c.cvUrl || '',
        formUrl: c.applicationUrl || '',
        preparation: { passed: false },
        fromCandidate: true,
        fromCandidateId: c.id,
        notes: conversionNotes || undefined,
      };
      const updatedCand: Candidate = { ...c, convertedToStudentId: newStudent.id };
      const idx = all.findIndex(x => x.id === c.id);
      const nextCandidates = idx >= 0 ? [...all] : [...all, updatedCand];
      if (idx >= 0) nextCandidates[idx] = updatedCand;
      const nextStudents = [...(data.students || []), newStudent];

      setSaving(true); setSaveMsg(null);
      const res = await saveSnapshot(
        { ...data, students: nextStudents, candidates: nextCandidates },
        { name: userName },
        { action: 'עבר ראיון → הועבר לסטודנטים', entity: 'מועמד', target: c.name }
      );
      setSaving(false);
      setEditing(null); setCreating(false);
      if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); return; }
      (data.students as Student[]) = nextStudents;
      (data.candidates as Candidate[]) = nextCandidates;
      onRefresh();
      setSaveMsg('✓ עבר ראיון והועבר לסטודנטים');
      setTimeout(() => setSaveMsg(null), 3500);
      return;
    }

    const idx = all.findIndex(x => x.id === c.id);
    const next = idx >= 0 ? [...all] : [...all, c];
    if (idx >= 0) next[idx] = c;
    setEditing(null); setCreating(false);
    await persistAndRefresh(next, idx >= 0 ? '✓ עודכן' : '✓ נוסף');
  }

  async function handleDelete(id: string) {
    setEditing(null);
    await persistAndRefresh(all.filter(c => c.id !== id), '✓ נמחק');
  }

  async function handleAcceptSubmissionIntoCandidates(sub: any) {
    // Find course by name+year; fall back to name-only if year doesn't match
    const subYear = sub.year || '';
    const nameMatch = (c: typeof courses[0]) =>
      (c.name || '').replace(/\s+/g, '').toLowerCase() === (sub.course_name || '').replace(/\s+/g, '').toLowerCase();
    const course =
      courses.find(c => nameMatch(c) && c.year === subYear) ||
      courses.find(c => nameMatch(c));
    // Parse booked slot out of notes (format: "בחר מועד ראיון: YYYY-MM-DD HH:MM–HH:MM")
    const slotMatch = (sub.notes || '').match(/בחר מועד ראיון:\s*(\d{4}-\d{2}-\d{2})\s*(\d{1,2}:\d{2}(?:[–\-]\d{1,2}:\d{2})?)/);
    const interviewDate = slotMatch?.[1] || '';
    const interviewTime = slotMatch?.[2] || '';

    // ── Dedup logic ──────────────────────────────────────────────────────────
    function normN(n: string) { return (n || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
    const byEmail = sub.email
      ? all.find(c => c.email && c.email.toLowerCase() === sub.email!.toLowerCase())
      : undefined;
    const byExactName = !byEmail
      ? all.find(c => normN(c.name) === normN(sub.name))
      : undefined;
    const subLastToken = normN(sub.name).split(' ').pop() || '';
    const bySimilarName = !byEmail && !byExactName && subLastToken.length > 2
      ? all.find(c => {
          const t = normN(c.name).split(' ').pop() || '';
          return t === subLastToken && normN(c.name) !== normN(sub.name);
        })
      : undefined;

    let existingRecord: Candidate | undefined = byEmail || byExactName;
    if (!existingRecord && bySimilarName) {
      const merge = window.confirm(
        `נמצא מועמד דומה: ${bySimilarName.name}\nהמועמד שהגיש: ${sub.name}\n\nלאחד עם הרשומה הקיימת? לחץ אישור לאיחוד, ביטול ליצירת רשומה חדשה.`
      );
      if (merge) existingRecord = bySimilarName;
    }

    if (existingRecord) {
      // Update existing record
      const updated: Candidate = {
        ...existingRecord,
        cvUrl: sub.cv_file_path ? `storage://candidate-uploads/${sub.cv_file_path}` : existingRecord.cvUrl,
        applicationUrl: sub.application_file_path ? `storage://candidate-uploads/${sub.application_file_path}` : existingRecord.applicationUrl,
        interviewDate: interviewDate || existingRecord.interviewDate,
        interviewTime: interviewTime || existingRecord.interviewTime,
        submittedAt: sub.submitted_at,
        applicationDate: existingRecord.applicationDate || sub.submitted_at?.slice(0, 10) || '',
      };
      const nextCandidates = all.map(c => c.id === existingRecord!.id ? updated : c);
      setSaving(true);
      const res = await saveSnapshot(
        { ...data, candidates: nextCandidates },
        { name: userName },
        { action: 'עודכן מטופס הרשמה', entity: 'מועמד', target: sub.name }
      );
      setSaving(false);
      if (res.ok) { (data.candidates as Candidate[]) = nextCandidates; onRefresh(); }
      showToast(`✓ עודכן מועמד קיים: ${existingRecord.name}`, 'success');
    } else {
      // Create new candidate
      const newCandidate: Candidate = {
        id: randomId('cand'),
        name: sub.name,
        phone: sub.phone || '',
        email: sub.email || '',
        city: sub.city || '',
        courseId: course?.id || (courses[0]?.id || ''),
        year: sub.year || normalizeYear('תשפ״ז'),
        applicationDate: sub.submitted_at?.slice(0, 10) || '',
        cvUrl: sub.cv_file_path ? `storage://candidate-uploads/${sub.cv_file_path}` : '',
        applicationUrl: sub.application_file_path ? `storage://candidate-uploads/${sub.application_file_path}` : '',
        submittedAt: sub.submitted_at,
        interviewDate,
        interviewTime,
        interviewResult: 'pending',
        notes: sub.notes || '',
      };
      const nextCandidates = [...all, newCandidate];
      setSaving(true);
      const res = await saveSnapshot(
        { ...data, candidates: nextCandidates },
        { name: userName },
        { action: 'נקלט מטופס הרשמה', entity: 'מועמד', target: sub.name }
      );
      setSaving(false);
      if (res.ok) { (data.candidates as Candidate[]) = nextCandidates; onRefresh(); }
    }
  }

  async function handleConvertToStudent(c: Candidate) {
    if (!confirm(`להעביר את ${c.name} לרשימת הסטודנטים? הפרטים והמסמכים יועתקו, והמועמד יסומן כמועבר.`)) return;
    const conversionNotes = [
      c.evalScore != null ? `ציון ראיון: ${c.evalScore}` : '',
      c.preferredArea ? `תחום מבוקש: ${c.preferredArea}` : '',
      c.interviewSummary ? `סיכום ראיון: ${c.interviewSummary}` : '',
    ].filter(Boolean).join('\n');
    const newStudent: Student = {
      id: randomId('s'),
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      courseId: c.courseId,
      year: c.year,
      cvUrl: c.cvUrl || '',
      formUrl: c.applicationUrl || '',
      preparation: { passed: false },
      fromCandidate: true,
      fromCandidateId: c.id,
      notes: conversionNotes || undefined,
    };
    const nextStudents = [...(data.students || []), newStudent];
    const nextCandidates = all.map(x => x.id === c.id ? { ...x, convertedToStudentId: newStudent.id } : x);
    setSaving(true); setSaveMsg(null);
    const nextData = { ...data, students: nextStudents, candidates: nextCandidates };
    const res = await saveSnapshot(nextData, { name: userName }, {
      action: 'הועבר לסטודנטים', entity: 'מועמד', target: c.name,
    });
    setSaving(false);
    if (!res.ok) { setSaveMsg('שגיאה: ' + (res.error || '')); return; }
    setEditing(null);
    (data.students as Student[]) = nextStudents;
    (data.candidates as Candidate[]) = nextCandidates;
    onRefresh();
    setSaveMsg('✓ הועבר לסטודנטים');
    setTimeout(() => setSaveMsg(null), 3000);
  }

  return (
    <main className="max-w-[1200px] mx-auto px-10 pt-14 pb-28">
      <section className="pt-4 pb-14 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">V · מועמדים</div>
        <div className="flex items-end justify-between gap-10">
          <div>
            <h1 className="serif text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>מועמדים</h1>
            <p className="text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
              {counts.total === 0
                ? 'אין מועמדים בהקשר הנוכחי.'
                : `${counts.total} מועמדים · ${counts.pending} ממתינים · ${counts.passed} עברו · ${counts.failed} לא עברו`}
            </p>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <button onClick={() => setCreating(true)} className="btn btn-primary whitespace-nowrap">
              + מועמד/ת חדש/ה <span className="serif text-[16px]">→</span>
            </button>
            <button onClick={() => setShowImport(s => !s)}
              className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
              style={{ color: 'var(--accent)' }}>
              📊 {showImport ? 'סגור ייבוא' : 'ייבוא מ‑Excel'}
            </button>
          </div>
        </div>
      </section>

      {showImport && (
        <div className="mb-8">
          <ExcelImport kind="candidates" data={data} userName={userName} onDone={() => { setShowImport(false); onRefresh(); }} />
        </div>
      )}

      <SubmissionsInbox onAcceptIntoCandidates={handleAcceptSubmissionIntoCandidates} />

      <div className="mono text-[12px] uppercase tracking-[0.16em] flex items-center gap-4 flex-wrap mb-10" style={{ color: 'var(--text-soft)' }}>
        <RefreshButton onRefresh={onRefresh} />
        {saveMsg && <span style={{ color: 'var(--accent)' }}>· {saveMsg}</span>}
        {saving && <span className="opacity-75">· שומר...</span>}
      </div>

      {/* Ramzor tab bar */}
      <div className="ramzor-bar mb-4">
        {([
          ['all',     'הכל',      counts.total,   null   ],
          ['pending', 'ממתינים', counts.pending,  'gray' ],
          ['passed',  'עברו',     counts.passed,   'green'],
          ['failed',  'לא עברו', counts.failed,   'red'  ],
        ] as const).map(([key, label, n, dot]) => {
          const active = stage === key;
          const borderCol = dot ? `var(--tl-${dot})` : 'var(--accent)';
          return (
            <button key={key} onClick={() => setStage(key)}
              className={`ramzor-tab${active ? ' active' : ''}`}
              style={{ borderColor: active ? borderCol : 'transparent' }}>
              {dot && <StatusDot status={dot as DotStatus} size={7} />}
              <span className="mono text-[11px] uppercase tracking-[0.13em] font-semibold">{label}</span>
              <span className="serif text-[18px] leading-none">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="mb-4 flex gap-3 items-center">
        <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="חפש לפי שם, טלפון, מייל..."
          className="input flex-1"
          style={{ padding: '8px 14px', fontSize: '14px' }}/>
        {selectedIds.size > 0 && (
          <button
            onClick={() => setShowMsgModal(true)}
            className="btn btn-primary whitespace-nowrap"
          >
            📧 שלח הודעה ({selectedIds.size})
          </button>
        )}
        {selectedIds.size > 0 && (
          <button
            onClick={() => setSelectedIds(new Set())}
            className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
            style={{ color: 'var(--text-soft)' }}
          >
            נקה בחירה
          </button>
        )}
      </div>

      {/* Group message modal */}
      {showMsgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(26,22,18,0.55)' }}>
          <div className="rounded-2xl border p-8 max-w-[520px] w-full mx-4" style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 20px 60px rgba(26,22,18,0.3)' }}>
            <div className="flex items-baseline justify-between mb-5">
              <div className="serif text-[22px]" style={{ color: 'var(--ink)' }}>שלח הודעה לנבחרים</div>
              <button onClick={() => setShowMsgModal(false)} className="mono text-[11px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100" style={{ color: 'var(--ink)' }}>✕</button>
            </div>
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-4 p-3 rounded-lg" style={{ background: 'rgba(122,30,43,0.06)', color: 'var(--ink)' }}>
              {Array.from(selectedIds).map(id => all.find(c => c.id === id)?.name).filter(Boolean).join(' · ')}
            </div>
            <label className="block mb-3">
              <span className="mono text-[11px] uppercase tracking-[0.14em] mb-1 block" style={{ color: 'var(--text-soft)' }}>נושא</span>
              <input value={msgSubject} onChange={e => setMsgSubject(e.target.value)} className="input w-full" style={{ padding: '10px 14px', fontSize: '14px' }} placeholder="נושא ההודעה..." />
            </label>
            <label className="block mb-5">
              <span className="mono text-[11px] uppercase tracking-[0.14em] mb-1 block" style={{ color: 'var(--text-soft)' }}>תוכן</span>
              <textarea value={msgBody} onChange={e => setMsgBody(e.target.value)} rows={5} className="input w-full" style={{ padding: '10px 14px', fontSize: '14px', resize: 'vertical' }} placeholder="תוכן ההודעה..."/>
            </label>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowMsgModal(false)} className="btn">ביטול</button>
              <button
                onClick={() => {
                  showToast(`✓ הודעה הוכנה ל‑${selectedIds.size} נמענים`, 'success');
                  setShowMsgModal(false);
                  setMsgSubject(''); setMsgBody('');
                  setSelectedIds(new Set());
                }}
                className="btn btn-primary"
              >
                📧 שלח הודעה
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        {filtered.length === 0 ? (
          <div className="py-24 text-center">
            <div className="serif text-[26px]" style={{ color: 'var(--ink)' }}>אין מועמדים להצגה</div>
            <div className="mt-3 text-[14px]" style={{ color: 'var(--text-soft)' }}>הוסף חדש או שנה סינון.</div>
          </div>
        ) : (
          <ul>
            {filtered.map(c => (
              <CandidateRow
                key={c.id}
                c={c}
                onEdit={() => setEditing(c)}
                pinned={pinnedId === c.id}
                onTogglePin={() => setPinnedId(pinnedId === c.id ? null : c.id)}
                selected={selectedIds.has(c.id)}
                onToggleSelect={() => {
                  const next = new Set(selectedIds);
                  next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                  setSelectedIds(next);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {(editing || creating) && (
        <CandidateEditor
          candidate={editing}
          courses={courses}
          years={years}
          defaultCourseId={context.courseId}
          defaultYear={context.year}
          onSave={handleSave}
          onDelete={editing ? handleDelete : undefined}
          onConvertToStudent={handleConvertToStudent}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </main>
  );
}

function CandidateRow({ c, onEdit, pinned, onTogglePin, selected, onToggleSelect }: {
  c: Candidate; onEdit: () => void; pinned: boolean; onTogglePin: () => void;
  selected?: boolean; onToggleSelect?: () => void;
}) {
  const r = c.interviewResult || 'pending';
  const label = r === 'passed' ? 'עבר' : r === 'failed' ? 'לא התקבל' : 'ממתין';
  const isPass = r === 'passed';
  const hasDocs = !!(c.cvUrl && c.applicationUrl);
  const stage = c.convertedToStudentId ? 'הועבר לסטודנטים' :
                isPass ? 'עבר ראיון' :
                r === 'failed' ? 'לא התקבל' :
                c.interviewDate ? 'ממתין/ה לתוצאה' :
                hasDocs ? 'מסמכים הוגשו' : 'ממתין/ה למסמכים';

  const dotStatus: DotStatus =
    r === 'failed' ? 'red' :
    r === 'passed' || c.convertedToStudentId ? 'green' :
    c.interviewDate ? 'amber' :
    'gray';

  return (
    <li className="relative group" data-info-row>
      <div onClick={onTogglePin}
        className="py-5 border-b grid gap-5 items-center cursor-pointer hover:bg-[rgba(122,30,43,0.02)]"
        style={{ borderColor: 'var(--divider)', gridTemplateColumns: 'auto auto 1fr auto auto' }}>
        <div onClick={e => { e.stopPropagation(); onToggleSelect?.(); }} className="flex items-center pr-1">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => {}}
            className="w-4 h-4 rounded cursor-pointer"
            style={{ accentColor: 'var(--accent)' }}
          />
        </div>
        <div className="flex items-center pl-1">
          <StatusDot status={dotStatus} size={10} />
        </div>
        <div>
          <div className="serif text-[22px] leading-[1.2] tracking-tight mb-1" style={{ color: 'var(--ink)' }}>{c.name || 'ללא שם'}</div>
          <div className="text-[13.5px] flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--text-soft)' }}>
            {c.phone && <span dir="ltr">{c.phone}</span>}
            {c.email && <span>{c.email}</span>}
            {c.interviewDate && <span>· ראיון: {new Date(c.interviewDate).toLocaleDateString('he-IL')}</span>}
          </div>
        </div>
        <div>
          <span className="mono text-[11px] uppercase tracking-[0.15em] font-semibold whitespace-nowrap px-3 py-1 rounded-full"
            style={{
              color: isPass ? 'var(--bg)' : 'var(--accent)',
              background: isPass ? 'var(--accent)' : 'rgba(122, 30, 43, 0.08)',
            }}>
            {label}
          </span>
        </div>
        <div onClick={e => e.stopPropagation()}>
          <RowActions
            phone={c.phone}
            email={c.email}
            name={c.name}
            onEdit={onEdit}
            calendarUrl={c.interviewDate ? outlookCalendarUrl({
              subject: `ראיון מועמד: ${c.name || ''}`,
              startDate: c.interviewDate.slice(0, 10),
              startTime: c.interviewTime ? c.interviewTime.split(/[-–]/)[0] : '10:00',
              endTime: c.interviewTime ? (c.interviewTime.split(/[-–]/)[1] || '10:45') : '10:45',
              attendeeEmail: c.email,
              body: `ראיון מועמדות ל${c.name || 'מועמד/ת'}.`,
            }) : undefined}
          />
        </div>
      </div>

      <Popover pinned={pinned}>
        <div className="flex items-baseline justify-between gap-3 pb-3 mb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
          <div>
            <div className="serif text-[22px] leading-[1.15]" style={{ color: 'var(--ink)' }}>{c.name}</div>
            <div className="mono text-[10.5px] uppercase tracking-[0.14em] mt-1" style={{ color: 'var(--accent)' }}>
              שלב: {stage}
            </div>
          </div>
          {pinned && <button onClick={onTogglePin} className="mono text-[10px] uppercase tracking-[0.14em] font-semibold opacity-60 hover:opacity-100">✕</button>}
        </div>
        <div className="space-y-1.5 text-[13px]">
          <DetailRowC label="טלפון" value={c.phone} />
          <DetailRowC label="מייל" value={c.email} />
          <DetailRowC label="שנה" value={c.year} />
          <DetailRowC label="CV" value={c.cvUrl ? '✓ הוגש' : '—'} />
          <DetailRowC label="טופס" value={c.applicationUrl ? '✓ הוגש' : '—'} />
          <DetailRowC label="ראיון" value={c.interviewDate ? new Date(c.interviewDate).toLocaleDateString('he-IL') : 'לא נקבע'} />
          <DetailRowC label="תוצאה" value={label} accent={isPass || r === 'failed'} />
          {c.evalScore != null && <DetailRowC label="ציון" value={String(c.evalScore)} accent={c.evalScore >= 85} />}
          {c.interviewSummary && <DetailRowC label="סיכום" value={c.interviewSummary} />}
        </div>
      </Popover>
    </li>
  );
}

function DetailRowC({ label, value, accent }: { label: string; value?: string | null; accent?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-3">
      <span className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold w-20 shrink-0" style={{ color: 'var(--text-soft)' }}>{label}</span>
      <span style={{ color: accent ? 'var(--accent)' : 'var(--ink)' }}>{value}</span>
    </div>
  );
}
