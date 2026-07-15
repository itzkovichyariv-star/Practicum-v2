import { useState, useEffect, useRef, type FormEvent } from 'react';
import type { Employer, Course } from '../lib/supabase';
import { randomId } from '../lib/dataApi';
import { openMailto } from '../lib/openMailto';
import { setCourseCapacity, countSlotsByStatus, reconcileEmployerCapacity, openWhatsApp as waOpen } from '../lib/placement';
import { employerStatus, STATUS_COLORS } from '../lib/orgAvailability';
import { normalizeYear } from './pageShared';
import Modal from './Modal';

type Props = {
  employer: Employer | null;
  courses: Course[];
  years: string[];
  students?: any[];
  defaultCourseId?: string;
  defaultYear?: string;
  onSave: (e: Employer) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
};

export default function EmployerEditor({
  employer, courses, years, students = [], defaultCourseId, defaultYear, onSave, onDelete, onClose,
}: Props) {
  const isNew = !employer;

  // Resolve courseIds: prefer new field, fall back to legacy courseId
  const initialCourseIds: string[] = employer?.courseIds
    ? employer.courseIds
    : employer?.courseId
      ? [employer.courseId]
      : defaultCourseId && defaultCourseId !== '__all__'
        ? [defaultCourseId]
        : [];

  // Spread the whole employer FIRST so fields the editor doesn't surface
  // (vacancySlots, approvalStatus, positionsTotal, restrictedToStudentId, addedBy,
  // legacy courseId/year) are preserved on save — otherwise editing here wipes the
  // per-course slot ledger.
  const [form, setForm] = useState<Employer>({
    ...(employer || {}),
    id: employer?.id || randomId('emp'),
    name: employer?.name || '',
    contactPerson: employer?.contactPerson || '',
    contactPhone: employer?.contactPhone || '',
    contactEmail: employer?.contactEmail || '',
    location: employer?.location || '',
    notes: employer?.notes || '',
    courseIds: initialCourseIds,
    vacancySlots: employer?.vacancySlots || [],
  } as Employer);

  function update<K extends keyof Employer>(k: K, v: Employer[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  const [showAllCourses, setShowAllCourses] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Which courses to SHOW in the capacity control. Places are per (course × year),
  // so by DEFAULT we surface ONLY the (year × course) the coordinator is working on
  // — driven by the top-bar year+course context. Placements from PAST years (an
  // attached course in a different year) are history: hidden until `showHistory` is
  // on. `showAllCourses` reveals every course, to attach a new one.
  const scopeYear = defaultYear && defaultYear !== '__all__' ? normalizeYear(defaultYear) : null;
  const scopeCourse = defaultCourseId && defaultCourseId !== '__all__' ? defaultCourseId : null;
  const hasScope = !!(scopeYear || scopeCourse);
  // (course × year) scope for the STATUS PILL — mirrors EmployersPage.yearCourseIds,
  // defaulting to the LATEST year when the top bar is on __all__ (like the list). This
  // stops the pill from summing places across other courses/years ("pill says 4 while
  // the row shows 2").
  const effYear = scopeYear || (years && years.length ? normalizeYear(years[0]) : null);
  const scopeCourseIds = (() => {
    let cs = courses;
    if (effYear) cs = cs.filter(c => normalizeYear(c.year || '') === effYear);
    if (scopeCourse) cs = cs.filter(c => c.id === scopeCourse || c.name === scopeCourse);
    return cs.length ? cs.map(c => c.id) : undefined;
  })();
  const attachedIds = new Set(form.courseIds || []);
  const inScope = (c: Course) =>
    (!scopeCourse || c.id === scopeCourse || c.name === scopeCourse) &&
    (!scopeYear || normalizeYear(c.year || '') === scopeYear);
  // An attached course OUTSIDE the selected scope = a past/other-year record (history).
  const isPast = (c: Course) => attachedIds.has(c.id) && !inScope(c);
  const hasHistory = hasScope && courses.some(isPast);
  const visibleCourses = courses.filter(c => {
    if (showAllCourses) return true;
    if (hasScope) return inScope(c) || (showHistory && attachedIds.has(c.id));
    return attachedIds.has(c.id); // no context selected → show attached (all years)
  });
  const hiddenCount = courses.length - visibleCourses.length;
  const coursesByYear = (() => {
    const map = new Map<string, Course[]>();
    for (const c of visibleCourses) {
      const y = c.year || '—';
      if (!map.has(y)) map.set(y, []);
      map.get(y)!.push(c);
    }
    return Array.from(map.keys()).sort().reverse().map(y => [y, map.get(y)!] as const);
  })();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { alert('שם הארגון חסר'); return; }
    onSave(form);
  }

  function openOutlook() {
    if (!form.contactEmail) { alert('אין מייל איש קשר'); return; }
    const subject = encodeURIComponent(`פרקטיקום משאבי אנוש — ${form.name}`);
    const body = encodeURIComponent(`שלום ${form.contactPerson || ''},\n\n`);
    openMailto(`mailto:${encodeURIComponent(form.contactEmail)}?subject=${subject}&body=${body}`);
  }

  function openCall() {
    if (!form.contactPhone) { alert('אין טלפון איש קשר'); return; }
    window.location.href = `tel:${form.contactPhone.replace(/[^\d+]/g, '')}`;
  }

  function openWhatsApp() {
    waOpen(form.contactPhone || '', { name: form.name });
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-[780px]">
        <form onSubmit={handleSubmit} className="px-5 py-7 md:px-10 md:py-10">

          <div className="flex items-start justify-between gap-8 pb-6 border-b mb-8" style={{ borderColor: 'var(--divider)' }}>
            <div>
              <div className="chapter-mark mb-2">{isNew ? 'מעסיק חדש' : 'עריכת מעסיק'}</div>
              <h2 className="serif text-[32px] leading-[1.1] tracking-tight" style={{ color: 'var(--ink)' }}>
                {form.name || 'הוסף שם ארגון'}
              </h2>
            </div>
            <button type="button" onClick={onClose} className="mono text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">סגור ✕</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="col-span-full">
              <Field label="שם הארגון"><Input value={form.name} onChange={v=>update('name',v)} required/></Field>
            </div>
            <Field label="איש קשר"><Input value={form.contactPerson||''} onChange={v=>update('contactPerson',v)}/></Field>
            <Field label="מיקום"><Input value={form.location||''} onChange={v=>update('location',v)} placeholder="עיר / איזור"/></Field>
            <Field label="טלפון איש קשר"><Input type="tel" value={form.contactPhone||''} onChange={v=>update('contactPhone',v)}/></Field>
            <Field label="מייל איש קשר"><Input type="email" value={form.contactEmail||''} onChange={v=>update('contactEmail',v)}/></Field>

            <div className="col-span-full">
              <span className="small-caps block mb-2" style={{ letterSpacing: '0.12em' }}>מקומות התנסות — לפי שנה וקורס</span>
              <div className="text-[11.5px] mb-3" style={{ color: 'var(--text-soft)', lineHeight: 1.5 }}>
                כל שנה וכל קורס נספרים בנפרד. שיוך קורס פותח שדה מקומות (מתחיל מ‑0). מקום תפוס מוצג עם שם המשובץ ונשמר כהיסטוריה — אפשר לערוך בחופשיות את המקומות של שנה אחרת מבלי לפגוע בשיבוץ קיים.
              </div>
              <div className="flex flex-col gap-4">
                {coursesByYear.map(([year, yearCourses]) => (
                  <div key={year}>
                    <div className="mono text-[11px] font-bold mb-2 pb-1 border-b" style={{ color: 'var(--ink)', letterSpacing: '0.1em', borderColor: 'var(--divider)' }}>
                      {year}
                    </div>
                    <div className="flex flex-col gap-2">
                      {yearCourses.map(c => {
                        const attached = (form.courseIds || []).includes(c.id);
                        const cnt = countSlotsByStatus(form, c.id);
                        const occupied = cnt.tentative + cnt.under_review + cnt.placed;
                        const occupants = (form.vacancySlots || []).filter((s: any) => s.courseId === c.id && s.status !== 'available');
                        return (
                          <div key={c.id} className="rounded-lg border px-3 py-2.5"
                            style={{ borderColor: attached ? 'var(--accent)' : 'var(--divider)', background: attached ? 'rgba(122,30,43,0.04)' : 'transparent' }}>
                            <div className="flex items-center gap-3 flex-wrap">
                              <label className="flex items-center gap-2 cursor-pointer" style={{ flex: '1 1 150px', minWidth: 0 }}>
                                <input type="checkbox" checked={attached} style={{ accentColor: 'var(--accent)' }}
                                  onChange={e => {
                                    if (e.target.checked) { update('courseIds', [...(form.courseIds || []), c.id]); return; }
                                    if (occupied > 0) {
                                      alert(`לא ניתן לבטל שיוך ל"${c.name}" (${year}) — ${occupied} מקומות תפוסים. זהו שיבוץ קיים שנשמר כהיסטוריה. לעריכת המקומות של שנה אחרת השתמש/י בשורה של אותה שנה.`);
                                      return;
                                    }
                                    setForm(f => reconcileEmployerCapacity({
                                      ...f,
                                      courseIds: (f.courseIds || []).filter(id => id !== c.id),
                                      vacancySlots: (f.vacancySlots || []).filter((s: any) => s.courseId !== c.id),
                                    }));
                                  }} />
                                <span className="text-[13.5px] font-medium truncate" style={{ color: 'var(--ink)' }}>{c.name}</span>
                              </label>
                              {attached && (
                                <>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>מקומות</span>
                                    <CapacityStepper value={cnt.total} min={occupied}
                                      onChange={n => setForm(f => setCourseCapacity(f, c.id, n))} />
                                  </div>
                                  <span className="mono text-[11px] shrink-0" style={{ color: cnt.available > 0 ? '#15803d' : 'var(--text-soft)' }}>
                                    {cnt.available} פנויים{occupied > 0 ? ` · ${occupied} תפוסים` : ''}
                                  </span>
                                </>
                              )}
                            </div>
                            {attached && occupants.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2" style={{ paddingInlineStart: '26px' }}>
                                {occupants.map((s: any, i: number) => {
                                  const stu = students.find((x: any) => String(x.id) === String(s.studentId));
                                  const label = s.status === 'placed' ? 'משובץ' : s.status === 'under_review' ? 'בבדיקה' : 'מועמד';
                                  return (
                                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--text-soft)' }}>
                                      👤 {stu?.name || `#${s.studentId}`} · {label}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {coursesByYear.length === 0 && (
                <div className="text-[13px] px-3 py-3 rounded-lg border" style={{ color: 'var(--text-soft)', borderColor: 'var(--divider)', background: 'rgba(0,0,0,0.02)' }}>
                  אין קורסים להצגה בהקשר הנוכחי. לחצ/י «הצג את כל הקורסים» כדי לשייך קורס.
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4 mt-3">
                {hasHistory && !showAllCourses && (
                  <button type="button" onClick={() => setShowHistory(v => !v)}
                    className="mono text-[11px]" style={{ color: 'var(--text-soft)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    {showHistory ? '▴ הסתר היסטוריה' : '🕐 הצג היסטוריה (שנים קודמות)'}
                  </button>
                )}
                {(hiddenCount > 0 || showAllCourses) && (
                  <button type="button" onClick={() => setShowAllCourses(v => !v)}
                    className="mono text-[11px]" style={{ color: 'var(--accent)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    {showAllCourses ? '▴ הצג רק את הקורס/שנה שנבחרו' : `▾ הצג את כל הקורסים (עוד ${hiddenCount})`}
                  </button>
                )}
              </div>
            </div>

            <div className="col-span-full">
              <Field label="הערות">
                <textarea value={form.notes||''} onChange={e=>update('notes', e.target.value)}
                  rows={2} className="input w-full" style={{ padding:'10px 14px', fontSize:'14px', resize:'vertical' }} />
              </Field>
            </div>

            <div className="col-span-full">
              <span className="small-caps block mb-2" style={{ letterSpacing: '0.12em' }}>סטטוס מעסיק (רמזור)</span>
              {(() => {
                const st = employerStatus(form, scopeCourseIds);
                const isRejected = form.approvalStatus === 'rejected';
                const isApproved = !isRejected && (form as any).contactStatus === 'approved';
                const isInProcess = !isRejected && !isApproved && (form.contactStatus === 'in_process' || form.approvalStatus === 'pending');
                const isNotContacted = !isRejected && !isApproved && !isInProcess;
                const STATUS_LABELS: Record<string, string> = { not_contacted: 'טרם פניתי', in_process: 'בתהליך', approved: 'מאושר', rejected: 'נדחה' };
                // Setting a status LOGS a dated entry to statusHistory (only on a real
                // change), so the בתהליך↔מאושר ping-pong is preserved with its notes.
                const setStatus = (which: 'not_contacted' | 'in_process' | 'approved' | 'rejected') => setForm(f => {
                  const cur = f.approvalStatus === 'rejected' ? 'rejected'
                    : (f as any).contactStatus === 'approved' ? 'approved'
                    : (f.contactStatus === 'in_process' || f.approvalStatus === 'pending') ? 'in_process' : 'not_contacted';
                  if (which === cur) return f;
                  const statusHistory = [...((f as any).statusHistory || []), { at: new Date().toISOString(), status: which, note: String(f.statusNote || '').trim() }];
                  if (which === 'rejected') return { ...f, approvalStatus: 'rejected', statusHistory } as any;
                  if (which === 'approved') return { ...f, contactStatus: 'approved', approvalStatus: 'approved', statusHistory } as any;
                  return { ...f, contactStatus: which, approvalStatus: f.approvalStatus === 'rejected' ? 'approved' : f.approvalStatus, statusHistory } as any;
                });
                const chip = (active: boolean, color: string, label: string, onClick: () => void) => (
                  <button type="button" onClick={onClick}
                    className="text-[12.5px] font-semibold px-3 py-2 rounded-lg border"
                    style={{ borderColor: active ? color : 'var(--divider)', background: active ? color + '18' : 'transparent', color: active ? color : 'var(--text-soft)', cursor: 'pointer' }}>
                    {label}
                  </button>
                );
                const history = [...((form as any).statusHistory || [])].reverse();
                return (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg" style={{ background: st.color + '12' }}>
                      <span style={{ width: 11, height: 11, borderRadius: '50%', background: st.color, flexShrink: 0 }} />
                      <span className="text-[14px] font-semibold" style={{ color: st.color }}>{st.label}</span>
                      {st.detail && <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>· {st.detail}</span>}
                      {st.missing.length > 0 && <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>⚠ חסר {st.missing.join(' ו')}</span>}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {chip(isNotContacted, STATUS_COLORS.not_contacted, '⚪ טרם פניתי', () => setStatus('not_contacted'))}
                      {chip(isInProcess, STATUS_COLORS.in_process, '🟠 בתהליך', () => setStatus('in_process'))}
                      {chip(isApproved, STATUS_COLORS.approved, '🟢 מאושר', () => setStatus('approved'))}
                      {chip(isRejected, STATUS_COLORS.rejected, '🔴 נדחה', () => setStatus('rejected'))}
                    </div>
                    <div className="text-[11.5px]" style={{ color: 'var(--text-soft)' }}>
                      🟢 «מאושר» — לחצ/י כדי לאשר ידנית (גובר על «בתהליך»). נקבע גם אוטומטית כשיש תיאור + מקומות פנויים.
                    </div>
                    <label className="block">
                      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>הערת סטטוס (מוצגת בכרטיס)</span>
                      <textarea value={form.statusNote || ''} onChange={e => update('statusNote', e.target.value)} rows={2}
                        className="input w-full" style={{ padding: '10px 14px', fontSize: '14px', resize: 'vertical' }}
                        placeholder="למשל: ממתין לאישור מנהל · בודקים תקציב · נשלח מייל 12/7…" />
                    </label>
                    {history.length > 0 && (
                      <div>
                        <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em', color: 'var(--text-soft)' }}>היסטוריית סטטוס</span>
                        <div className="flex flex-col gap-1" style={{ maxHeight: 140, overflowY: 'auto' }}>
                          {history.map((h: any, i: number) => {
                            const c = STATUS_COLORS[(h.status === 'approved' || h.status === 'in_process' || h.status === 'rejected' || h.status === 'not_contacted') ? h.status : 'not_contacted'];
                            return (
                              <div key={i} className="text-[11.5px] flex items-center gap-2" style={{ color: 'var(--text-soft)' }}>
                                <span className="mono" style={{ minWidth: 96, flexShrink: 0 }}>{new Date(h.at).toLocaleDateString('he-IL')} {new Date(h.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>
                                <span style={{ fontWeight: 600, color: c, flexShrink: 0 }}>{STATUS_LABELS[h.status] || h.status}</span>
                                {h.note && <span className="truncate">· {h.note}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

          </div>

          <div className="flex flex-wrap gap-3 pt-8 mt-8 border-t" style={{ borderColor: 'var(--divider)' }}>
            <button type="submit" style={{
              display: 'inline-block', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
              background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>{isNew ? 'צור' : 'שמור'} →</button>
            <button type="button" onClick={openCall} disabled={!form.contactPhone} style={{
              display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
              background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)',
              borderRadius: '999px', cursor: form.contactPhone ? 'pointer' : 'not-allowed',
              whiteSpace: 'nowrap', flexShrink: 0, opacity: form.contactPhone ? 1 : 0.4,
            }}>📞 התקשר</button>
            <button type="button" onClick={openWhatsApp} disabled={!form.contactPhone} style={{
              display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
              background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)',
              borderRadius: '999px', cursor: form.contactPhone ? 'pointer' : 'not-allowed',
              whiteSpace: 'nowrap', flexShrink: 0, opacity: form.contactPhone ? 1 : 0.4,
            }}>WhatsApp</button>
            <button type="button" onClick={openOutlook} disabled={!form.contactEmail} style={{
              display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
              background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)',
              borderRadius: '999px', cursor: form.contactEmail ? 'pointer' : 'not-allowed',
              whiteSpace: 'nowrap', flexShrink: 0, opacity: form.contactEmail ? 1 : 0.4,
            }}>מייל (Outlook)</button>
            {!isNew && onDelete && (
              <button type="button"
                onClick={() => { if (confirm('למחוק מעסיק זה?')) onDelete(form.id); }}
                className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold mr-auto hover:opacity-70"
                style={{ color: 'var(--accent)', flexShrink: 0 }}>🗑 מחק</button>
            )}
            <button type="button" onClick={onClose}
              className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100"
              style={{ flexShrink: 0 }}>בטל</button>
          </div>
        </form>
    </Modal>
  );
}

// Mobile-friendly places editor: − / + tap targets plus a clearable field. A raw
// controlled <input type="number"> is painful on iPhone — you can't clear the "0"
// to type a new value (it snaps back), and the caret fights you. The steppers let
// you set a count with taps alone; the field keeps a LOCAL string while editing so
// it can be emptied, and commits (clamped to ≥ min = occupied) on change/blur.
function CapacityStepper({ value, min, onChange }: { value: number; min: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  // A ref holds the latest committed value so successive taps accumulate even
  // within one React batch (reading the `value` prop alone would be stale).
  const latest = useRef(value);
  useEffect(() => { setText(String(value)); latest.current = value; }, [value]);
  const commit = (raw: string | number) => {
    const n = Math.max(min, Math.floor(Number(raw) || 0));
    latest.current = n;
    onChange(n);
    setText(String(n));
  };
  const btn = (label: string, onClick: () => void, disabled: boolean) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      style={{
        width: 34, height: 34, borderRadius: 8, border: '1px solid var(--divider)',
        background: disabled ? 'transparent' : 'rgba(122,30,43,0.06)', color: disabled ? 'var(--text-soft)' : 'var(--accent)',
        fontSize: 18, fontWeight: 700, lineHeight: 1, cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
      }}>{label}</button>
  );
  return (
    <div className="flex items-center gap-1.5">
      {btn('−', () => commit(latest.current - 1), value <= min)}
      <input inputMode="numeric" pattern="[0-9]*" value={text}
        onChange={e => { const t = e.target.value.replace(/[^\d]/g, ''); setText(t); if (t !== '') commit(t); }}
        onBlur={() => commit(text === '' ? min : text)}
        className="input" style={{ padding: '8px 4px', fontSize: '15px', width: 52, textAlign: 'center' }} />
      {btn('+', () => commit(value + 1), false)}
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      {children}
    </label>
  );
}

function Input({ value, onChange, type='text', placeholder, required }: any) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required}
      className="input" style={{ padding: '12px 16px', fontSize: '14.5px' }}/>
  );
}

function Select({ value, onChange, options, placeholder }: any) {
  const opts = (options || []).map((o: any) => typeof o === 'string' ? { value: o, label: o } : o);
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="input"
      style={{
        padding: '12px 16px', fontSize: '14.5px', appearance: 'none', WebkitAppearance: 'none',
        backgroundImage: 'linear-gradient(45deg, transparent 50%, var(--accent) 50%), linear-gradient(135deg, var(--accent) 50%, transparent 50%)',
        backgroundPosition: 'calc(100% - 14px) center, calc(100% - 10px) center',
        backgroundSize: '5px 5px', backgroundRepeat: 'no-repeat', paddingLeft: '28px',
      }}>
      {placeholder && <option value="">{placeholder}</option>}
      {opts.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
