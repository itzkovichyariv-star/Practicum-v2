import { useState, type FormEvent } from 'react';
import type { Employer, Course } from '../lib/supabase';
import { randomId } from '../lib/dataApi';
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

  const [form, setForm] = useState<Employer>({
    id: employer?.id || randomId('emp'),
    name: employer?.name || '',
    contactPerson: employer?.contactPerson || '',
    contactPhone: employer?.contactPhone || '',
    contactEmail: employer?.contactEmail || '',
    location: employer?.location || '',
    positions: employer?.positions || 0,
    filledPositions: employer?.filledPositions || 0,
    notes: employer?.notes || '',
    courseIds: initialCourseIds,
  });

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
    window.location.href = `mailto:${encodeURIComponent(form.contactEmail)}?subject=${subject}&body=${body}`;
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

  const openPositions = Math.max(0, (Number(form.positions) || 0) - (Number(form.filledPositions) || 0));

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

          <div className="grid grid-cols-2 gap-5">
            <div className="col-span-2">
              <Field label="שם הארגון"><Input value={form.name} onChange={v=>update('name',v)} required/></Field>
            </div>
            <Field label="איש קשר"><Input value={form.contactPerson||''} onChange={v=>update('contactPerson',v)}/></Field>
            <Field label="מיקום"><Input value={form.location||''} onChange={v=>update('location',v)} placeholder="עיר / איזור"/></Field>
            <Field label="טלפון איש קשר"><Input type="tel" value={form.contactPhone||''} onChange={v=>update('contactPhone',v)}/></Field>
            <Field label="מייל איש קשר"><Input type="email" value={form.contactEmail||''} onChange={v=>update('contactEmail',v)}/></Field>

            <div className="col-span-2">
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
                          const next = e.target.checked
                            ? [...(form.courseIds || []), c.id]
                            : (form.courseIds || []).filter(id => id !== c.id);
                          update('courseIds', next);
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

            <Field label="סה״כ משרות"><Input type="number" value={String(form.positions||0)} onChange={v=>update('positions', Number(v)||0)}/></Field>
            <Field label="משרות מאוישות"><Input type="number" value={String(form.filledPositions||0)} onChange={v=>update('filledPositions', Number(v)||0)}/></Field>

            <div className="col-span-2">
              <Field label="הערות">
                <textarea value={form.notes||''} onChange={e=>update('notes', e.target.value)}
                  rows={2} className="input w-full" style={{ padding:'10px 14px', fontSize:'14px', resize:'vertical' }} />
              </Field>
            </div>

            <div className="col-span-2 py-3 border-t mt-3" style={{ borderColor: 'var(--divider)' }}>
              <div className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: openPositions > 0 ? 'var(--accent)' : 'var(--text-soft)' }}>
                {openPositions > 0 ? `${openPositions} משרות פתוחות` : 'אין משרות פתוחות'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-8 mt-8 border-t" style={{ borderColor: 'var(--divider)' }}>
            <button type="submit" className="btn btn-primary">{isNew?'צור':'שמור'} <span className="serif text-[16px]">→</span></button>
            <button type="button" onClick={openCall} className="btn" disabled={!form.contactPhone}>📞 התקשר</button>
            <button type="button" onClick={openWhatsApp} className="btn" disabled={!form.contactPhone}>WhatsApp</button>
            <button type="button" onClick={openOutlook} className="btn" disabled={!form.contactEmail}>מייל (Outlook)</button>
            {!isNew && onDelete && (
              <button type="button"
                onClick={()=>{ if(confirm('למחוק מעסיק זה?')) onDelete(form.id); }}
                className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold mr-auto hover:opacity-70"
                style={{ color: 'var(--accent)' }}>🗑 מחק</button>
            )}
            <button type="button" onClick={onClose} className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">בטל</button>
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
