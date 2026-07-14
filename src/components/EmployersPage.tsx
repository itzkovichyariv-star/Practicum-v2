import { useEffect, useMemo, useState } from 'react';
import { btnPrimary, btnSecondary, btnSmall, btnTab } from '../lib/design';
import type { Employer, EmployerApprovalRequest, Student } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import type { PageProps } from './pageShared';
import { normalizeYear } from './pageShared';
import { saveSnapshot, randomId } from '../lib/dataApi';
import { showToast } from '../lib/toast';
import EmployerEditor from './EmployerEditor';
import { NeedsUpdate, RefreshButton } from './StudentsPage';
import ExcelImport from './ExcelImport';
import { buildWhatsAppUrl, buildMailtoUrl, renderTemplate, openVacancies, totalVacancies } from '../lib/placement';
import { openMailto } from '../lib/openMailto';
import { orgAvailability, ORG_PURPLE } from '../lib/orgAvailability';

function empCourseIds(e: Employer): string[] {
  if (e.courseIds && e.courseIds.length > 0) return e.courseIds;
  if (e.courseId) return [e.courseId];
  return [];
}

type PosFilter = 'all' | 'open' | 'full' | 'none';

type ViewMode = 'list' | 'grid';

export default function EmployersPage({ data, context, userName, onRefresh }: PageProps & { data: any }) {
  const [tab, setTab] = useState<'employers' | 'approvals'>('employers');
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<PosFilter>('all');
  const [courseFilter, setCourseFilter] = useState('');
  const [editing, setEditing] = useState<Employer | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem('employers_view') as ViewMode) || 'list'; } catch { return 'list'; }
  });

  function toggleView(mode: ViewMode) {
    setViewMode(mode);
    try { localStorage.setItem('employers_view', mode); } catch {}
  }

  const all: Employer[] = data.employers || [];
  const courses = data.courses || [];
  const students: Student[] = data.students || [];

  // ── Pending candidate org-suggestions (from /cv-update) awaiting approval ──
  type Suggestion = { id: string; email: string; name: string | null; suggested_org: any };
  const [pendingSuggestions, setPendingSuggestions] = useState<Suggestion[]>([]);
  useEffect(() => {
    let alive = true;
    // Fetch ALL submissions (not just unseen-with-suggestion) so we can pick the
    // truly latest submission per candidate, then keep it only if THAT one carries
    // an unhandled suggestion. This way a newer submission without a suggestion
    // correctly supersedes (hides) an older suggestion, and we never show two rows
    // for the same candidate.
    supabase.from('cv_updates')
      .select('id, email, name, suggested_org, uploaded_at, seen_at')
      .order('uploaded_at', { ascending: false })
      .then(({ data }) => {
        if (!alive) return;
        const latestByEmail = new Map<string, any>();
        for (const r of (data || [])) {
          const key = (r.email || '').trim().toLowerCase();
          if (!key || latestByEmail.has(key)) continue; // desc order → first seen = latest
          latestByEmail.set(key, r);
        }
        setPendingSuggestions(
          [...latestByEmail.values()].filter((r: any) => r.suggested_org?.name && !r.seen_at),
        );
      });
    return () => { alive = false; };
  }, []);

  async function approveSuggestion(sug: Suggestion) {
    const o = sug.suggested_org || {};
    const student = students.find(s => (s.email || '').trim().toLowerCase() === (sug.email || '').trim().toLowerCase());
    const emp: Employer = {
      id: randomId('emp'),
      name: o.name,
      contactPerson: o.contactName || '',
      contactPhone: o.phone || '',
      contactEmail: o.email || '',
      location: o.location || '',
      notes: [o.contactRole ? `תפקיד איש הקשר: ${o.contactRole}` : '', o.notes || '', `(הצעת מועמד/ת: ${sug.name || sug.email})`].filter(Boolean).join('\n'),
      approvalStatus: 'approved',
      restrictedToStudentId: student?.id || null,
      addedBy: sug.email || 'candidate',
      courseIds: student?.courseId ? [student.courseId] : [],
    } as any;
    const updatedEmps = [...all, emp];
    const updatedStudents = student
      ? students.map(s => s.id === student.id ? { ...s, firstChoiceOrg: o.name, firstChoiceResult: s.firstChoiceResult || 'pending' } as Student : s)
      : students;
    setSaving(true);
    const res = await saveSnapshot(
      { ...data, employers: updatedEmps, students: updatedStudents },
      { name: userName },
      { action: 'אישר הצעת ארגון', entity: 'ארגון', target: o.name }
    );
    setSaving(false);
    if (!res.ok) { showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
    (data.employers as any) = updatedEmps;
    (data.students as any) = updatedStudents;
    await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', sug.id);
    setPendingSuggestions(p => p.filter(x => x.id !== sug.id));
    showToast(student ? '✓ אושר — נוסף כארגון פרטי ונקבע כבחירה ראשונה' : '✓ אושר — נוסף כארגון פרטי', 'success');
    onRefresh();
  }

  async function dismissSuggestion(sug: Suggestion) {
    await supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', sug.id);
    setPendingSuggestions(p => p.filter(x => x.id !== sug.id));
    showToast('הצעת הארגון נדחתה', 'success');
  }

  const years = useMemo(() => {
    const set = new Set<string>();
    courses.forEach((c: any) => c.year && set.add(normalizeYear(c.year)));
    (data.academicYears || []).forEach((y: string) => set.add(normalizeYear(y)));
    return Array.from(set).sort().reverse();
  }, [courses, data.academicYears]);

  const scoped = useMemo(() => all.filter(e => {
    const ids = empCourseIds(e);
    if (context.courseId !== '__all__') {
      const allowedIds = new Set(
        courses.filter((c: any) => c.name === context.courseId || c.id === context.courseId).map((c: any) => c.id)
      );
      if (!ids.some(id => allowedIds.has(id))) return false;
    }
    if (context.year !== '__all__') {
      const matches = ids.some(cid => {
        const course = courses.find((c: any) => c.id === cid);
        return course && normalizeYear(course.year) === normalizeYear(context.year);
      });
      if (!matches) return false;
    }
    return true;
  }), [all, context, courses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter(e => {
      const total = totalVacancies(e);
      const open = openVacancies(e);
      if (posFilter === 'open' && open === 0) return false;
      if (posFilter === 'full' && (open > 0 || total === 0)) return false;
      if (posFilter === 'none' && total > 0) return false;
      if (courseFilter) {
        const ids = empCourseIds(e);
        if (!ids.includes(courseFilter)) return false;
      }
      if (q) {
        const hay = [e.name, e.contactPerson, e.contactEmail, e.location].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  }, [scoped, search, posFilter, courseFilter]);

  const totalPositions = scoped.reduce((s, e) => s + totalVacancies(e), 0);
  const openPositions = scoped.reduce((s, e) => s + openVacancies(e), 0);
  const filledPositions = Math.max(0, totalPositions - openPositions);

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

  const approvalRequests: EmployerApprovalRequest[] = (data as any).employerApprovalRequests || [];
  const pendingApprovals = approvalRequests.filter(r => r.status === 'pending');
  const placementSettings = (data as any).placementSettings || {};

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-10 pt-14 pb-28">
      {/* Hero */}
      <section className="pt-4 pb-10 border-b mb-8" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">IV · מעסיקים</div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-4" style={{ color: 'var(--ink)' }}>מעסיקים</h1>
            <div className="flex gap-8 flex-wrap">
              <StatBox label="ארגונים" value={scoped.length} />
              <StatBox label="משרות" value={totalPositions} />
              <StatBox label="פתוחות" value={openPositions} accent={openPositions > 0} />
              <StatBox label="מאוישות" value={filledPositions} />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setCreating(true)} style={btnPrimary()}>+ מעסיק חדש →</button>
            <button onClick={() => setShowImport(i => !i)} style={btnSecondary()}>⬆ Excel</button>
          </div>
        </div>
      </section>

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: 'rgba(0,0,0,0.05)', display: 'inline-flex' }}>
        <button onClick={() => setTab('employers')} style={btnTab(tab === 'employers')}>
          מעסיקים ({scoped.length})
        </button>
        <button onClick={() => setTab('approvals')} style={btnTab(tab === 'approvals')}>
          תור אישורים
          {pendingApprovals.length > 0 && (
            <span className="mono text-[10px] mr-1.5 px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--accent)', color: 'white' }}>
              {pendingApprovals.length}
            </span>
          )}
        </button>
      </div>

      <div className="mono text-[12px] uppercase tracking-[0.16em] flex items-center gap-4 flex-wrap mb-6" style={{ color: 'var(--text-soft)' }}>
        <RefreshButton onRefresh={onRefresh} />
        {saveMsg && <span style={{ color: 'var(--accent)' }}>· {saveMsg}</span>}
        {saving && <span className="opacity-75">· שומר...</span>}
      </div>

      {tab === 'approvals' ? (
        <ApprovalQueueSection
          requests={approvalRequests}
          employers={all}
          students={students}
          courses={courses}
          placementSettings={placementSettings}
          data={data}
          userName={userName}
          onRefresh={onRefresh}
        />
      ) : (
        <>
          {showImport && (
            <section className="mb-8">
              <ExcelImport kind="employers" data={data} userName={userName} onDone={() => { setShowImport(false); onRefresh(); }} />
            </section>
          )}

          {/* Filter bar */}
          {/* Filter bar + view toggle */}
          <div className="flex gap-3 flex-wrap mb-6 items-center">
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חפש שם ארגון, איש קשר..."
              className="input"
              style={{ padding: '9px 14px', fontSize: '14px', flex: '1 1 180px', minWidth: '0' }}
            />
            <select
              value={courseFilter}
              onChange={e => setCourseFilter(e.target.value)}
              className="input"
              style={{ padding: '9px 14px', fontSize: '13px', flex: '0 1 auto', minWidth: '130px' }}
            >
              <option value="">כל הקורסים</option>
              {courses.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}{c.year ? ` · ${c.year}` : ''}</option>
              ))}
            </select>
            <div className="flex gap-1 p-1 rounded-lg flex-wrap" style={{ background: 'rgba(0,0,0,0.05)' }}>
              {([
                ['all', 'הכל'] as const,
                ['open', 'פתוחות'] as const,
                ['full', 'מלאות'] as const,
                ['none', 'ללא הגדרה'] as const,
              ]).map(([v, label]) => (
                <button key={v} onClick={() => setPosFilter(v)}
                  className="mono text-[10.5px] uppercase tracking-[0.1em] font-semibold px-3 py-1.5 rounded"
                  style={{
                    background: posFilter === v ? 'var(--accent)' : 'transparent',
                    color: posFilter === v ? 'white' : 'var(--text-soft)',
                    border: 'none', cursor: 'pointer',
                  }}>
                  {label}
                </button>
              ))}
            </div>
            {/* View mode toggle */}
            <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(0,0,0,0.05)', marginRight: 'auto' }}>
              <button onClick={() => toggleView('list')} title="תצוגת רשימה"
                className="mono text-[13px] px-2.5 py-1 rounded"
                style={{
                  background: viewMode === 'list' ? 'var(--bg)' : 'transparent',
                  color: viewMode === 'list' ? 'var(--ink)' : 'var(--text-soft)',
                  border: viewMode === 'list' ? '1px solid var(--divider)' : '1px solid transparent',
                  cursor: 'pointer', boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}>☰</button>
              <button onClick={() => toggleView('grid')} title="תצוגת כרטיסים"
                className="mono text-[13px] px-2.5 py-1 rounded"
                style={{
                  background: viewMode === 'grid' ? 'var(--bg)' : 'transparent',
                  color: viewMode === 'grid' ? 'var(--ink)' : 'var(--text-soft)',
                  border: viewMode === 'grid' ? '1px solid var(--divider)' : '1px solid transparent',
                  cursor: 'pointer', boxShadow: viewMode === 'grid' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}>⊞</button>
            </div>
          </div>

          {/* Pending candidate org-suggestions — review & approve here */}
          {pendingSuggestions.length > 0 && (
            <div className="mb-6 rounded-xl p-4" style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid var(--accent)' }}>
              <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
                ⚠ {pendingSuggestions.length} {pendingSuggestions.length === 1 ? 'הצעת ארגון מהמועמדים' : 'הצעות ארגון מהמועמדים'} — דרוש אישור
              </div>
              <div className="space-y-3">
                {pendingSuggestions.map(sug => {
                  const o = sug.suggested_org || {};
                  return (
                    <div key={sug.id} className="rounded-lg p-3" style={{ background: 'var(--bg)', border: '1px solid var(--divider)' }}>
                      <div className="text-[14px] leading-[1.7]" style={{ color: 'var(--ink)' }}>
                        <div><strong>{o.name}</strong>{o.location ? ` · ${o.location}` : ''}</div>
                        <div style={{ fontSize: '12.5px', color: 'var(--text-soft)' }}>הוצע ע״י: {sug.name || sug.email}</div>
                        <div style={{ fontSize: '12.5px' }}>איש/אשת קשר: {o.contactName || '—'}{o.contactRole ? ` (${o.contactRole})` : ''}</div>
                        <div dir="ltr" style={{ textAlign: 'right', fontSize: '12.5px' }}>{[o.email, o.phone].filter(Boolean).join(' · ')}</div>
                        {o.notes && <div style={{ fontSize: '12.5px', opacity: 0.85, whiteSpace: 'pre-wrap', marginTop: 4 }}>{o.notes}</div>}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button type="button" onClick={() => approveSuggestion(sug)} disabled={saving}
                          style={{ padding: '6px 13px', fontSize: '12px', fontWeight: 600, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer' }}>
                          ✓ אשר — צור ארגון פרטי למועמד/ת
                        </button>
                        <button type="button" onClick={() => dismissSuggestion(sug)} disabled={saving}
                          style={{ padding: '6px 13px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '999px', cursor: 'pointer' }}>
                          דחה
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legend — dot meanings + count not available to students */}
          {filtered.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', marginBottom: '12px', padding: '9px 14px', borderRadius: '10px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--divider)', fontSize: '12px', color: 'var(--text-soft)' }}>
              <span style={{ fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '11px' }}>מקרא</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--tl-green)', flexShrink: 0 }} /> זמין לסטודנטים (תיאור + מקומות פנויים)
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: ORG_PURPLE, flexShrink: 0 }} /> לא זמין — חסר תיאור / מקומות, או ממתין לאישור
              </span>
              {(() => { const na = filtered.filter(e => !orgAvailability(e).available).length; return na > 0
                ? <span style={{ marginInlineStart: 'auto', fontWeight: 700, color: ORG_PURPLE }}>⚠ {na} ארגונים אינם זמינים לסטודנטים</span>
                : <span style={{ marginInlineStart: 'auto', fontWeight: 700, color: '#15803d' }}>✓ כל הארגונים זמינים</span>; })()}
            </div>
          )}

          {/* Employer list / grid */}
          {filtered.length === 0 ? (
            <div className="py-24 text-center">
              <div className="serif text-[26px]" style={{ color: 'var(--ink)' }}>אין מעסיקים להצגה</div>
              <div className="mt-3 text-[14px]" style={{ color: 'var(--text-soft)' }}>שנה סינון או הוסף חדש.</div>
            </div>
          ) : viewMode === 'list' ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--divider)', borderRadius: '14px', overflow: 'hidden' }}>
              {filtered.map((e, idx) => {
                const hiredHere = students.filter(s => s.acceptedOrg === e.name);
                const linkedCourses = empCourseIds(e).map(cid => courses.find((c: any) => c.id === cid)).filter(Boolean) as any[];
                return (
                  <EmployerRow
                    key={e.id}
                    emp={e}
                    hiredCount={hiredHere.length}
                    hiredNames={hiredHere.map(s => s.name)}
                    linkedCourses={linkedCourses}
                    isLast={idx === filtered.length - 1}
                    onEdit={() => setEditing(e)}
                  />
                );
              })}
            </ul>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '16px' }}>
              {filtered.map(e => {
                const hiredHere = students.filter(s => s.acceptedOrg === e.name);
                const linkedCourses = empCourseIds(e).map(cid => courses.find((c: any) => c.id === cid)).filter(Boolean) as any[];
                return (
                  <EmployerCard
                    key={e.id}
                    emp={e}
                    hiredCount={hiredHere.length}
                    hiredNames={hiredHere.map(s => s.name)}
                    linkedCourses={linkedCourses}
                    onEdit={() => setEditing(e)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

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

/* ── Employer card (grid view) ── */
function EmployerCard({ emp, hiredCount, hiredNames, linkedCourses, onEdit }: {
  emp: Employer; hiredCount: number; hiredNames: string[];
  linkedCourses: { name: string; year?: string; id?: string }[];
  onEdit: () => void;
}) {
  const av = orgAvailability(emp);
  const { total, filled, open, isPending } = av;
  const fillPct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;
  const dotColor = av.dotColor;
  const dotLabel = av.reason;
  const hasFooter = linkedCourses.length > 0 || hiredCount > 0;

  function callEmployer() { if (emp.contactPhone) window.location.href = `tel:${emp.contactPhone.replace(/[^\d+]/g, '')}`; }
  function whatsappEmployer() {
    if (!emp.contactPhone) return;
    let n = emp.contactPhone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}`, '_blank');
  }
  function emailEmployer() {
    if (emp.contactEmail) openMailto(`mailto:${encodeURIComponent(emp.contactEmail)}?subject=${encodeURIComponent(`פרקטיקום — ${emp.name}`)}&body=${encodeURIComponent(`שלום ${emp.contactPerson || ''},\n\n`)}`);
  }

  return (
    <div style={{ borderRadius: '16px', border: `1px solid ${isPending ? 'rgba(217,119,6,0.4)' : 'var(--divider)'}`, background: 'var(--bg)', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--divider)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <div style={{ flexShrink: 0, width: '9px', height: '9px', borderRadius: '50%', background: dotColor }} title={dotLabel} />
            <div className="serif text-[17px] leading-tight" style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</div>
            {!av.available && av.badge && (
              <span style={{ flexShrink: 0, fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.05em', padding: '2px 7px', borderRadius: '999px', background: 'rgba(147,51,234,0.12)', color: ORG_PURPLE, whiteSpace: 'nowrap' }}>{av.badge}</span>
            )}
          </div>
          <button type="button" onClick={onEdit} style={{ flexShrink: 0, padding: '4px 10px', fontSize: '11px', fontWeight: 600, background: 'transparent', color: 'var(--text-soft)', border: '1px solid var(--divider)', borderRadius: '999px', cursor: 'pointer', fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.1em' }}>עריכה</button>
        </div>
        {emp.location && <div style={{ fontSize: '12px', color: 'var(--text-soft)', paddingRight: '17px' }}>📍 {emp.location}</div>}
        <div style={{ fontSize: '10.5px', fontWeight: 600, fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.1em', color: dotColor, paddingRight: '17px', marginTop: '2px', textTransform: 'uppercase' }}>{dotLabel}</div>
      </div>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--divider)' }}>
        {emp.contactPerson
          ? <div style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--ink)', marginBottom: '10px' }}>👤 {emp.contactPerson}</div>
          : <div style={{ fontSize: '12px', color: 'var(--text-soft)', marginBottom: '10px' }}>⚠ אין איש קשר מוגדר</div>}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={callEmployer} disabled={!emp.contactPhone} title={emp.contactPhone || 'אין טלפון'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px', fontSize: '11.5px', fontWeight: 600, background: emp.contactPhone ? 'rgba(122,30,43,0.07)' : 'transparent', color: emp.contactPhone ? 'var(--accent)' : 'var(--text-soft)', border: `1px solid ${emp.contactPhone ? 'rgba(122,30,43,0.3)' : 'var(--divider)'}`, borderRadius: '999px', cursor: emp.contactPhone ? 'pointer' : 'not-allowed', opacity: emp.contactPhone ? 1 : 0.4, whiteSpace: 'nowrap' }}>
            📞{emp.contactPhone ? <span dir="ltr" style={{ fontFamily: 'monospace', fontSize: '11px' }}> {emp.contactPhone}</span> : ' חייג'}
          </button>
          <button onClick={whatsappEmployer} disabled={!emp.contactPhone}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px', fontSize: '11.5px', fontWeight: 600, background: emp.contactPhone ? 'rgba(37,211,102,0.1)' : 'transparent', color: emp.contactPhone ? '#15803d' : 'var(--text-soft)', border: `1px solid ${emp.contactPhone ? 'rgba(37,211,102,0.5)' : 'var(--divider)'}`, borderRadius: '999px', cursor: emp.contactPhone ? 'pointer' : 'not-allowed', opacity: emp.contactPhone ? 1 : 0.4 }}>
            📱 WhatsApp
          </button>
          <button onClick={emailEmployer} disabled={!emp.contactEmail} title={emp.contactEmail || 'אין מייל'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px', fontSize: '11.5px', fontWeight: 600, background: emp.contactEmail ? 'rgba(37,99,235,0.07)' : 'transparent', color: emp.contactEmail ? '#1d4ed8' : 'var(--text-soft)', border: `1px solid ${emp.contactEmail ? 'rgba(37,99,235,0.35)' : 'var(--divider)'}`, borderRadius: '999px', cursor: emp.contactEmail ? 'pointer' : 'not-allowed', opacity: emp.contactEmail ? 1 : 0.4 }}>
            ✉ מייל
          </button>
          {(!emp.contactPhone || !emp.contactEmail) && <NeedsUpdate />}
        </div>
        {emp.notes && <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-soft)', lineHeight: 1.5 }}>{emp.notes}</div>}
      </div>
      {total > 0 && (
        <div style={{ padding: '12px 18px', borderBottom: hasFooter ? '1px solid var(--divider)' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono,monospace)', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-soft)' }}>קיבולת</span>
            <span style={{ fontSize: '11.5px', fontWeight: 600, fontFamily: 'var(--font-mono,monospace)', color: 'var(--ink)' }}>
              {filled}/{total}{open > 0 && <span style={{ color: 'var(--tl-green)' }}> · {open} פתוחות</span>}
            </span>
          </div>
          <div style={{ height: '5px', borderRadius: '99px', background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '99px', width: `${fillPct}%`, background: fillPct >= 100 ? '#94a3b8' : fillPct > 65 ? '#f59e0b' : 'var(--tl-green)', transition: 'width 0.4s ease' }} />
          </div>
        </div>
      )}
      {hasFooter && (
        <div style={{ padding: '10px 18px 14px' }}>
          {linkedCourses.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: hiredCount > 0 ? '7px' : '0' }}>
              {linkedCourses.map((c: any) => (
                <span key={c.name + c.year} style={{ fontSize: '10px', fontFamily: 'var(--font-mono,monospace)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 8px', borderRadius: '999px', background: 'rgba(122,30,43,0.08)', color: 'var(--accent)' }}>
                  {c.name}{c.year ? ` · ${c.year}` : ''}
                </span>
              ))}
            </div>
          )}
          {hiredCount > 0 && <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>👤 {hiredNames.slice(0, 3).join(', ')}{hiredNames.length > 3 ? ` +${hiredNames.length - 3}` : ''}</div>}
        </div>
      )}
    </div>
  );
}

/* ── Stat box ── */
function StatBox({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="mono text-[10px] uppercase tracking-[0.15em] mb-0.5 font-semibold" style={{ color: 'var(--text-soft)' }}>{label}</div>
      <div className="serif text-[30px] leading-none tracking-tight" style={{ color: accent ? 'var(--accent)' : 'var(--ink)' }}>{value}</div>
    </div>
  );
}

/* ── Employer row (collapsible) ── */
function EmployerRow({ emp, hiredCount, hiredNames, linkedCourses, isLast, onEdit }: {
  emp: Employer; hiredCount: number; hiredNames: string[];
  linkedCourses: { name: string; year?: string; id?: string }[];
  isLast: boolean;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);

  const av = orgAvailability(emp);
  const { total, filled, isPending } = av;
  const available = av.open; // open-places count — keeps the row's existing references working
  const fillPct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;
  const dotColor = av.dotColor;
  const posLabel = av.reason;

  function callEmployer() {
    if (!emp.contactPhone) return;
    window.location.href = `tel:${emp.contactPhone.replace(/[^\d+]/g, '')}`;
  }
  function whatsappEmployer() {
    if (!emp.contactPhone) return;
    let n = emp.contactPhone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}`, '_blank');
  }
  function emailEmployer() {
    if (!emp.contactEmail) return;
    openMailto(`mailto:${encodeURIComponent(emp.contactEmail)}?subject=${encodeURIComponent(`פרקטיקום — ${emp.name}`)}&body=${encodeURIComponent(`שלום ${emp.contactPerson || ''},\n\n`)}`);
  }

  return (
    <li style={{
      borderBottom: isLast ? 'none' : '1px solid var(--divider)',
      background: open ? 'rgba(0,0,0,0.015)' : 'var(--bg)',
      transition: 'background 0.15s',
    }}>
      {/* ── Collapsed row (wraps: name keeps line 1, controls drop to line 2 on mobile) ── */}
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px',
          padding: '11px 16px', cursor: 'pointer', userSelect: 'none',
        }}
        onClick={() => setOpen(o => !o)}
      >
        {/* Primary: dot + name + badge — always gets line priority so the name is never squeezed out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 190px', minWidth: 0 }}>
          <div style={{ flexShrink: 0, width: '8px', height: '8px', borderRadius: '50%', background: dotColor }} title={posLabel} />
          <div className="serif" style={{
            flex: '1 1 auto', minWidth: 0, fontSize: '15px', fontWeight: 500,
            color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {emp.name}
          </div>
          {!av.available && av.badge && (
            <span style={{ flexShrink: 0, fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.05em', padding: '2px 7px', borderRadius: '999px', background: 'rgba(147,51,234,0.12)', color: ORG_PURPLE, whiteSpace: 'nowrap' }}>{av.badge}</span>
          )}
        </div>

        {/* Contact person — wide screens only (also in the expanded detail) */}
        {emp.contactPerson && (
          <div className="hidden xl:block" style={{ flex: '0 1 140px', minWidth: 0, fontSize: '12.5px', color: 'var(--text-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {emp.contactPerson}
          </div>
        )}
        {/* Location — wide screens only */}
        {emp.location && (
          <div className="hidden xl:block" style={{ flex: '0 1 110px', minWidth: 0, fontSize: '12px', color: 'var(--text-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📍 {emp.location}
          </div>
        )}

        {/* Trailing group: availability + actions — wraps to its own line on mobile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginInlineStart: 'auto' }}>
          <div style={{
            flexShrink: 0, fontSize: '11px', fontFamily: 'var(--font-mono,monospace)',
            fontWeight: 600, letterSpacing: '0.06em', padding: '2px 9px', borderRadius: '999px',
            background: available > 0 ? 'rgba(21,128,61,0.1)' : total > 0 ? 'rgba(0,0,0,0.06)' : 'transparent',
            color: available > 0 ? '#15803d' : 'var(--text-soft)',
            whiteSpace: 'nowrap',
          }}>
            {posLabel}
          </div>

          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <ActionBtn icon="📞" active={!!emp.contactPhone} title={emp.contactPhone || 'אין טלפון'} color="var(--accent)" bg="rgba(122,30,43,0.07)" border="rgba(122,30,43,0.25)" onClick={callEmployer} />
            <ActionBtn icon="📱" active={!!emp.contactPhone} title="WhatsApp" color="#15803d" bg="rgba(37,211,102,0.08)" border="rgba(37,211,102,0.4)" onClick={whatsappEmployer} />
            <ActionBtn icon="✉" active={!!emp.contactEmail} title={emp.contactEmail || 'אין מייל'} color="#1d4ed8" bg="rgba(37,99,235,0.07)" border="rgba(37,99,235,0.3)" onClick={emailEmployer} />
          </div>

          <button type="button" onClick={e => { e.stopPropagation(); onEdit(); }}
            style={{
              flexShrink: 0, padding: '3px 10px', fontSize: '10.5px', fontWeight: 600,
              background: 'transparent', color: 'var(--text-soft)',
              border: '1px solid var(--divider)', borderRadius: '999px', cursor: 'pointer',
              fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.08em',
            }}>
            עריכה
          </button>

          <div style={{ flexShrink: 0, fontSize: '11px', color: 'var(--text-soft)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>
            ▾
          </div>
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {open && (
        <div style={{
          padding: '0 18px 16px 38px',
          borderTop: '1px solid var(--divider)',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px',
        }}>

          {/* Contact details */}
          <div>
            <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono,monospace)', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-soft)', marginBottom: '5px', marginTop: '12px' }}>קשר</div>
            {emp.contactPerson && <div style={{ fontSize: '13px', color: 'var(--ink)', marginBottom: '2px' }}>👤 {emp.contactPerson}</div>}
            {emp.contactPhone && <div style={{ fontSize: '12.5px', color: 'var(--text-soft)' }} dir="ltr">📞 {emp.contactPhone}</div>}
            {emp.contactEmail && <div style={{ fontSize: '12px', color: 'var(--text-soft)', wordBreak: 'break-all' }}>✉ {emp.contactEmail}</div>}
            {(!emp.contactPhone || !emp.contactEmail) && <NeedsUpdate />}
          </div>

          {/* Capacity bar */}
          {total > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono,monospace)', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-soft)', marginBottom: '5px' }}>קיבולת</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>
                {filled} / {total}
                {available > 0 && <span style={{ color: '#15803d' }}> · {available} פתוחות</span>}
              </div>
              <div style={{ height: '5px', borderRadius: '99px', background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: '99px', width: `${fillPct}%`,
                  background: fillPct >= 100 ? '#94a3b8' : fillPct > 65 ? '#f59e0b' : 'var(--tl-green)',
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )}

          {/* Courses + hired */}
          {(linkedCourses.length > 0 || hiredCount > 0) && (
            <div style={{ marginTop: '12px' }}>
              {linkedCourses.length > 0 && (
                <>
                  <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono,monospace)', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-soft)', marginBottom: '5px' }}>קורסים</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: hiredCount > 0 ? '8px' : '0' }}>
                    {linkedCourses.map((c: any) => (
                      <span key={c.name + c.year} style={{
                        fontSize: '10px', fontFamily: 'var(--font-mono,monospace)', textTransform: 'uppercase', letterSpacing: '0.07em',
                        padding: '2px 8px', borderRadius: '999px', background: 'rgba(122,30,43,0.08)', color: 'var(--accent)',
                      }}>
                        {c.name}{c.year ? ` · ${c.year}` : ''}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {hiredCount > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>
                  <span style={{ fontWeight: 600 }}>👤 {hiredCount} סטודנטים:</span>{' '}
                  {hiredNames.slice(0, 4).join(', ')}{hiredNames.length > 4 ? ` +${hiredNames.length - 4}` : ''}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {emp.notes && (
            <div style={{ marginTop: '12px', gridColumn: '1 / -1' }}>
              <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono,monospace)', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-soft)', marginBottom: '4px' }}>הערות</div>
              <div style={{ fontSize: '12.5px', color: 'var(--text-soft)', lineHeight: 1.6 }}>{emp.notes}</div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* ── Tiny action button ── */
function ActionBtn({ icon, active, title, color, bg, border, onClick }: {
  icon: string; active: boolean; title: string; color: string; bg: string; border: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!active}
      title={title}
      style={{
        width: '30px', height: '30px', borderRadius: '8px', border: `1px solid ${active ? border : 'var(--divider)'}`,
        background: active ? bg : 'transparent', color: active ? color : 'var(--text-soft)',
        cursor: active ? 'pointer' : 'not-allowed', opacity: active ? 1 : 0.35,
        fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      {icon}
    </button>
  );
}

/* ── Approval Queue ── */
function ApprovalQueueSection({ requests, employers, students, courses, placementSettings, data, userName, onRefresh }: {
  requests: EmployerApprovalRequest[];
  employers: Employer[];
  students: Student[];
  courses: any[];
  placementSettings: any;
  data: any;
  userName: string;
  onRefresh: () => void;
}) {
  const [decidedId, setDecidedId] = useState<string | null>(null);
  const [decisionData, setDecisionData] = useState<{
    requestId: string;
    decision: 'student-only' | 'course-wide' | 'rejected';
    student: Student;
    employer: Employer | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const pending = requests.filter(r => r.status === 'pending');
  const decided = requests.filter(r => r.status !== 'pending');

  async function handleDecision(request: EmployerApprovalRequest, decision: 'student-only' | 'course-wide' | 'rejected') {
    const student = students.find(s => s.id === request.requesterStudentId);
    const employer = employers.find(e => e.id === request.resultingEmployerId);
    setSaving(true);
    const now = new Date().toISOString();
    const updatedRequests = (data.employerApprovalRequests || []).map((r: EmployerApprovalRequest) =>
      r.id === request.id
        ? { ...r, status: decision === 'rejected' ? 'rejected' : 'approved', decision, decidedBy: userName, decidedAt: now }
        : r
    );
    let updatedEmployers = [...(data.employers || [])] as Employer[];
    let updatedStudents = [...(data.students || [])] as Student[];
    if (employer) {
      if (decision === 'course-wide') {
        updatedEmployers = updatedEmployers.map(e =>
          e.id === employer.id ? { ...e, approvalStatus: 'approved', restrictedToStudentId: null } as any : e
        );
      } else if (decision === 'student-only') {
        updatedEmployers = updatedEmployers.map(e =>
          e.id === employer.id ? { ...e, approvalStatus: 'approved' } as any : e
        );
      } else if (decision === 'rejected') {
        updatedEmployers = updatedEmployers.map(e => {
          if (e.id !== employer.id) return e;
          const updatedSlots = ((e as any).vacancySlots || []).map((s: any) => {
            if (s.studentId !== request.requesterStudentId || s.status !== 'tentative') return s;
            return { ...s, status: 'available', studentId: null, prefRank: null, history: [...(s.history || []), { at: now, from: 'tentative', to: 'available', by: 'admin', actorId: userName, reason: 'approval-rejected' }] };
          });
          return { ...e, approvalStatus: 'rejected', vacancySlots: updatedSlots } as any;
        });
        if (student) {
          const updatedPrefs = ((student as any).preferences || []).filter((p: any) => p.employerId !== employer.id);
          const noteEntry = `\nהצעת מעסיק "${employer.name}" נדחתה ב-${new Date(now).toLocaleDateString('he-IL')} על ידי ${userName}`;
          updatedStudents = updatedStudents.map(s =>
            s.id === student.id ? { ...s, preferences: updatedPrefs, notes: (s.notes || '') + noteEntry } as any : s
          );
        }
      }
    }
    if (student && decision !== 'rejected') {
      const scope = decision === 'student-only' ? 'לשימוש פרטי שלך' : 'לכל הקורס';
      const noteEntry = `\nהצעת מעסיק "${employer?.name || request.draft.name}" אושרה ${scope} ב-${new Date(now).toLocaleDateString('he-IL')} על ידי ${userName}`;
      updatedStudents = updatedStudents.map(s =>
        s.id === student.id ? { ...s, notes: (s.notes || '') + noteEntry } as any : s
      );
    }
    const res = await saveSnapshot(
      { ...data, employerApprovalRequests: updatedRequests, employers: updatedEmployers, students: updatedStudents },
      { name: userName },
      { action: decision === 'rejected' ? 'נדחה' : 'אושר', entity: 'הצעת מעסיק', target: employer?.name || request.draft.name || '' }
    );
    setSaving(false);
    if (!res.ok) { showToast('שגיאה: ' + (res.error || ''), 'error'); return; }
    showToast('✓ החלטה נרשמה', 'success');
    setDecisionData({ requestId: request.id, decision, student: student!, employer: employer || null });
    setDecidedId(request.id);
    onRefresh();
  }

  if (requests.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="serif text-[22px] mb-2" style={{ color: 'var(--ink)' }}>תור האישורים ריק</div>
        <div className="text-[14px]" style={{ color: 'var(--text-soft)' }}>הצעות מעסיקים חדשות מסטודנטים יופיעו כאן.</div>
      </div>
    );
  }

  return (
    <div>
      {pending.length > 0 && (
        <div className="mb-8">
          <div className="serif text-[20px] mb-4" style={{ color: 'var(--ink)' }}>ממתין לאישור ({pending.length})</div>
          {pending.map(req => {
            const student = students.find(s => s.id === req.requesterStudentId);
            const employer = employers.find(e => e.id === req.resultingEmployerId);
            const course = courses.find((c: any) => c.id === req.courseId);
            const isJustDecided = decidedId === req.id;
            return (
              <div key={req.id} className="rounded-xl border p-4 mb-3"
                style={{ borderColor: 'rgba(217,119,6,0.4)', background: 'rgba(217,119,6,0.06)' }}>
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="font-semibold text-[14px]" style={{ color: 'var(--ink)' }}>{student?.name || 'סטודנט לא ידוע'}</div>
                    <div className="mono text-[11px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
                      {course?.name || ''} · {new Date(req.createdAt).toLocaleDateString('he-IL')}
                    </div>
                  </div>
                  <div className="text-[13.5px]" style={{ color: 'var(--ink)' }}>
                    <strong>{req.draft.name}</strong>
                    {req.draft.contact && <span style={{ color: 'var(--text-soft)' }}> · {req.draft.contact}</span>}
                    {req.draft.phone && <span dir="ltr" style={{ color: 'var(--text-soft)' }}> · {req.draft.phone}</span>}
                    {req.draft.email && <span style={{ color: 'var(--text-soft)' }}> · {req.draft.email}</span>}
                  </div>
                </div>
                {isJustDecided && decisionData ? (
                  <div>
                    <div className="mono text-[11.5px] mb-3 font-semibold" style={{ color: 'var(--accent)' }}>
                      ✓ {decisionData.decision === 'rejected' ? 'נדחה' : decisionData.decision === 'student-only' ? 'אושר לסטודנט בלבד' : 'אושר לכלל הקורס'}
                    </div>
                    {decisionData.decision !== 'rejected' && decisionData.student && (
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => {
                          const st = decisionData.student;
                          const scope = decisionData.decision === 'student-only' ? 'פרטית עבורך' : 'לכל הקורס';
                          const msg = renderTemplate(placementSettings.studentNotifyApprovedTemplateWhatsApp || '', { studentName: st.name, employerName: req.draft.name || '', scope, adminName: userName });
                          if (st.phone) window.open(buildWhatsAppUrl(st.phone, msg), '_blank');
                        }} style={{ ...btnSmall(), background: '#25D366', color: 'white', borderColor: '#25D366' }}>
                          📱 הודע לסטודנט (WhatsApp)
                        </button>
                        <button onClick={() => {
                          const st = decisionData.student;
                          const scope = decisionData.decision === 'student-only' ? 'פרטית עבורך' : 'לכל הקורס';
                          const subject = renderTemplate(placementSettings.studentNotifyApprovedTemplateEmailSubject || '', { employerName: req.draft.name || '' });
                          const body = renderTemplate(placementSettings.studentNotifyApprovedTemplateEmailBody || '', { studentName: st.name, employerName: req.draft.name || '', scope, adminName: userName });
                          if (st.email) window.open(buildMailtoUrl(st.email, subject, body), '_blank');
                        }} style={{ ...btnSmall(), background: '#2563eb', color: 'white', borderColor: '#2563eb' }}>
                          ✉ הודע לסטודנט (Email)
                        </button>
                      </div>
                    )}
                    {decisionData.decision === 'rejected' && decisionData.student && (
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => {
                          const st = decisionData.student;
                          const msg = renderTemplate(placementSettings.studentNotifyRejectedTemplateWhatsApp || '', { studentName: st.name, employerName: req.draft.name || '', adminName: userName });
                          if (st.phone) window.open(buildWhatsAppUrl(st.phone, msg), '_blank');
                        }} style={{ ...btnSmall(), background: '#25D366', color: 'white', borderColor: '#25D366' }}>
                          📱 הודע לסטודנט (WhatsApp)
                        </button>
                        <button onClick={() => {
                          const st = decisionData.student;
                          const subject = renderTemplate(placementSettings.studentNotifyRejectedTemplateEmailSubject || '', { employerName: req.draft.name || '' });
                          const body = renderTemplate(placementSettings.studentNotifyRejectedTemplateEmailBody || '', { studentName: st.name, employerName: req.draft.name || '', adminName: userName });
                          if (st.email) window.open(buildMailtoUrl(st.email, subject, body), '_blank');
                        }} style={{ ...btnSmall(), background: '#2563eb', color: 'white', borderColor: '#2563eb' }}>
                          ✉ הודע לסטודנט (Email)
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleDecision(req, 'student-only')} disabled={saving} style={btnSmall(saving)}>אשר לסטודנט בלבד</button>
                    <button onClick={() => handleDecision(req, 'course-wide')} disabled={saving} style={btnSmall(saving)}>אשר לכלל הקורס</button>
                    <button onClick={() => handleDecision(req, 'rejected')} disabled={saving}
                      style={{ ...btnSmall(saving), color: '#dc2626', borderColor: '#dc2626' }}>דחה</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {decided.length > 0 && (
        <div>
          <div className="serif text-[18px] mb-3" style={{ color: 'var(--ink)' }}>הוחלט ({decided.length})</div>
          {decided.map(req => {
            const student = students.find(s => s.id === req.requesterStudentId);
            const decisionLabel = req.decision === 'student-only' ? 'אושר לסטודנט' : req.decision === 'course-wide' ? 'אושר לכולם' : 'נדחה';
            return (
              <div key={req.id} className="flex items-center gap-3 py-2 border-b" style={{ borderColor: 'var(--divider)' }}>
                <span className="text-[13px] flex-1" style={{ color: 'var(--ink)' }}>{student?.name || '—'} · {req.draft.name}</span>
                <span className="mono text-[10.5px] px-2 py-0.5 rounded-full"
                  style={{
                    background: req.status === 'rejected' ? 'rgba(220,38,38,0.1)' : 'rgba(5,150,105,0.1)',
                    color: req.status === 'rejected' ? '#dc2626' : '#059669',
                  }}>
                  {decisionLabel}
                </span>
                <span className="mono text-[10.5px]" style={{ color: 'var(--text-soft)' }}>
                  {req.decidedAt ? new Date(req.decidedAt).toLocaleDateString('he-IL') : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
