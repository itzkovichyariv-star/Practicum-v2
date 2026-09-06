import { useEffect, useMemo, useRef, useState } from 'react';
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
import { buildWhatsAppUrl, buildMailtoUrl, renderTemplate, openVacancies, totalVacancies, openWhatsApp, setCourseCapacity } from '../lib/placement';
import { openMailto } from '../lib/openMailto';
import { orgAvailability, ORG_PURPLE, employerStatus, STATUS_COLORS, applyEmployerStatus, type ManualStatusKey } from '../lib/orgAvailability';

function empCourseIds(e: Employer): string[] {
  if (e.courseIds && e.courseIds.length > 0) return e.courseIds;
  if (e.courseId) return [e.courseId];
  return [];
}

// Live occupancy context for employerStatus(). Set once per render from the page's own
// data; read by the row/card renderers below. Module-scoped deliberately — threading it
// through six component signatures would touch far more code than the fix warrants, and
// the page is a singleton.
let STATUS_CTX: { students?: any[]; dispatches?: any[] } = {};

// Detail line under an employer's name. The status pill is OVERALL (any year),
// but this chip describes the SELECTED year specifically.
function cardStatusChip(st: any, yearAv: any): string {
  if (st.key === 'rejected') return 'לא רלוונטי';
  if (st.key === 'approved') {
    return yearAv.open > 0 ? `${yearAv.open} מקומות פנויים`
      : (yearAv.total > 0 ? 'מלא בשנה הנבחרת' : 'פנוי בשנה אחרת');
  }
  if (st.key === 'full') return yearAv.total > 0 ? 'מלא בשנה הנבחרת' : 'טרם הוגדרו מקומות לשנה זו';
  if (st.key === 'in_process') return st.note || 'בתהליך מול הארגון';
  return st.detail || (st.missing && st.missing.length ? `חסר ${st.missing.join(' ו')}` : '');
}

// Per-(course×year) rollup: counts of each ramzor status + open places, ALL scoped to
// ONE courseId (a legitimate sum WITHIN a single unit — never across courses/years).
function unitRollup(items: { emp: Employer; courseId: string }[]) {
  const c = { approved: 0, in_review: 0, in_process: 0, not_contacted: 0, full: 0, rejected: 0, open: 0, total: 0 };
  for (const { emp, courseId } of items) {
    const scope = [courseId];
    const k = employerStatus(emp, scope, STATUS_CTX).key as keyof typeof c;
    if (k in c) (c as any)[k] += 1;
    const av = orgAvailability(emp, scope);
    c.open += av.open; c.total += av.total;
  }
  return c;
}
function rollupParts(r: ReturnType<typeof unitRollup>): { label: string; color: string }[] {
  const parts: { label: string; color: string }[] = [];
  if (r.approved) parts.push({ label: `${r.approved} מאושרים`, color: STATUS_COLORS.approved });
  if (r.in_review) parts.push({ label: `${r.in_review} סטודנט/ית בתהליך`, color: STATUS_COLORS.in_review });
  if (r.in_process) parts.push({ label: `${r.in_process} בתהליך מול הארגון`, color: STATUS_COLORS.in_process });
  if (r.not_contacted) parts.push({ label: `${r.not_contacted} טרם`, color: STATUS_COLORS.not_contacted });
  if (r.full) parts.push({ label: `${r.full} מלא`, color: STATUS_COLORS.full });
  if (r.rejected) parts.push({ label: `${r.rejected} נדחו`, color: STATUS_COLORS.rejected });
  parts.push({ label: `${r.open} מקומות פנויים`, color: 'var(--ink)' });
  return parts;
}

// One-tap status control shared by the list row + the grid card. The "current" highlight
// reflects the MANUAL status the coordinator set (not the derived auto-green), so re-picking
// is predictable. Picking writes immediately via onSetStatus (parent → saveSnapshot).
const STATUS_OPTIONS: { key: ManualStatusKey; label: string }[] = [
  { key: 'not_contacted', label: '⚪ טרם' },
  { key: 'in_process', label: '🟠 בתהליך' },
  { key: 'approved', label: '🟢 מאושר' },
  { key: 'rejected', label: '🔴 נדחה' },
];
function manualStatusKey(emp: any): ManualStatusKey {
  if (emp?.approvalStatus === 'rejected') return 'rejected';
  if (emp?.contactStatus === 'approved') return 'approved';
  if (emp?.contactStatus === 'in_process' || emp?.approvalStatus === 'pending') return 'in_process';
  return 'not_contacted';
}
function StatusChips({ current, onPick, onClose }: { current: ManualStatusKey; onPick: (k: ManualStatusKey) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Dismiss on any tap outside the picker — so it never stays stuck open.
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return (
    <div ref={ref} style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '7px' }} onClick={e => e.stopPropagation()}>
      {STATUS_OPTIONS.map(o => {
        const active = o.key === current; const color = (STATUS_COLORS as any)[o.key];
        return (
          <button key={o.key} type="button" onClick={e => { e.stopPropagation(); onPick(o.key); }}
            style={{ fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px', cursor: 'pointer', border: `1px solid ${active ? color : color + '55'}`, background: active ? color + '22' : 'transparent', color, whiteSpace: 'nowrap' }}>
            {o.label}
          </button>
        );
      })}
      <span style={{ fontSize: '10px', color: 'var(--text-soft)' }}>נשמר מיד ✓</span>
      <button type="button" onClick={e => { e.stopPropagation(); onClose(); }} title="סגור"
        style={{ marginInlineStart: 'auto', width: '26px', height: '26px', borderRadius: '999px', border: '1px solid var(--divider)', background: 'transparent', color: 'var(--text-soft)', cursor: 'pointer', fontSize: '13px', lineHeight: 1, flexShrink: 0 }}>✕</button>
    </div>
  );
}

type PosFilter = 'all' | 'open' | 'full' | 'none';
type StatusFilter = 'all' | 'approved' | 'in_review' | 'in_process' | 'rejected' | 'not_contacted';

type ViewMode = 'list' | 'grid';

export default function EmployersPage({ data, context, userName, onRefresh }: PageProps & { data: any }) {
  const [tab, setTab] = useState<'employers' | 'approvals'>('employers');
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<PosFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // Extra (course × year) units pinned for side-by-side comparison, beyond the top-bar
  // context. Empty = show only what the top bar selects. Yariv: "you should only see the
  // org within this year and course UNLESS you add a second view of year+course."
  const [compareUnits, setCompareUnits] = useState<string[]>([]);
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
  STATUS_CTX = { students, dispatches: data.dispatches || [] };

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
        // Raw list from cv_updates; the "handled" filter (dismissedSuggestionIds
        // from the data blob) is applied at RENDER time — `data` may still be
        // loading when this one-shot effect runs, so we must re-filter live.
        setPendingSuggestions(
          [...latestByEmail.values()].filter((r: any) => r.suggested_org?.name && !r.seen_at),
        );
      });
    return () => { alive = false; };
  }, []);

  // Filter out handled suggestions at render time using the CURRENT data blob
  // (dismissedSuggestionIds), so a dismiss persists across reloads/tab-switches.
  const dismissedSuggestionSet = new Set(((data as any).dismissedSuggestionIds || []) as string[]);
  const visibleSuggestions = pendingSuggestions.filter(s => !dismissedSuggestionSet.has(s.id));

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
    // Reserve one place for the affiliated student's course so the org shows as an
    // open vacancy in THEIR list (their first-priority org). Coordinator adjusts later.
    const empWithPlace = student?.courseId ? setCourseCapacity(emp, student.courseId, 1) : emp;
    const updatedEmps = [...all, empWithPlace];
    const updatedStudents = student
      ? students.map(s => s.id === student.id ? { ...s, firstChoiceOrg: o.name, firstChoiceResult: s.firstChoiceResult || 'pending' } as Student : s)
      : students;
    const dismissed = Array.from(new Set([...(((data as any).dismissedSuggestionIds as string[]) || []), sug.id]));
    setSaving(true);
    const res = await saveSnapshot(
      { ...data, employers: updatedEmps, students: updatedStudents, dismissedSuggestionIds: dismissed },
      { name: userName },
      { action: 'אישר הצעת ארגון', entity: 'ארגון', target: o.name }
    );
    setSaving(false);
    if (!res.ok) { showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
    (data.employers as any) = updatedEmps;
    (data.students as any) = updatedStudents;
    (data as any).dismissedSuggestionIds = dismissed;
    supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', sug.id).then(() => {});
    setPendingSuggestions(p => p.filter(x => x.id !== sug.id));
    showToast(student ? '✓ אושר — נוסף כארגון פרטי ונקבע כבחירה ראשונה' : '✓ אושר — נוסף כארגון פרטי', 'success');
    onRefresh();
  }

  async function dismissSuggestion(sug: Suggestion) {
    const dismissed = Array.from(new Set([...(((data as any).dismissedSuggestionIds as string[]) || []), sug.id]));
    setSaving(true);
    const res = await saveSnapshot({ ...data, dismissedSuggestionIds: dismissed }, { name: userName },
      { action: 'דחה הצעת ארגון', entity: 'הצעה', target: sug.suggested_org?.name || sug.email });
    setSaving(false);
    if (!res.ok) { showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
    (data as any).dismissedSuggestionIds = dismissed;
    // Best-effort: also mark the cv_updates row seen (succeeds once the anon policy exists).
    supabase.from('cv_updates').update({ seen_at: new Date().toISOString() }).eq('id', sug.id).then(() => {});
    setPendingSuggestions(p => p.filter(x => x.id !== sug.id));
    showToast('הצעת הארגון נדחתה', 'success');
    onRefresh();
  }

  const years = useMemo(() => {
    const set = new Set<string>();
    courses.forEach((c: any) => c.year && set.add(normalizeYear(c.year)));
    (data.academicYears || []).forEach((y: string) => set.add(normalizeYear(y)));
    return Array.from(set).sort().reverse();
  }, [courses, data.academicYears]);

  // ── (course × year) UNITS in scope ──────────────────────────────────────────
  // The whole page is organized by UNITS = one course-row (course-name × year).
  // The top-bar context resolves to a set of course-row ids; `compareUnits` pins extra
  // ones for a side-by-side view. Capacity/status are ALWAYS counted per single unit —
  // never summed across courses or years.
  const contextUnitIds = useMemo<string[]>(() => (courses as any[])
    .filter((c: any) => {
      if (!c.id) return false;
      if (context.courseId !== '__all__' && !(c.name === context.courseId || c.id === context.courseId)) return false;
      if (context.year !== '__all__' && normalizeYear(c.year || '') !== normalizeYear(context.year)) return false;
      return true;
    })
    .map((c: any) => c.id), [courses, context.courseId, context.year]);

  const unitIds = useMemo<string[]>(() => {
    const set = new Set<string>(contextUnitIds);
    compareUnits.forEach(id => set.add(id));
    return Array.from(set);
  }, [contextUnitIds, compareUnits]);

  // Fan out: ONE entry per (employer × unit it serves that is in scope). An org serving
  // HR + Counseling in the same year yields TWO entries → two rows under two sections.
  const entries = useMemo(() => {
    const unitSet = new Set(unitIds);
    const q = search.trim().toLowerCase();
    const out: { emp: Employer; courseId: string; year: string }[] = [];
    for (const e of all) {
      for (const cid of empCourseIds(e)) {
        if (!unitSet.has(cid)) continue;
        const scope = [cid];
        const av = orgAvailability(e, scope);
        if (posFilter === 'open' && av.open === 0) continue;
        if (posFilter === 'full' && (av.open > 0 || av.total === 0)) continue;
        if (posFilter === 'none' && av.total > 0) continue;
        if (statusFilter !== 'all' && employerStatus(e, scope, STATUS_CTX).key !== statusFilter) continue;
        if (q) {
          const hay = [e.name, e.contactPerson, e.contactEmail, e.location].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push({ emp: e, courseId: cid, year: normalizeYear((courses.find((c: any) => c.id === cid) || {}).year || '') });
      }
    }
    return out;
  }, [all, unitIds, courses, search, posFilter, statusFilter]);

  // Group entries into (course × year) sections. A specifically-selected unit stays
  // visible even when empty (so you see the unit exists); in a multi-unit overview,
  // empty units are dropped to avoid clutter.
  const sections = useMemo(() => {
    const byUnit = new Map<string, { courseId: string; year: string; courseName: string; items: typeof entries }>();
    for (const cid of unitIds) {
      const c = courses.find((x: any) => x.id === cid);
      byUnit.set(cid, { courseId: cid, year: normalizeYear(c?.year || ''), courseName: c?.name || cid, items: [] });
    }
    for (const en of entries) byUnit.get(en.courseId)?.items.push(en);
    let arr = Array.from(byUnit.values());
    // Keep a section even when empty if it was EXPLICITLY targeted — a fully-specified
    // (course × year) context, or a pinned comparison unit — so the user always sees
    // what they selected. Only a BROAD overview (all courses / all years) drops empties.
    const explicit = new Set<string>([
      ...(context.courseId !== '__all__' && context.year !== '__all__' ? contextUnitIds : []),
      ...compareUnits,
    ]);
    if (unitIds.length > 1) arr = arr.filter(u => u.items.length > 0 || explicit.has(u.courseId));
    arr.forEach(u => u.items.sort((x, y) => (x.emp.name || '').localeCompare(y.emp.name || '', 'he')));
    return arr.sort((a, b) => a.year !== b.year ? b.year.localeCompare(a.year, 'he') : a.courseName.localeCompare(b.courseName, 'he'));
  }, [entries, unitIds, courses, context.courseId, context.year, contextUnitIds, compareUnits]);

  const distinctEmployers = useMemo(() => new Set(entries.map(e => e.emp.id)).size, [entries]);
  const multiUnit = sections.length > 1;
  // Course-rows NOT already in the top-bar context — offered as "add a comparison unit".
  const addableUnits = useMemo(() => (courses as any[])
    .filter((c: any) => c.id && !contextUnitIds.includes(c.id))
    .sort((a: any, b: any) => normalizeYear(b.year || '').localeCompare(normalizeYear(a.year || ''), 'he') || (a.name || '').localeCompare(b.name || '', 'he')),
    [courses, contextUnitIds]);

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

  // Auto-save a status-chip click inside the editor AND close the sheet (Yariv: "saving
  // should close the card"). Saves the whole form, so any place/notes edits persist too.
  async function handleQuickSave(e: Employer) {
    const idx = all.findIndex(x => x.id === e.id);
    const next = idx >= 0 ? all.map(x => x.id === e.id ? e : x) : [...all, e];
    setEditing(null); setCreating(false);
    await persistAndRefresh(next, '✓ נשמר ונסגר');
  }

  // One-tap status change from a list row (no editor) — writes identically to the editor chip.
  async function handleSetStatus(empId: string, which: ManualStatusKey) {
    await persistAndRefresh(all.map(e => e.id === empId ? applyEmployerStatus(e, which) as Employer : e), '✓ סטטוס עודכן');
  }

  // Archive = the same 🔴 flag the status chip writes, plus a dated statusHistory entry that
  // SAYS it came from the delete dialog. Until now this path wrote approvalStatus alone, so an
  // org that hosted students and turned red (אקיורט דאטה in משאבי אנוש · תשפ״ו, 2026-09-06)
  // carried no trace of why — the flag is global, and it paints every year's row.
  async function handleArchive(id: string) {
    setEditing(null);
    const at = new Date().toISOString();
    await persistAndRefresh(all.map(e => e.id === id ? {
      ...e, approvalStatus: 'rejected',
      statusHistory: [...((e as any).statusHistory || []), { at, status: 'rejected', note: 'ארכוב מתוך «מחק / ארכב» — לא נמחק כי יש בו סטודנטים' }],
    } as Employer : e), '✓ סומן כנדחה (בארכיון)');
  }

  async function handleDelete(id: string) {
    const emp = all.find(e => e.id === id);
    if (!emp) return;
    // Guard: never orphan students. Only a place held by a student who still EXISTS protects
    // the org. A slot whose student was deleted (or a fixture the audit swept away) stays
    // marked occupied in the ledger, and until now it blocked the delete forever — the audit
    // orgs ("ארגון מוצע ישיר 1786…") could not be removed from this screen for exactly that
    // reason, and the dialog's only button painted them 🔴 instead of deleting them.
    const held = (emp.vacancySlots || []).filter(s => s.status !== 'available' && s.studentId && students.some(st => st.id === s.studentId));
    if (held.length > 0) {
      const names = held.map(s => students.find(st => st.id === s.studentId)?.name).filter(Boolean).join(', ');
      if (confirm(`ל"${emp.name}" יש ${held.length} מקומות תפוסים (${names}) — מחיקה תמחוק את ההיסטוריה שלהם.\n\nלחצו "אישור" כדי לסמן אותו כ«נדחה» (מוסתר משיבוץ, ההיסטוריה נשמרת), או "ביטול" כדי להשאיר ללא שינוי.`)) {
        await handleArchive(id);
      }
      return;
    }
    if (!confirm(`למחוק לצמיתות את "${emp.name}"? פעולה זו אינה הפיכה.`)) return;
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
              {/* Only a distinct-employer count at the top — capacity numbers live in each
                  (course×year) section/health-card, so nothing is ever summed across units. */}
              <StatBox label="ארגונים" value={distinctEmployers} />
              {!multiUnit && sections[0] && (() => {
                const r = unitRollup(sections[0].items);
                return (<>
                  <StatBox label="פתוחות" value={r.open} accent={r.open > 0} />
                  <StatBox label="מאוישות" value={Math.max(0, r.total - r.open)} />
                </>);
              })()}
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
          מעסיקים ({distinctEmployers})
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
            {/* Add another (course × year) to view side by side. Empty context selection
                (all courses / all years) already shows every unit as its own section. */}
            {addableUnits.length > 0 && (
              <select
                value=""
                onChange={e => { const v = e.target.value; if (v) setCompareUnits(u => u.includes(v) ? u : [...u, v]); }}
                className="input"
                style={{ padding: '9px 14px', fontSize: '13px', flex: '0 1 auto', minWidth: '150px' }}
                title="הצג קורס/שנה נוספים להשוואה"
              >
                <option value="">➕ הוסף קורס/שנה להשוואה</option>
                {addableUnits.map((c: any) => (
                  <option key={c.id} value={c.id} disabled={compareUnits.includes(c.id)}>{c.name}{c.year ? ` · ${c.year}` : ''}</option>
                ))}
              </select>
            )}
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
            {/* Status (ramzor) filter */}
            <div className="flex gap-1 p-1 rounded-lg flex-wrap" style={{ background: 'rgba(0,0,0,0.05)' }}>
              {([
                ['all', 'כל הסטטוסים', 'var(--accent)'] as const,
                ['approved', 'מאושר', STATUS_COLORS.approved] as const,
                ['in_review', 'סטודנט/ית בתהליך', STATUS_COLORS.in_review] as const,
                ['in_process', 'בתהליך מול הארגון', STATUS_COLORS.in_process] as const,
                ['not_contacted', 'טרם', STATUS_COLORS.not_contacted] as const,
                ['rejected', 'נדחה', STATUS_COLORS.rejected] as const,
              ]).map(([v, label, activeBg]) => (
                <button key={v} onClick={() => setStatusFilter(v)}
                  className="mono text-[10.5px] uppercase tracking-[0.1em] font-semibold px-3 py-1.5 rounded flex items-center gap-1.5"
                  style={{ background: statusFilter === v ? activeBg : 'transparent', color: statusFilter === v ? 'white' : 'var(--text-soft)', border: 'none', cursor: 'pointer' }}>
                  {v !== 'all' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusFilter === v ? 'white' : activeBg, flexShrink: 0 }} />}
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
          {visibleSuggestions.length > 0 && (
            <div className="mb-6 rounded-xl p-4" style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid var(--accent)' }}>
              <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
                ⚠ {visibleSuggestions.length} {visibleSuggestions.length === 1 ? 'הצעת ארגון מהמועמדים' : 'הצעות ארגון מהמועמדים'} — דרוש אישור
              </div>
              <div className="space-y-3">
                {visibleSuggestions.map(sug => {
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

          {/* Pinned comparison units (removable) */}
          {compareUnits.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono,monospace)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-soft)' }}>השוואה:</span>
              {compareUnits.map(cid => {
                const c = courses.find((x: any) => x.id === cid); if (!c) return null;
                return (
                  <span key={cid} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, padding: '4px 8px 4px 11px', borderRadius: '999px', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    {c.name}{c.year ? ` · ${c.year}` : ''}
                    <button type="button" onClick={() => setCompareUnits(u => u.filter(x => x !== cid))} title="הסר" style={{ border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: '15px', lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                );
              })}
              <button type="button" onClick={() => setCompareUnits([])} style={{ fontSize: '11px', color: 'var(--text-soft)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>נקה</button>
            </div>
          )}

          {/* Health board — one summary card per (course × year) when several are in view */}
          {multiUnit && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '22px' }}>
              {sections.map(sec => {
                const r = unitRollup(sec.items);
                return (
                  <button key={sec.courseId} type="button"
                    onClick={() => document.getElementById(`unit-${sec.courseId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    style={{ textAlign: 'start', cursor: 'pointer', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--divider)', borderRadius: '12px', padding: '12px 14px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)', marginBottom: '7px' }}>
                      {sec.courseName} <span style={{ fontSize: '11px', color: 'var(--accent)' }}>· {sec.year}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12px' }}>
                      {rollupParts(r).map((p, i) => <span key={i} style={{ color: p.color, fontWeight: 600 }}>{p.label}</span>)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend — ramzor dot meanings */}
          {entries.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', marginBottom: '16px', padding: '9px 14px', borderRadius: '10px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--divider)', fontSize: '12px', color: 'var(--text-soft)' }}>
              <span style={{ fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '11px' }}>מקרא</span>
              {([['approved', 'מאושר'], ['in_review', 'סטודנט/ית בתהליך'], ['in_process', 'בתהליך מול הארגון'], ['not_contacted', 'טרם פניתי'], ['full', 'מלא'], ['rejected', 'נדחה']] as const).map(([k, label]) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: (STATUS_COLORS as any)[k], flexShrink: 0 }} /> {label}
                </span>
              ))}
              {(() => { const na = entries.filter(en => { const k = employerStatus(en.emp, [en.courseId], STATUS_CTX).key; return k !== 'approved' && k !== 'rejected'; }).length; return na > 0
                ? <span style={{ marginInlineStart: 'auto', fontWeight: 700, color: STATUS_COLORS.in_process }}>⚠ {na} טרם מוכנים לשיבוץ</span>
                : <span style={{ marginInlineStart: 'auto', fontWeight: 700, color: STATUS_COLORS.approved }}>✓ כל המעסיקים מאושרים</span>; })()}
            </div>
          )}

          {/* Employer sections — one per (course × year), never summed across units */}
          {sections.length === 0 || sections.every(s => s.items.length === 0) && unitIds.length !== 1 ? (
            <div className="py-24 text-center">
              <div className="serif text-[26px]" style={{ color: 'var(--ink)' }}>אין מעסיקים להצגה</div>
              <div className="mt-3 text-[14px]" style={{ color: 'var(--text-soft)' }}>שנה סינון, בחר/י קורס ושנה, או הוסף/י מעסיק חדש.</div>
            </div>
          ) : (
            sections.map(sec => {
              const r = unitRollup(sec.items);
              return (
                <section key={sec.courseId} id={`unit-${sec.courseId}`} style={{ marginBottom: '30px', scrollMarginTop: '96px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingTop: '6px', paddingBottom: '8px', borderBottom: '2px solid var(--divider)', marginBottom: '9px' }}>
                    <span className="serif" style={{ fontSize: '19px', color: 'var(--ink)' }}>{sec.courseName}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 10px', borderRadius: '999px', background: 'var(--accent-soft)', color: 'var(--accent)' }}>{sec.year || '—'}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-soft)' }}>· {sec.items.length} מעסיקים</span>
                    {compareUnits.includes(sec.courseId) && (
                      <button type="button" onClick={() => setCompareUnits(u => u.filter(x => x !== sec.courseId))} title="הסר מההשוואה"
                        style={{ marginInlineStart: 'auto', fontSize: '11px', color: 'var(--text-soft)', background: 'transparent', border: '1px solid var(--divider)', borderRadius: '999px', padding: '2px 10px', cursor: 'pointer' }}>× הסר</button>
                    )}
                  </div>
                  {sec.items.length > 0 && (
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12.5px', marginBottom: '11px' }}>
                      {rollupParts(r).map((p, i) => <span key={i} style={{ color: p.color, fontWeight: 600 }}>{p.label}</span>)}
                    </div>
                  )}
                  {sec.items.length === 0 ? (
                    <div style={{ padding: '22px', textAlign: 'center', color: 'var(--text-soft)', fontSize: '13px', border: '1px dashed var(--divider)', borderRadius: '12px' }}>אין מעסיקים ל(קורס × שנה) זה עדיין.</div>
                  ) : viewMode === 'list' ? (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--divider)', borderRadius: '14px', overflow: 'hidden' }}>
                      {sec.items.map((en, idx) => {
                        const hiredHere = students.filter(s => s.acceptedOrg === en.emp.name && s.courseId === en.courseId);
                        const linkedCourses = empCourseIds(en.emp).map(cid => courses.find((c: any) => c.id === cid)).filter(Boolean) as any[];
                        const privateFor = (en.emp as any).restrictedToStudentId ? (students.find(s => s.id === (en.emp as any).restrictedToStudentId)?.name || null) : null;
                        return (
                          <EmployerRow key={en.emp.id + '|' + en.courseId} emp={en.emp}
                            hiredCount={hiredHere.length} hiredNames={hiredHere.map(s => s.name)}
                            linkedCourses={linkedCourses} privateFor={privateFor}
                            isLast={idx === sec.items.length - 1} scopeCourseIds={[en.courseId]}
                            onSetStatus={handleSetStatus}
                            onEdit={() => setEditing(en.emp)} onDelete={() => handleDelete(en.emp.id)} />
                        );
                      })}
                    </ul>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '16px' }}>
                      {sec.items.map(en => {
                        const hiredHere = students.filter(s => s.acceptedOrg === en.emp.name && s.courseId === en.courseId);
                        const linkedCourses = empCourseIds(en.emp).map(cid => courses.find((c: any) => c.id === cid)).filter(Boolean) as any[];
                        const privateFor = (en.emp as any).restrictedToStudentId ? (students.find(s => s.id === (en.emp as any).restrictedToStudentId)?.name || null) : null;
                        return (
                          <EmployerCard key={en.emp.id + '|' + en.courseId} emp={en.emp}
                            hiredCount={hiredHere.length} hiredNames={hiredHere.map(s => s.name)}
                            linkedCourses={linkedCourses} privateFor={privateFor}
                            scopeCourseIds={[en.courseId]}
                            onSetStatus={handleSetStatus}
                            onEdit={() => setEditing(en.emp)} onDelete={() => handleDelete(en.emp.id)} />
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </>
      )}

      {(editing || creating) && (
        <EmployerEditor
          employer={editing}
          courses={courses}
          years={years}
          students={students}
          defaultCourseId={context.courseId}
          defaultYear={context.year}
          onSave={handleSave}
          onQuickSave={handleQuickSave}
          onDelete={editing ? handleDelete : undefined}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </main>
  );
}

/* ── Employer card (grid view) ── */
function EmployerCard({ emp, hiredCount, hiredNames, linkedCourses, privateFor, scopeCourseIds, onSetStatus, onEdit, onDelete }: {
  emp: Employer; hiredCount: number; hiredNames: string[];
  linkedCourses: { name: string; year?: string; id?: string }[];
  privateFor?: string | null;
  scopeCourseIds?: string[];
  onSetStatus?: (id: string, k: ManualStatusKey) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  // Every row is scoped to ONE (course × year) unit (scopeCourseIds is a single-id array),
  // so dot + pill + capacity all describe THAT unit — never summed across courses/years.
  const st = employerStatus(emp, scopeCourseIds, STATUS_CTX);
  const av = orgAvailability(emp);               // unscoped — only for the `isPending` flag
  const yearAv = orgAvailability(emp, scopeCourseIds);
  const { isPending } = av;
  const { total, filled } = yearAv; // capacity bar is per (year × course), like 'open'
  const open = yearAv.open;
  const fillPct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;
  const dotColor = st.color;
  const dotLabel = cardStatusChip(st, yearAv);
  // One vivid status colour drives dot + pill + glow so they always MATCH (Yariv:
  // "the dots don't match the statuses"). Big + glowing like the tasks-app ramzor.
  const isApproved = st.key === 'approved';
  const dotFill = st.color;
  const dotGlow = isApproved
    ? `0 0 0 3px ${st.color}2e, 0 0 10px ${st.color}99`   // green: unmistakable halo
    : `0 0 0 2.5px ${st.color}30`;                        // others: a clean ring
  const hasFooter = linkedCourses.length > 0 || hiredCount > 0;

  function callEmployer() { if (emp.contactPhone) window.location.href = `tel:${emp.contactPhone.replace(/[^\d+]/g, '')}`; }
  function whatsappEmployer() {
    openWhatsApp(emp.contactPhone || '', { name: emp.name });
  }
  function emailEmployer() {
    if (emp.contactEmail) openMailto(`mailto:${encodeURIComponent(emp.contactEmail)}?subject=${encodeURIComponent(`פרקטיקום — ${emp.name}`)}&body=${encodeURIComponent(`שלום ${emp.contactPerson || ''},\n\n`)}`);
  }

  return (
    <div style={{ borderRadius: '16px', border: `1px solid ${isPending ? 'rgba(217,119,6,0.4)' : 'var(--divider)'}`, background: 'var(--bg)', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--divider)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <div style={{ flexShrink: 0, width: '22px', height: '22px', borderRadius: '50%', background: dotFill, boxShadow: dotGlow }} title={dotLabel} />
            <div className="serif text-[17px] leading-tight" style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</div>
            <button type="button" onClick={onSetStatus ? () => setStatusOpen(o => !o) : undefined}
              title={onSetStatus ? 'שנה סטטוס' : undefined}
              style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.04em', padding: '3px 9px', borderRadius: '999px', background: st.color + '1f', color: st.color, border: `1px solid ${st.color}3a`, whiteSpace: 'nowrap', cursor: onSetStatus ? 'pointer' : 'default' }}>
              {st.label}{onSetStatus && <span style={{ fontSize: '8px', opacity: 0.7 }}> ▾</span>}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
            <button type="button" onClick={onEdit} style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, background: 'transparent', color: 'var(--text-soft)', border: '1px solid var(--divider)', borderRadius: '999px', cursor: 'pointer', fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.1em' }}>עריכה</button>
            <button type="button" onClick={onDelete} title="מחק / ארכב" style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 600, background: 'transparent', color: STATUS_COLORS.rejected, border: `1px solid ${STATUS_COLORS.rejected}55`, borderRadius: '999px', cursor: 'pointer' }}>🗑</button>
          </div>
        </div>
        {emp.location && <div style={{ fontSize: '12px', color: 'var(--text-soft)', paddingRight: '17px' }}>📍 {emp.location}</div>}
        {privateFor && (
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)', paddingRight: '17px', marginTop: '3px' }}
            title={`ארגון פרטי — גלוי רק ל${privateFor} כבחירה ראשונה`}>
            🔒 פרטי ל{privateFor}
          </div>
        )}
        <div style={{ fontSize: '10.5px', fontWeight: 600, fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.1em', color: dotColor, paddingRight: '17px', marginTop: '2px', textTransform: 'uppercase' }}>{dotLabel}</div>
        {st.explain && (
          <div data-employer-explain={st.key}
            style={{ fontSize: '13.5px', fontWeight: 600, lineHeight: 1.5, color: 'var(--ink)', paddingRight: '17px', marginTop: '5px' }}>
            {st.explain}
          </div>
        )}
        {onSetStatus && statusOpen && (
          <StatusChips current={manualStatusKey(emp)} onPick={(k) => { onSetStatus(emp.id, k); setStatusOpen(false); }} onClose={() => setStatusOpen(false)} />
        )}
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
function EmployerRow({ emp, hiredCount, hiredNames, linkedCourses, privateFor, isLast, scopeCourseIds, onSetStatus, onEdit, onDelete }: {
  emp: Employer; hiredCount: number; hiredNames: string[];
  linkedCourses: { name: string; year?: string; id?: string }[];
  privateFor?: string | null;
  isLast: boolean;
  scopeCourseIds?: string[];
  onSetStatus?: (id: string, k: ManualStatusKey) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  // Scoped to ONE (course × year) unit (scopeCourseIds is a single-id array): dot + pill +
  // capacity + detail all describe THAT unit only — never summed across courses/years.
  const st = employerStatus(emp, scopeCourseIds, STATUS_CTX);
  const av = orgAvailability(emp);               // unscoped — only for the `isPending` flag
  const yearAv = orgAvailability(emp, scopeCourseIds);
  const { isPending } = av;
  const { total, filled } = yearAv; // capacity bar is per (year × course), like 'open'
  const available = yearAv.open; // selected-year open count for display
  const fillPct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;
  const dotColor = st.color;
  const posLabel = st.label;
  // Same vivid single-source dot as the card (see CardHeader): dot + pill + glow all
  // read from st.color, big + glowing like the tasks-app ramzor.
  const isApproved = st.key === 'approved';
  const dotFill = st.color;
  const dotGlow = isApproved
    ? `0 0 0 3px ${st.color}2e, 0 0 10px ${st.color}99`
    : `0 0 0 2.5px ${st.color}30`;
  const statusChip = cardStatusChip(st, yearAv);

  function callEmployer() {
    if (!emp.contactPhone) return;
    window.location.href = `tel:${emp.contactPhone.replace(/[^\d+]/g, '')}`;
  }
  function whatsappEmployer() {
    openWhatsApp(emp.contactPhone || '', { name: emp.name });
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
      {/* ── Collapsed row: stacked so nothing is ever cut off on mobile ── */}
      <div style={{ padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setOpen(o => !o)}>
        {/* Line 1: dot + name + status pill + chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <div style={{ flexShrink: 0, width: '22px', height: '22px', borderRadius: '50%', background: dotFill, boxShadow: dotGlow }} title={posLabel} />
          <div className="serif" style={{ flex: 1, minWidth: 0, fontSize: '15.5px', fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {emp.name}
          </div>
          <button type="button" onClick={onSetStatus ? (e) => { e.stopPropagation(); setStatusOpen(o => !o); } : undefined}
            title={onSetStatus ? 'שנה סטטוס' : (st.note || st.label)}
            style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-mono,monospace)', letterSpacing: '0.04em', padding: '3px 10px', borderRadius: '999px', background: st.color + '1f', color: st.color, border: `1px solid ${st.color}3a`, whiteSpace: 'nowrap', cursor: onSetStatus ? 'pointer' : 'default' }}>
            {st.label}{onSetStatus && <span style={{ fontSize: '8px', opacity: 0.7 }}> ▾</span>}
          </button>
          <div style={{ flexShrink: 0, fontSize: '12px', color: 'var(--text-soft)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>▾</div>
        </div>

        {/* One-tap status picker (inline, no clipping) */}
        {onSetStatus && statusOpen && (
          <div style={{ paddingInlineStart: '31px' }}>
            <StatusChips current={manualStatusKey(emp)} onPick={(k) => { onSetStatus(emp.id, k); setStatusOpen(false); }} onClose={() => setStatusOpen(false)} />
          </div>
        )}

        {/* Line 2: THE explanation. Yariv 2026-08-09: "the line that explains the status
            is the one that is most important" — so it is full ink at 14px, above the pill
            in the hierarchy, and it wraps rather than truncating. Who, what, how long. */}
        {st.explain && (
          <div data-employer-explain={st.key}
            style={{ marginTop: '5px', paddingInlineStart: '31px', fontSize: '14px', fontWeight: 600, lineHeight: 1.55, color: 'var(--ink)' }}>
            {st.explain}
          </div>
        )}
        {statusChip && statusChip !== st.explain && (
          <div style={{ marginTop: '3px', paddingInlineStart: '31px', fontSize: '11.5px', fontFamily: 'var(--font-mono,monospace)', fontWeight: 600, color: st.color, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={statusChip}>
            {statusChip}
          </div>
        )}
        {privateFor && (
          <div style={{ marginTop: '4px', paddingInlineStart: '31px', fontSize: '11px', fontWeight: 600, color: 'var(--accent)' }}
            title={`ארגון פרטי — גלוי רק ל${privateFor} כבחירה ראשונה`}>
            🔒 פרטי ל{privateFor}
          </div>
        )}
        {(emp.contactPerson || emp.location) && (
          <div className="hidden md:block" style={{ marginTop: '3px', paddingInlineStart: '31px', fontSize: '12px', color: 'var(--text-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[emp.contactPerson, emp.location && `📍 ${emp.location}`].filter(Boolean).join(' · ')}
          </div>
        )}

        {/* Line 3: actions — wrap, never cut off; edit is a prominent filled button */}
        <div style={{ marginTop: '10px', paddingInlineStart: '31px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
          <ActionBtn icon="📞" active={!!emp.contactPhone} title={emp.contactPhone || 'אין טלפון'} color="var(--accent)" bg="rgba(122,30,43,0.07)" border="rgba(122,30,43,0.25)" onClick={callEmployer} />
          <ActionBtn icon="📱" active={!!emp.contactPhone} title="WhatsApp" color="#15803d" bg="rgba(37,211,102,0.08)" border="rgba(37,211,102,0.4)" onClick={whatsappEmployer} />
          <ActionBtn icon="✉" active={!!emp.contactEmail} title={emp.contactEmail || 'אין מייל'} color="#1d4ed8" bg="rgba(37,99,235,0.07)" border="rgba(37,99,235,0.3)" onClick={emailEmployer} />
          <button type="button" onClick={e => { e.stopPropagation(); onEdit(); }}
            style={{ padding: '6px 15px', fontSize: '12px', fontWeight: 700, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer', letterSpacing: '0.03em' }}>
            ✎ עריכה
          </button>
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {open && (
        <div style={{
          padding: '0 18px 16px 38px',
          borderTop: '1px solid var(--divider)',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px',
        }}>
          {/* Close the expanded card */}
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-start', marginTop: '10px' }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); }} title="סגור כרטיס"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 600, padding: '4px 12px', borderRadius: '999px', border: '1px solid var(--divider)', background: 'transparent', color: 'var(--text-soft)', cursor: 'pointer' }}>✕ סגור</button>
          </div>

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

          {/* Manage: edit + delete/archive (guarded — won't orphan placed students) */}
          <div style={{ gridColumn: '1 / -1', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--divider)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" onClick={onEdit} style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 12px', borderRadius: '999px', border: '1px solid var(--divider)', background: 'transparent', color: 'var(--text-soft)', cursor: 'pointer' }}>✎ ערוך פרטים</button>
            <button type="button" onClick={onDelete} style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 12px', borderRadius: '999px', border: `1px solid ${STATUS_COLORS.rejected}55`, background: 'transparent', color: STATUS_COLORS.rejected, cursor: 'pointer' }}>🗑 מחק / ארכב</button>
          </div>
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
