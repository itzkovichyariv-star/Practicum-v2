import { useMemo, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
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

  // CV updates (unseen uploads from candidates)
  const [cvUpdates, setCvUpdates] = useState<Record<string, { id: string; cv_file_path: string; uploaded_at: string }>>({});

  useEffect(() => {
    supabase.from('cv_updates')
      .select('id, email, cv_file_path, uploaded_at')
      .is('seen_at', null)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, { id: string; cv_file_path: string; uploaded_at: string }> = {};
        for (const row of data) {
          const key = (row.email || '').toLowerCase();
          // Keep most recent per email
          if (!map[key] || row.uploaded_at > map[key].uploaded_at) {
            map[key] = { id: row.id, cv_file_path: row.cv_file_path, uploaded_at: row.uploaded_at };
          }
        }
        setCvUpdates(map);
      });
  }, []);

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

      // Send acceptance email with CV-update link (fire-and-forget)
      if (c.email) {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token || 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
        fetch('https://vpqgmcmavnszcnakhiat.supabase.co/functions/v1/notify-acceptance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt',
          },
          body: JSON.stringify({ candidate: c }),
        }).catch(err => console.warn('notify-acceptance failed:', err));
      }

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
      // Use showToast instead of confirm() — Safari resets React state on confirm()
      // Auto-merge by email match, otherwise create new record (admin can merge manually)
      existingRecord = undefined; // create new, admin can merge manually if needed
      showToast(`נמצא מועמד דומה: ${bySimilarName.name} — נוצרה רשומה חדשה ל-${sub.name}`, 'success');
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
      if (res.ok) {
        (data.candidates as Candidate[]) = nextCandidates;
        onRefresh();
        showToast(`✓ נקלט מועמד חדש: ${sub.name}`, 'success');
      } else {
        showToast('שגיאה בשמירה: ' + (res.error || 'לא ידוע'), 'error');
      }
    }
  }

  async function handleRevertToSubmission(c: Candidate) {
    // Find the matching processed submission (by email first, then name)
    let subId: string | null = null;
    if (c.email) {
      const { data: subs } = await supabase
        .from('candidate_submissions')
        .select('id')
        .eq('processed', true)
        .ilike('email', c.email)
        .order('submitted_at', { ascending: false })
        .limit(1);
      subId = subs?.[0]?.id ?? null;
    }
    if (!subId && c.name) {
      const { data: subs } = await supabase
        .from('candidate_submissions')
        .select('id')
        .eq('processed', true)
        .ilike('name', c.name)
        .order('submitted_at', { ascending: false })
        .limit(1);
      subId = subs?.[0]?.id ?? null;
    }
    if (subId) {
      await supabase.from('candidate_submissions').update({ processed: false }).eq('id', subId);
    }
    const nextCandidates = all.filter(x => x.id !== c.id);
    await persistAndRefresh(nextCandidates, `↩ ${c.name} הוחזר לתיבת ההגשות`);
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
    <main className="max-w-[1200px] mx-auto px-4 sm:px-10 pt-14 pb-28">
      <section className="pt-4 pb-14 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">V · מועמדים</div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>מועמדים</h1>
            <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
              {counts.total === 0
                ? 'אין מועמדים בהקשר הנוכחי.'
                : `${counts.total} מועמדים · ${counts.pending} ממתינים · ${counts.passed} עברו · ${counts.failed} לא עברו`}
            </p>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <button onClick={() => setCreating(true)} style={{
              display: 'inline-block', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
              background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>+ מועמד/ת חדש/ה →</button>
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
          <button onClick={() => setShowMsgModal(true)} style={{
            display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
            background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}>📧 שלח הודעה ({selectedIds.size})</button>
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
            {/* Warn about candidates without email */}
            {(() => {
              const noEmail = Array.from(selectedIds)
                .map(id => all.find(c => c.id === id))
                .filter(c => c && !c.email)
                .map(c => c!.name);
              return noEmail.length > 0 ? (
                <div className="mb-4 p-3 rounded-lg text-[12.5px]" style={{ background: 'rgba(180,60,60,0.08)', color: '#b03030', border: '1px solid rgba(180,60,60,0.2)' }}>
                  ⚠ ללא מייל (לא יישלח): {noEmail.join(', ')}
                </div>
              ) : null;
            })()}
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
                  const emails = Array.from(selectedIds)
                    .map(id => all.find(c => c.id === id)?.email)
                    .filter(Boolean) as string[];
                  const missing = Array.from(selectedIds)
                    .map(id => all.find(c => c.id === id))
                    .filter(c => c && !c.email)
                    .map(c => c!.name);
                  if (emails.length === 0) {
                    showToast('לאף אחד מהנבחרים אין מייל רשום', 'error');
                    return;
                  }
                  const to = emails.join(',');
                  const url = `mailto:${to}?subject=${encodeURIComponent(msgSubject)}&body=${encodeURIComponent(msgBody)}`;
                  window.location.href = url;
                  if (missing.length > 0) {
                    showToast(`נפתח Outlook ל‑${emails.length} נמענים · ללא מייל: ${missing.join(', ')}`, 'success');
                  } else {
                    showToast(`✓ נפתח Outlook ל‑${emails.length} נמענים`, 'success');
                  }
                  setShowMsgModal(false);
                  setMsgSubject(''); setMsgBody('');
                  setSelectedIds(new Set());
                }}
                style={{
                  display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
                  background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px',
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                📧 פתח ב‑Outlook
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
                cvUpdate={c.email ? cvUpdates[(c.email || '').toLowerCase()] : undefined}
                onCvUpdateSeen={async (updateId) => {
                  await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', updateId);
                  setCvUpdates(prev => {
                    const next = { ...prev };
                    const key = (c.email || '').toLowerCase();
                    delete next[key];
                    return next;
                  });
                }}
                onRevert={() => handleRevertToSubmission(c)}
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

function CandidateRow({ c, onEdit, pinned, onTogglePin, selected, onToggleSelect, cvUpdate, onCvUpdateSeen, onRevert }: {
  c: Candidate; onEdit: () => void; pinned: boolean; onTogglePin: () => void;
  selected?: boolean; onToggleSelect?: () => void;
  cvUpdate?: { id: string; cv_file_path: string; uploaded_at: string };
  onCvUpdateSeen?: (id: string) => void;
  onRevert?: () => void;
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
        className="py-4 border-b cursor-pointer hover:bg-[rgba(122,30,43,0.02)]"
        style={{ borderColor: 'var(--divider)' }}>

        {/* Line 1: checkbox · dot · name · status badge */}
        <div className="flex items-center gap-2 min-w-0 mb-1.5">
          <div onClick={e => { e.stopPropagation(); onToggleSelect?.(); }} className="shrink-0">
            <input type="checkbox" checked={!!selected} onChange={() => {}}
              className="w-4 h-4 rounded cursor-pointer" style={{ accentColor: 'var(--accent)' }} />
          </div>
          <StatusDot status={dotStatus} size={9} />
          <div className="serif text-[20px] leading-tight tracking-tight flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>
            {c.name || 'ללא שם'}
          </div>
          <span className="mono text-[10px] uppercase tracking-[0.13em] font-semibold shrink-0 px-2.5 py-1 rounded-full whitespace-nowrap"
            style={{ color: isPass ? 'var(--bg)' : 'var(--accent)', background: isPass ? 'var(--accent)' : 'rgba(122,30,43,0.08)' }}>
            {label}
          </span>
          {cvUpdate && (
            <button
              type="button"
              onClick={async e => {
                e.stopPropagation();
                const { data } = await supabase.storage.from('candidate-uploads').getPublicUrl(cvUpdate.cv_file_path);
                window.open(data.publicUrl, '_blank');
                onCvUpdateSeen?.(cvUpdate.id);
              }}
              title={`CV מעודכן הועלה — ${new Date(cvUpdate.uploaded_at).toLocaleDateString('he-IL')}`}
              className="mono text-[10px] uppercase tracking-[0.13em] font-semibold shrink-0 px-2.5 py-1 rounded-full whitespace-nowrap animate-pulse"
              style={{ color: '#fff', background: '#d97706', border: 'none' }}>
              CV ✦ חדש
            </button>
          )}
        </div>

        {/* Line 2: contact info · action icons */}
        <div className="flex items-center gap-2 pr-5" onClick={e => e.stopPropagation()}>
          <div className="text-[12.5px] flex flex-wrap gap-x-3 gap-y-0.5 flex-1 min-w-0" style={{ color: 'var(--text-soft)' }}>
            {c.phone && <span dir="ltr">{c.phone}</span>}
            {c.email && <span className="truncate max-w-[200px]">{c.email}</span>}
            {c.interviewDate && <span className="whitespace-nowrap">· {new Date(c.interviewDate).toLocaleDateString('he-IL')}</span>}
          </div>
          {onRevert && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRevert(); }}
              className="mono text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-1 rounded-full border opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              style={{ borderColor: 'var(--divider)', color: 'var(--text-soft)' }}
              title="החזר לתיבת ההגשות">
              ↩ הגשות
            </button>
          )}
          {c.interviewDate && (
            <span
              className="mono text-[10px] tracking-[0.06em] font-semibold shrink-0 px-2 py-1 rounded-lg whitespace-nowrap"
              style={{ background: 'rgba(122,30,43,0.07)', color: 'var(--accent)' }}
              title="מועד ראיון">
              📅 {new Date(c.interviewDate).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}
              {c.interviewTime && <span dir="ltr"> · {c.interviewTime.split(/[-–]/)[0]}</span>}
            </span>
          )}
          <RowActions
            phone={c.phone}
            email={c.email}
            name={c.name}
            onEdit={onEdit}
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
