import { useState, type FormEvent } from 'react';
import type { Student, Course, Employer } from '../lib/supabase';
import { randomId } from '../lib/dataApi';
import EvaluationForm from './EvaluationForm';

type Props = {
  student: Student | null;
  courses: Course[];
  years: string[];
  employers: Employer[];
  defaultCourseId?: string;
  defaultYear?: string;
  onSave: (s: Student) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
};

export default function StudentEditor({
  student, courses, years, employers, defaultCourseId, defaultYear, onSave, onDelete, onClose,
}: Props) {
  const isNew = !student;
  const [showEval, setShowEval] = useState(false);
  const [form, setForm] = useState<Student>({
    id: student?.id || randomId('s'),
    name: student?.name || '',
    phone: student?.phone || '',
    email: student?.email || '',
    city: student?.city || '',
    courseId: student?.courseId || (defaultCourseId !== '__all__' ? defaultCourseId : ''),
    year: student?.year || (defaultYear !== '__all__' ? defaultYear : ''),
    acceptedOrg: student?.acceptedOrg || '',
    hired: student?.hired || false,
    preparation: student?.preparation || { passed: false, date: '' },
    hoursReported: student?.hoursReported || 0,
    hoursApproved: student?.hoursApproved || 0,
    feedbackText: student?.feedbackText || '',
    notes: student?.notes || '',
    practicumCompleted: student?.practicumCompleted || false,
    fromCandidate: student?.fromCandidate || false,
    fromCandidateId: student?.fromCandidateId,
    cvUrl: student?.cvUrl || '',
    formUrl: student?.formUrl || '',
    cvUpdatedUrl: student?.cvUpdatedUrl || '',
    firstChoiceOrg: student?.firstChoiceOrg || '',
    firstChoiceResult: student?.firstChoiceResult || 'pending',
    secondChoiceOrg: student?.secondChoiceOrg || '',
    secondChoiceResult: student?.secondChoiceResult || 'pending',
  });

  const prepPassed = !!form.preparation?.passed;

  function update<K extends keyof Student>(k: K, v: Student[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function updatePrep<K extends keyof NonNullable<Student['preparation']>>(k: K, v: any) {
    setForm(f => ({ ...f, preparation: { ...(f.preparation || {}), [k]: v } as any }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { alert('שם הסטודנט/ית חסר'); return; }
    onSave(form);
  }

  function openOutlookCompose() {
    if (!form.email) { alert('לא הוזן מייל'); return; }
    const subject = encodeURIComponent(`פרקטיקום — ${form.name}`);
    const body = encodeURIComponent(`שלום ${form.name},\n\n`);
    window.location.href = `mailto:${encodeURIComponent(form.email)}?subject=${subject}&body=${body}`;
  }

  function openCall() {
    if (!form.phone) { alert('לא הוזן טלפון'); return; }
    // tel: opens the phone app on mobile / default dialer on desktop (Teams/FaceTime/etc)
    window.location.href = `tel:${form.phone.replace(/[^\d+]/g, '')}`;
  }

  function openWhatsApp() {
    if (!form.phone) { alert('לא הוזן טלפון'); return; }
    // normalize: IL numbers 05X → 9725X
    let n = form.phone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}`, '_blank');
  }

  return (
    <div className="fixed inset-0 z-[200]"
      style={{ background: 'rgba(26, 22, 18, 0.55)', backdropFilter: 'blur(4px)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as any}>
      <div className="min-h-full py-6 px-4 flex items-start justify-center" onClick={onClose}>
      <div className="relative w-full max-w-[820px] rounded-2xl"
        style={{ background: 'var(--bg)', boxShadow: '0 24px 80px rgba(26, 22, 18, 0.25)' }}
        onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit} className="px-5 py-7 md:px-10 md:py-10">

          <div className="flex items-start justify-between gap-8 pb-6 border-b mb-8" style={{ borderColor: 'var(--divider)' }}>
            <div>
              <div className="chapter-mark mb-2">{isNew ? 'סטודנט/ית חדש' : 'עריכת סטודנט/ית'}</div>
              <h2 className="serif text-[32px] leading-[1.1] tracking-tight" style={{ color: 'var(--ink)' }}>
                {form.name || (isNew ? 'הוסף שם' : '')}
              </h2>
            </div>
            <button type="button" onClick={onClose} className="mono text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">סגור ✕</button>
          </div>

          <SectionSub title="פרטים אישיים">
            <Field label="שם מלא"><Input value={form.name} onChange={v=>update('name',v)} required/></Field>
            <Field label="עיר מגורים"><Input value={form.city||''} onChange={v=>update('city',v)}/></Field>
            <Field label="טלפון"><Input type="tel" value={form.phone||''} onChange={v=>update('phone',v)}/></Field>
            <Field label="מייל"><Input type="email" value={form.email||''} onChange={v=>update('email',v)}/></Field>
          </SectionSub>

          <SectionSub title="הקשר — קורס ושנה">
            <Field label="קורס">
              <Select value={form.courseId||''} onChange={v=>update('courseId',v)}
                options={courses.map(c=>({value:c.id,label:c.name}))} placeholder="בחר קורס"/>
            </Field>
            <Field label="שנה אקדמית">
              <Select value={form.year||''} onChange={v=>update('year',v)} options={years.map(y=>({value:y,label:y}))} placeholder="בחר שנה"/>
            </Field>
          </SectionSub>

          <SectionSub title="הכנה לפרקטיקום">
            <Field label="עבר/ה הכנה">
              <Checkbox checked={!!form.preparation?.passed} onChange={v=>updatePrep('passed', v)} label="סומן שעבר/ה הכנה"/>
            </Field>
            <Field label="תאריך הכנה"><Input type="date" value={form.preparation?.date||''} onChange={v=>updatePrep('date', v)}/></Field>
          </SectionSub>

          <SectionSub title="CV מעודכן (חובה לפני בחירת ארגון)">
            <div className="col-span-2">
              <FileField label="קורות חיים מעודכן — אחרי הכנה" value={form.cvUpdatedUrl||''} onChange={v=>update('cvUpdatedUrl',v)}/>
            </div>
          </SectionSub>

          <SectionSub title="בחירת ארגון">
            <Field label="בחירה ראשונה — ארגון">
              <Select value={form.firstChoiceOrg||''} onChange={v=>update('firstChoiceOrg',v)}
                options={employers.map(e=>({value:e.name,label:e.name}))}
                placeholder="בחר ארגון"
                freeText/>
            </Field>
            <Field label="תוצאת ראיון — בחירה ראשונה">
              <Select value={form.firstChoiceResult||'pending'} onChange={v=>update('firstChoiceResult', v as any)}
                options={[
                  { value: 'pending', label: 'טרם רואיין' },
                  { value: 'passed', label: 'עבר — שובץ' },
                  { value: 'failed', label: 'לא עבר' },
                ]}/>
            </Field>
            <Field label="בחירה שנייה — ארגון">
              <Select value={form.secondChoiceOrg||''} onChange={v=>update('secondChoiceOrg',v)}
                options={employers.map(e=>({value:e.name,label:e.name}))}
                placeholder="בחר ארגון שני"
                freeText/>
            </Field>
            <Field label="תוצאת ראיון — בחירה שנייה">
              <Select value={form.secondChoiceResult||'pending'} onChange={v=>update('secondChoiceResult', v as any)}
                options={[
                  { value: 'pending', label: 'טרם רואיין' },
                  { value: 'passed', label: 'עבר — שובץ' },
                  { value: 'failed', label: 'לא עבר' },
                ]}/>
            </Field>
          </SectionSub>

          <SectionSub title="השמה סופית ושעות">
            <Field label="ארגון מאכסן בפועל">
              <Select value={form.acceptedOrg||''} onChange={v=>update('acceptedOrg',v)}
                options={[...employers.map(e=>({value:e.name,label:e.name}))]}
                placeholder="לא שובץ עדיין"
                freeText/>
            </Field>
            <Field label="נקלט/ה לעבודה לאחר הפרקטיקום">
              <Checkbox checked={!!form.hired} onChange={v=>update('hired',v)} label="סומן כנקלט/ה"/>
            </Field>
            <Field label="שעות מדווחות"><Input type="number" value={String(form.hoursReported||0)} onChange={v=>update('hoursReported', Number(v)||0)}/></Field>
            <Field label="שעות מאושרות"><Input type="number" value={String(form.hoursApproved||0)} onChange={v=>update('hoursApproved', Number(v)||0)}/></Field>
            <Field label="סיים/סיימה פרקטיקום">
              <Checkbox checked={!!form.practicumCompleted} onChange={v=>update('practicumCompleted',v)} label="מילא/ה חובות שעות וסיים/סיימה פרקטיקום"/>
            </Field>
          </SectionSub>

          <SectionSub title="מסמכים וחוו״ד (קישורי OneDrive / SharePoint)">
            <FileField label="CV — קורות חיים" value={form.cvUrl||''} onChange={v=>update('cvUrl',v)}/>
            <FileField label="טופס הגשת מועמדות" value={form.formUrl||''} onChange={v=>update('formUrl',v)}/>
            <div className="col-span-2">
              <Field label="חוות דעת מהארגון (טקסט חופשי)"><Textarea rows={3} value={form.feedbackText||''} onChange={v=>update('feedbackText',v)}/></Field>
            </div>
            <div className="col-span-2 text-[12px]" style={{ color: 'var(--text-soft)' }}>
              💡 הדבק קישור מ‑OneDrive או SharePoint. לחיצה על "פתח" תפתח את הקובץ בחלון חדש.
            </div>
          </SectionSub>

          <SectionSub title="הערות">
            <div className="col-span-2"><Field label="הערות פנימיות"><Textarea rows={3} value={form.notes||''} onChange={v=>update('notes',v)}/></Field></div>
          </SectionSub>

          <div className="flex flex-wrap gap-3 pt-8 mt-8 border-t" style={{ borderColor: 'var(--divider)' }}>
            <button type="submit" className="btn btn-primary">{isNew?'צור':'שמור'} <span className="serif text-[16px]">→</span></button>
            <button type="button" onClick={openCall} className="btn" disabled={!form.phone}>📞 התקשר</button>
            <button type="button" onClick={openWhatsApp} className="btn" disabled={!form.phone}>WhatsApp</button>
            <button type="button" onClick={openOutlookCompose} className="btn" disabled={!form.email}>מייל (Outlook)</button>
            {!isNew && <button type="button" onClick={() => setShowEval(true)} className="btn">🖨 טופס הערכה</button>}
            {!isNew && onDelete && (
              <button type="button"
                onClick={()=>{ if(confirm('למחוק סטודנט/ית זה/ו?')) onDelete(form.id); }}
                className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold mr-auto hover:opacity-70"
                style={{ color: 'var(--accent)' }}>🗑 מחק</button>
            )}
            <button type="button" onClick={onClose} className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">בטל</button>
          </div>
        </form>
      </div>

      {showEval && (
        <EvaluationForm
          student={form}
          courses={courses}
          employers={employers}
          onClose={() => setShowEval(false)}
        />
      )}
    </div>
    </div>
  );
}

function SectionSub({ title, children }: { title: string; children: any }) {
  return (
    <div className="mb-7">
      <div className="chapter-mark mb-4" style={{ fontSize: '11px' }}>{title}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">{children}</div>
    </div>
  );
}

function FileField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const isUrl = /^https?:\/\//i.test(value);
  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="הדבק קישור OneDrive..."
          className="input flex-1"
          style={{ padding: '12px 16px', fontSize: '13.5px', fontFamily: isUrl ? 'ui-monospace, monospace' : undefined }}
        />
        {isUrl && (
          <button type="button" onClick={() => window.open(value, '_blank')}
            className="mono text-[11px] uppercase tracking-[0.14em] font-semibold px-4 rounded-lg shrink-0"
            style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
            פתח ↗
          </button>
        )}
      </div>
    </label>
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

function Input({
  value, onChange, type = 'text', placeholder, required,
}: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="input"
      style={{ padding: '12px 16px', fontSize: '14.5px' }}
    />
  );
}

function Textarea({
  value, onChange, rows = 3,
}: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} className="input"
      style={{ padding: '12px 16px', fontSize: '14.5px', resize: 'vertical', minHeight: '72px' }} />
  );
}

function Checkbox({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2.5 cursor-pointer py-3">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="text-[14.5px]" style={{ color: 'var(--ink)' }}>{label}</span>
    </label>
  );
}

function Select({
  value, onChange, options, placeholder, freeText,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  freeText?: boolean;
}) {
  if (freeText) {
    // Combobox: input with datalist
    const listId = `dl-${Math.random().toString(36).slice(2, 8)}`;
    return (
      <>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          list={listId}
          className="input"
          style={{ padding: '12px 16px', fontSize: '14.5px' }}
        />
        <datalist id={listId}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </datalist>
      </>
    );
  }
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="input"
      style={{
        padding: '12px 16px',
        fontSize: '14.5px',
        appearance: 'none',
        WebkitAppearance: 'none',
        backgroundImage:
          'linear-gradient(45deg, transparent 50%, var(--accent) 50%), linear-gradient(135deg, var(--accent) 50%, transparent 50%)',
        backgroundPosition: 'calc(100% - 14px) center, calc(100% - 10px) center',
        backgroundSize: '5px 5px',
        backgroundRepeat: 'no-repeat',
        paddingLeft: '28px',
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
