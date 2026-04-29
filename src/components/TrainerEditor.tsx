import { useState, type FormEvent } from 'react';
import type { Trainer, Course } from '../lib/supabase';
import { randomId } from '../lib/dataApi';

type Props = {
  trainer: Trainer | null;
  courses: Course[];
  years: string[];
  defaultCourseId?: string;
  defaultYear?: string;
  onSave: (t: Trainer) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
};

export default function TrainerEditor({
  trainer, courses, years, defaultCourseId, defaultYear, onSave, onDelete, onClose,
}: Props) {
  const isNew = !trainer;
  const [form, setForm] = useState<Trainer>({
    id: trainer?.id || randomId('trn'),
    name: trainer?.name || '',
    phone: trainer?.phone || '',
    email: trainer?.email || '',
    organization: trainer?.organization || '',
    role: trainer?.role || '',
    specialty: trainer?.specialty || '',
    courseId: trainer?.courseId || (defaultCourseId !== '__all__' ? defaultCourseId ?? '' : ''),
    year: trainer?.year || (defaultYear !== '__all__' ? defaultYear ?? '' : ''),
    notes: trainer?.notes || '',
    studentIds: trainer?.studentIds || [],
  });

  function update<K extends keyof Trainer>(k: K, v: Trainer[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { alert('שם המנחה חסר'); return; }
    onSave(form);
  }

  function openMail() {
    if (!form.email) { alert('לא הוזן מייל'); return; }
    const subject = encodeURIComponent(`פרקטיקום משאבי אנוש — ${form.name}`);
    const body = encodeURIComponent(`שלום ${form.name},\n\n`);
    window.location.href = `mailto:${encodeURIComponent(form.email)}?subject=${subject}&body=${body}`;
  }

  function openCall() {
    if (!form.phone) { alert('לא הוזן טלפון'); return; }
    window.location.href = `tel:${form.phone.replace(/[^\d+]/g, '')}`;
  }

  function openWhatsApp() {
    if (!form.phone) { alert('לא הוזן טלפון'); return; }
    let n = form.phone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}`, '_blank');
  }

  return (
    <div className="fixed inset-0 z-[200]"
      style={{ background: 'rgba(26, 22, 18, 0.55)', backdropFilter: 'blur(4px)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as any}>
      <div className="min-h-full py-6 px-4 flex items-start justify-center" onClick={onClose}>
      <div className="relative w-full max-w-[780px] rounded-2xl"
        style={{ background: 'var(--bg)', boxShadow: '0 24px 80px rgba(26, 22, 18, 0.25)' }}
        onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit} className="px-5 py-7 md:px-10 md:py-10">

          <div className="flex items-start justify-between gap-8 pb-6 border-b mb-8" style={{ borderColor: 'var(--divider)' }}>
            <div>
              <div className="chapter-mark mb-2">{isNew ? 'מנחה חדש/ה' : 'עריכת מנחה'}</div>
              <h2 className="serif text-[32px] leading-[1.1] tracking-tight" style={{ color: 'var(--ink)' }}>
                {form.name || 'הוסף שם מנחה'}
              </h2>
              {form.organization && (
                <div className="mono text-[12px] uppercase tracking-[0.14em] mt-1" style={{ color: 'var(--text-soft)' }}>
                  {form.organization}
                </div>
              )}
            </div>
            <button type="button" onClick={onClose}
              className="mono text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">
              סגור ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="col-span-2">
              <Field label="שם מלא"><Input value={form.name} onChange={v => update('name', v)} required /></Field>
            </div>
            <Field label="ארגון מאכסן"><Input value={form.organization || ''} onChange={v => update('organization', v)} placeholder="שם הארגון" /></Field>
            <Field label="תפקיד"><Input value={form.role || ''} onChange={v => update('role', v)} placeholder="מנהל/ת משאבי אנוש" /></Field>
            <Field label="טלפון"><Input type="tel" value={form.phone || ''} onChange={v => update('phone', v)} /></Field>
            <Field label="מייל"><Input type="email" value={form.email || ''} onChange={v => update('email', v)} /></Field>
            <Field label="תחום התמחות">
              <Input value={form.specialty || ''} onChange={v => update('specialty', v)} placeholder="גיוס / הכשרה / שכר..." />
            </Field>
            <Field label="קורס">
              <Select value={form.courseId || ''} onChange={v => update('courseId', v)}
                options={courses.map(c => ({ value: c.id, label: c.name }))} placeholder="בחר קורס" />
            </Field>
            <Field label="שנה אקדמית">
              <Select value={form.year || ''} onChange={v => update('year', v)} options={years.map(y=>({value:y,label:y}))} placeholder="בחר שנה" />
            </Field>
            <div className="col-span-2">
              <Field label="הערות">
                <textarea
                  value={form.notes || ''}
                  onChange={e => update('notes', e.target.value)}
                  rows={3}
                  className="input w-full"
                  style={{ padding: '12px 16px', fontSize: '14.5px', resize: 'vertical' }}
                />
              </Field>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-8 mt-8 border-t" style={{ borderColor: 'var(--divider)' }}>
            <button type="submit" className="btn btn-primary">
              {isNew ? 'צור' : 'שמור'} <span className="serif text-[16px]">→</span>
            </button>
            <button type="button" onClick={openCall} className="btn" disabled={!form.phone}>📞 התקשר</button>
            <button type="button" onClick={openWhatsApp} className="btn" disabled={!form.phone}>💬 WhatsApp</button>
            <button type="button" onClick={openMail} className="btn" disabled={!form.email}>✉ מייל</button>
            {!isNew && onDelete && (
              <button type="button"
                onClick={() => { if (confirm('למחוק מנחה זה/ה?')) onDelete(form.id); }}
                className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold mr-auto hover:opacity-70"
                style={{ color: 'var(--accent)' }}>
                🗑 מחק
              </button>
            )}
            <button type="button" onClick={onClose}
              className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">
              בטל
            </button>
          </div>
        </form>
      </div>
      </div>
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

function Input({ value, onChange, type = 'text', placeholder, required }: any) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} required={required}
      className="input" style={{ padding: '12px 16px', fontSize: '14.5px' }} />
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
