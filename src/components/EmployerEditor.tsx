import { useState, type FormEvent } from 'react';
import type { Employer, Course } from '../lib/supabase';
import { randomId } from '../lib/dataApi';
import { openMailto } from '../lib/openMailto';
import { setCourseCapacity, countSlotsByStatus, reconcileEmployerCapacity } from '../lib/placement';
import Modal from './Modal';

type Props = {
  employer: Employer | null;
  courses: Course[];
  years: string[];
  defaultCourseId?: string;
  defaultYear?: string;
  onSave: (e: Employer) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
};

export default function EmployerEditor({
  employer, courses, years, defaultCourseId, defaultYear, onSave, onDelete, onClose,
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
    if (!form.contactPhone) { alert('אין טלפון איש קשר'); return; }
    let n = form.contactPhone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}`, '_blank');
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
              <span className="small-caps block mb-2" style={{ letterSpacing: '0.12em' }}>קורסים משויכים</span>
              <div className="flex flex-wrap gap-3">
                {courses.map(c => {
                  const checked = (form.courseIds || []).includes(c.id);
                  return (
                    <label key={c.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-[13.5px] transition-colors"
                      style={{
                        borderColor: checked ? 'var(--accent)' : 'var(--divider)',
                        background: checked ? 'rgba(122,30,43,0.06)' : 'transparent',
                        color: 'var(--ink)',
                      }}>
                      <input type="checkbox" checked={checked}
                        onChange={e => {
                          if (e.target.checked) {
                            // Attach the course — capacity starts at 0 (no carry-over).
                            update('courseIds', [...(form.courseIds || []), c.id]);
                            return;
                          }
                          const cnt = countSlotsByStatus(form, c.id);
                          const occupied = cnt.tentative + cnt.under_review + cnt.placed;
                          if (occupied > 0) {
                            alert(`לא ניתן לבטל שיוך ל"${c.name}" — ${occupied} מקומות תפוסים בקורס זה. שחרר/י אותם קודם.`);
                            return;
                          }
                          setForm(f => reconcileEmployerCapacity({
                            ...f,
                            courseIds: (f.courseIds || []).filter(id => id !== c.id),
                            vacancySlots: (f.vacancySlots || []).filter((s: any) => s.courseId !== c.id),
                          }));
                        }}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span>{c.name}</span>
                      <span className="mono text-[11px] opacity-60">{c.year}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="col-span-full">
              <span className="small-caps block mb-2" style={{ letterSpacing: '0.12em' }}>מקומות התנסות — לפי קורס</span>
              {(form.courseIds || []).length === 0 ? (
                <div className="text-[13px] px-3 py-3 rounded-lg border" style={{ color: 'var(--text-soft)', borderColor: 'var(--divider)', background: 'rgba(0,0,0,0.02)' }}>
                  שייך/י קורס למעלה כדי להגדיר מספר מקומות.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {(form.courseIds || []).map(cid => {
                    const c = courses.find(x => x.id === cid);
                    if (!c) return null;
                    const cnt = countSlotsByStatus(form, cid);
                    const occupied = cnt.tentative + cnt.under_review + cnt.placed;
                    return (
                      <div key={cid} className="flex items-center gap-3 flex-wrap px-3 py-2.5 rounded-lg border"
                        style={{ borderColor: 'var(--divider)' }}>
                        <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                          <div className="text-[13.5px] font-medium truncate" style={{ color: 'var(--ink)' }}>{c.name}</div>
                          <div className="mono text-[11px] opacity-60">{c.year}</div>
                        </div>
                        <label className="flex items-center gap-2 shrink-0">
                          <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>מקומות</span>
                          <input type="number" min={occupied} value={String(cnt.total)}
                            onChange={e => setForm(setCourseCapacity(form, cid, Number(e.target.value) || 0))}
                            className="input" style={{ padding: '8px 10px', fontSize: '14px', width: '68px' }} />
                        </label>
                        <div className="mono text-[11px] shrink-0" style={{ color: cnt.available > 0 ? '#15803d' : 'var(--text-soft)' }}>
                          {cnt.available} פנויים{occupied > 0 ? ` · ${occupied} תפוסים` : ''}
                        </div>
                      </div>
                    );
                  })}
                  <div className="mono text-[11px]" style={{ color: 'var(--text-soft)' }}>
                    כל קורס נשמר בנפרד. קורס חדש מתחיל מ‑0. לא ניתן להוריד מתחת למספר המקומות התפוסים.
                  </div>
                </div>
              )}
            </div>

            <div className="col-span-full">
              <Field label="הערות">
                <textarea value={form.notes||''} onChange={e=>update('notes', e.target.value)}
                  rows={2} className="input w-full" style={{ padding:'10px 14px', fontSize:'14px', resize:'vertical' }} />
              </Field>
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
