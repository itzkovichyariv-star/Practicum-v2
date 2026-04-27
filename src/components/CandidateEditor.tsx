import { useState, type FormEvent } from 'react';
import type { Candidate, Course } from '../lib/supabase';
import { randomId } from '../lib/dataApi';

const RESULTS: Array<{ value: string; label: string }> = [
  { value: 'pending', label: 'טרם רואיין' },
  { value: 'passed',  label: 'עבר' },
  { value: 'failed',  label: 'לא התקבל' },
];

type Props = {
  candidate: Candidate | null;
  courses: Course[];
  years: string[];
  defaultCourseId?: string;
  defaultYear?: string;
  onSave: (c: Candidate) => void;
  onDelete?: (id: string) => void;
  onConvertToStudent?: (c: Candidate) => void;
  onClose: () => void;
};

export default function CandidateEditor({
  candidate, courses, years, defaultCourseId, defaultYear, onSave, onDelete, onConvertToStudent, onClose,
}: Props) {
  const isNew = !candidate;
  const [form, setForm] = useState<Candidate>({
    id: candidate?.id || randomId('cand'),
    name: candidate?.name || '',
    phone: candidate?.phone || '',
    email: candidate?.email || '',
    city: candidate?.city || '',
    courseId: candidate?.courseId || (defaultCourseId !== '__all__' ? defaultCourseId : ''),
    year: candidate?.year || (defaultYear !== '__all__' ? defaultYear : ''),
    applicationDate: candidate?.applicationDate || '',
    interviewDate: candidate?.interviewDate || '',
    interviewResult: candidate?.interviewResult || 'pending',
    preferredArea: candidate?.preferredArea || '',
    evalCommitment: candidate?.evalCommitment || '',
    evalMotivation: candidate?.evalMotivation || '',
    evalCommunication: candidate?.evalCommunication || '',
    evalEnglish: candidate?.evalEnglish || '',
    evalAcquaintance: candidate?.evalAcquaintance || '',
    evalScore: candidate?.evalScore,
    interviewSummary: candidate?.interviewSummary || '',
    rejectionReason: candidate?.rejectionReason || '',
    notes: candidate?.notes || '',
    cvUrl: candidate?.cvUrl || '',
    applicationUrl: candidate?.applicationUrl || '',
    submittedAt: candidate?.submittedAt || '',
    convertedToStudentId: candidate?.convertedToStudentId || undefined,
  });

  // Pipeline stage
  const hasDocs = !!(form.cvUrl && form.applicationUrl);
  const hasInterview = !!form.interviewDate;
  const passed = form.interviewResult === 'passed';
  const alreadyConverted = !!form.convertedToStudentId;
  const stage = alreadyConverted ? 'הועבר לסטודנטים' :
                passed ? 'עבר — מוכן/ה להעברה' :
                hasInterview && form.interviewResult === 'failed' ? 'לא עבר ראיון' :
                hasInterview ? 'ממתין/ה לתוצאת ראיון' :
                hasDocs ? 'מסמכים הוגשו — לקבוע ראיון' :
                'ממתין/ה למסמכים';

  function update<K extends keyof Candidate>(k: K, v: Candidate[K]) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { alert('שם חסר'); return; }
    if (form.interviewResult === 'failed' && !form.rejectionReason?.trim()) {
      alert('יש למלא סיבת דחייה כשמסמנים "לא התקבל"');
      return;
    }
    onSave(form);
  }

  function openCall() {
    if (!form.phone) { alert('אין טלפון'); return; }
    window.location.href = `tel:${form.phone.replace(/[^\d+]/g, '')}`;
  }
  function openWhatsApp() {
    if (!form.phone) { alert('אין טלפון'); return; }
    let n = form.phone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}`, '_blank');
  }
  function openMail() {
    if (!form.email) { alert('אין מייל'); return; }
    window.location.href = `mailto:${encodeURIComponent(form.email)}?subject=${encodeURIComponent('פרקטיקום — ראיון')}`;
  }

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center p-6"
      style={{ background: 'rgba(26, 22, 18, 0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div className="relative max-w-[720px] w-full max-h-[90vh] overflow-y-auto rounded-2xl"
        style={{ background: 'var(--bg)', boxShadow: '0 24px 80px rgba(26, 22, 18, 0.25)' }}
        onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit} className="px-10 py-10">

          <div className="flex items-start justify-between gap-8 pb-6 border-b mb-8" style={{ borderColor: 'var(--divider)' }}>
            <div>
              <div className="chapter-mark mb-2">{isNew ? 'מועמד/ת חדש/ה' : 'עריכת מועמד/ת'}</div>
              <h2 className="serif text-[32px] leading-[1.1] tracking-tight" style={{ color: 'var(--ink)' }}>
                {form.name || 'הוסף שם'}
              </h2>
              <div className="mono text-[12px] uppercase tracking-[0.14em] font-semibold mt-2"
                style={{ color: passed || alreadyConverted ? 'var(--accent)' : 'var(--text-soft)' }}>
                שלב: {stage}
              </div>
            </div>
            <button type="button" onClick={onClose} className="mono text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">סגור ✕</button>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="col-span-2"><Field label="שם מלא"><Input value={form.name} onChange={v=>update('name',v)} required/></Field></div>
            <Field label="טלפון"><Input type="tel" value={form.phone||''} onChange={v=>update('phone',v)}/></Field>
            <Field label="מייל"><Input type="email" value={form.email||''} onChange={v=>update('email',v)}/></Field>
            <Field label="קורס">
              <Select value={form.courseId||''} onChange={v=>update('courseId',v)}
                options={courses.map(c=>({value:c.id,label:c.name}))} placeholder="בחר"/>
            </Field>
            <Field label="שנה"><Select value={form.year||''} onChange={v=>update('year',v)} options={years} placeholder="בחר"/></Field>

            <div className="col-span-2">
              <div className="chapter-mark mb-3 mt-4" style={{ fontSize: '11px' }}>שלב 1 — מסמכים</div>
            </div>
            <FileField label="קורות חיים" value={form.cvUrl||''} onChange={v=>update('cvUrl',v)}/>
            <FileField label="טופס הגשת מועמדות" value={form.applicationUrl||''} onChange={v=>update('applicationUrl',v)}/>

            <div className="col-span-2">
              <div className="chapter-mark mb-3 mt-4" style={{ fontSize: '11px', color: hasDocs ? 'var(--accent)' : 'var(--text-soft)' }}>
                שלב 2 — ראיון {!hasDocs && ' (נדרשים קודם CV + טופס מועמדות)'}
              </div>
            </div>
            <Field label="תאריך הגשה">
              <Input type="date" value={form.applicationDate||''} onChange={v=>update('applicationDate',v)}/>
            </Field>
            <Field label="תאריך ראיון">
              <Input type="date" value={form.interviewDate||''} onChange={v=>update('interviewDate',v)}/>
            </Field>

            <div className="col-span-2">
              <div className="chapter-mark mb-3 mt-4" style={{ fontSize: '11px', color: hasInterview ? 'var(--accent)' : 'var(--text-soft)' }}>
                הערכת ראיון
              </div>
            </div>

            <div className="col-span-2">
              <Field label="תחום מבוקש"><Input value={form.preferredArea||''} onChange={v=>update('preferredArea',v)} placeholder="למשל: גיוס · רווחה · פיתוח ארגוני"/></Field>
            </div>

            <Field label="מחויבות">
              <Select value={form.evalCommitment||''} onChange={v=>update('evalCommitment',v)}
                options={[{value:'',label:'—'},{value:'נמוך',label:'נמוך'},{value:'בינוני',label:'בינוני'},{value:'גבוה',label:'גבוה'},{value:'מצטיין',label:'מצטיין'}]}/>
            </Field>
            <Field label="מוטיבציה">
              <Select value={form.evalMotivation||''} onChange={v=>update('evalMotivation',v)}
                options={[{value:'',label:'—'},{value:'נמוכה',label:'נמוכה'},{value:'בינונית',label:'בינונית'},{value:'גבוהה',label:'גבוהה'},{value:'גבוהה מאוד',label:'גבוהה מאוד'}]}/>
            </Field>
            <Field label="תקשורת">
              <Select value={form.evalCommunication||''} onChange={v=>update('evalCommunication',v)}
                options={[{value:'',label:'—'},{value:'חלשה',label:'חלשה'},{value:'בינונית',label:'בינונית'},{value:'טובה',label:'טובה'},{value:'מצוינת',label:'מצוינת'}]}/>
            </Field>
            <Field label="אנגלית">
              <Select value={form.evalEnglish||''} onChange={v=>update('evalEnglish',v)}
                options={[{value:'',label:'—'},{value:'בסיסית',label:'בסיסית'},{value:'טובה',label:'טובה'},{value:'טובה מאוד',label:'טובה מאוד'},{value:'שפת אם',label:'שפת אם'}]}/>
            </Field>
            <Field label="הכרות קודמת עם התחום">
              <Select value={form.evalAcquaintance||''} onChange={v=>update('evalAcquaintance',v)}
                options={[{value:'',label:'—'},{value:'אין',label:'אין'},{value:'מעט',label:'מעט'},{value:'טובה',label:'טובה'},{value:'רחבה',label:'רחבה'}]}/>
            </Field>
            <Field label="ציון כולל (0–100)">
              <Input type="number" value={form.evalScore != null ? String(form.evalScore) : ''}
                onChange={v => update('evalScore', v ? Math.max(0, Math.min(100, parseInt(v))) : undefined)}
                placeholder="למשל: 87"/>
            </Field>

            <div className="col-span-2">
              <Field label="סיכום ראיון">
                <textarea
                  value={form.interviewSummary||''}
                  onChange={e => update('interviewSummary', e.target.value)}
                  rows={3}
                  placeholder="התרשמות כללית · חוזקות · חולשות · המלצות..."
                  className="input w-full"
                  style={{ padding: '12px 16px', fontSize: '14.5px', resize: 'vertical', minHeight: '72px' }}
                />
              </Field>
            </div>

            <Field label="תוצאה סופית">
              <Select value={form.interviewResult||'pending'} onChange={v=>update('interviewResult', v as any)} options={RESULTS}/>
            </Field>
            <div />

            {form.interviewResult === 'failed' && (
              <div className="col-span-2 rounded-xl p-4 mt-1"
                style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid var(--accent)' }}>
                <Field label="סיבת דחייה (חובה)">
                  <Input value={form.rejectionReason||''} onChange={v=>update('rejectionReason',v)}
                    placeholder="למשל: אין התאמה לתחום / מוטיבציה חלשה / ניסיון קודם חסר"/>
                </Field>
              </div>
            )}

            {passed && !alreadyConverted && (
              <div className="col-span-2 mt-4 rounded-xl p-4 text-[13.5px]"
                style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--accent)', color: 'var(--ink)' }}>
                ✓ עבר ראיון. <strong>בעת שמירה</strong>, המועמד/ת יועבר/תועבר אוטומטית לרשימת הסטודנטים
                עם כל המסמכים. השלבים הבאים: הכנה + CV מעודכן, ואז בחירת ארגון.
              </div>
            )}
            {alreadyConverted && (
              <div className="col-span-2 mt-4 text-[13.5px]" style={{ color: 'var(--accent)' }}>
                ✓ כבר הועבר לרשימת הסטודנטים. רשומת המועמד נשמרת לארכיון.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 pt-8 mt-8 border-t" style={{ borderColor: 'var(--divider)' }}>
            <button type="submit" className="btn btn-primary">{isNew?'צור':'שמור'} <span className="serif text-[16px]">→</span></button>
            <button type="button" onClick={openCall} className="btn" disabled={!form.phone}>📞 התקשר</button>
            <button type="button" onClick={openWhatsApp} className="btn" disabled={!form.phone}>WhatsApp</button>
            <button type="button" onClick={openMail} className="btn" disabled={!form.email}>מייל</button>
            {!isNew && onDelete && (
              <button type="button"
                onClick={()=>{ if(confirm('למחוק?')) onDelete(form.id); }}
                className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold mr-auto hover:opacity-70"
                style={{ color: 'var(--accent)' }}>🗑 מחק</button>
            )}
            <button type="button" onClick={onClose} className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">בטל</button>
          </div>
        </form>
      </div>
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
          placeholder="קישור OneDrive / SharePoint"
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
function Input({ value, onChange, type='text', placeholder, required }: any) {
  return <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} required={required}
    className="input" style={{ padding: '12px 16px', fontSize: '14.5px' }}/>;
}
function Select({ value, onChange, options, placeholder }: any) {
  const opts = (options || []).map((o: any) => typeof o === 'string' ? { value: o, label: o } : o);
  return (
    <select value={value} onChange={e=>onChange(e.target.value)} className="input"
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
