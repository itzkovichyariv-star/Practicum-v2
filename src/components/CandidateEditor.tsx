import { useState, type FormEvent } from 'react';
import { btnSmall, btnSecondary } from '../lib/design';
import type { Candidate, Course } from '../lib/supabase';
import { randomId } from '../lib/dataApi';
import { supabase } from '../lib/supabase';
import { openMailto } from '../lib/openMailto';
import Modal from './Modal';

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
    // Block pass/fail without submitted documents
    if ((form.interviewResult === 'passed' || form.interviewResult === 'failed') && !(form.cvUrl && form.applicationUrl)) {
      alert('לא ניתן לסמן תוצאת ראיון ללא הגשת מסמכים.\n\nיש לוודא שהמועמד/ת העלה/תה:\n• קורות חיים (CV)\n• טופס הגשת מועמדות\n\nהעדכן/י את השדות בקטע "שלב 1 — מסמכים" ושמור שוב.');
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

  function sendCvLinkWhatsApp() {
    if (!form.phone) { alert('אין טלפון'); return; }
    if (!form.email) { alert('אין מייל — הקישור דורש מייל'); return; }
    const firstName = (form.name || '').split(' ')[0] || 'שלום';
    const link = `${window.location.origin}/cv-update/?email=${encodeURIComponent(form.email)}&name=${encodeURIComponent(form.name || '')}`;
    const msg = `שלום ${firstName}, ברכות על קבלתך לפרקטיקום!\nלאחר סדנת קורות החיים, אנא עדכן/י את קורות החיים שלך דרך הקישור הבא:\n${link}`;
    let n = form.phone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`, '_blank');
  }
  function openMail() {
    if (!form.email) { alert('אין מייל'); return; }
    openMailto(`mailto:${encodeURIComponent(form.email)}?subject=${encodeURIComponent('פרקטיקום — ראיון')}`);
  }

  function copyCvUpdateLink() {
    if (!form.email) { alert('אין מייל — לא ניתן ליצור קישור'); return; }
    const base = window.location.origin;
    const link = `${base}/cv-update/?email=${encodeURIComponent(form.email)}&name=${encodeURIComponent(form.name || '')}`;
    navigator.clipboard?.writeText(link).then(() => alert('קישור הועתק ✓')).catch(() => {
      prompt('העתק קישור:', link);
    });
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-[720px]">
        <form onSubmit={handleSubmit} className="px-5 py-7 md:px-10 md:py-10">

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="col-span-full"><Field label="שם מלא"><Input value={form.name} onChange={v=>update('name',v)} required/></Field></div>
            <Field label="טלפון"><Input type="tel" value={form.phone||''} onChange={v=>update('phone',v)}/></Field>
            <Field label="מייל"><Input type="email" value={form.email||''} onChange={v=>update('email',v)}/></Field>
            <Field label="קורס">
              <Select value={form.courseId||''} onChange={v=>update('courseId',v)}
                options={courses.map(c=>({value:c.id,label:c.year?`${c.name} · ${c.year}`:c.name}))} placeholder="בחר"/>
            </Field>
            <Field label="שנה"><Select value={form.year||''} onChange={v=>update('year',v)} options={years} placeholder="בחר"/></Field>

            <div className="col-span-full">
              <div className="chapter-mark mb-3 mt-4" style={{ fontSize: '11px' }}>שלב 1 — מסמכים</div>
            </div>
            <FileField label="קורות חיים" value={form.cvUrl||''} onChange={v=>update('cvUrl',v)}
              placeholder="לכאן יועלו קורות החיים שהמועמד/ת יצרף/ת דרך קישור ההרשמה"/>
            <FileField label="טופס הגשת מועמדות" value={form.applicationUrl||''} onChange={v=>update('applicationUrl',v)}
              placeholder="לכאן יועלה טופס המועמדות שהמועמד/ת יצרף/ת דרך קישור ההרשמה"/>

            <div className="col-span-full">
              <div className="chapter-mark mb-3 mt-4" style={{ fontSize: '11px', color: hasDocs ? 'var(--accent)' : 'var(--text-soft)' }}>
                שלב 2 — ראיון {!hasDocs && ' 🔒 (יש להגיש מסמכים קודם)'}
              </div>
            </div>
            <Field label="תאריך הגשה">
              <Input type="date" value={form.applicationDate||''} onChange={v=>update('applicationDate',v)}/>
            </Field>
            <Field label="תאריך ראיון">
              <Input type="date" value={form.interviewDate||''} onChange={v=>update('interviewDate',v)}/>
            </Field>

            <div className="col-span-full">
              <div className="chapter-mark mb-3 mt-4" style={{ fontSize: '11px', color: hasInterview ? 'var(--accent)' : 'var(--text-soft)' }}>
                הערכת ראיון
              </div>
            </div>

            <div className="col-span-full">
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

            <div className="col-span-full">
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
              <div className="col-span-full rounded-xl p-4 mt-1"
                style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.35)' }}>
                <div className="mono text-[10.5px] uppercase tracking-[0.14em] mb-2 font-semibold" style={{ color: '#b91c1c' }}>
                  ⚠ סיבת אי-קבלה — פנימי בלבד, לא נשלח למועמד/ת
                </div>
                <Field label="סיבת דחייה (חובה)">
                  <Input value={form.rejectionReason||''} onChange={v=>update('rejectionReason',v)}
                    placeholder="למשל: אין התאמה לתחום / מוטיבציה חלשה / ניסיון קודם חסר"/>
                </Field>
              </div>
            )}

            {passed && !alreadyConverted && (
              <div className="col-span-full mt-4 rounded-xl p-4 text-[13.5px]"
                style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--accent)', color: 'var(--ink)' }}>
                ✓ עבר ראיון. <strong>בעת שמירה</strong>, המועמד/ת יועבר/תועבר אוטומטית לרשימת הסטודנטים
                עם כל המסמכים. השלבים הבאים: הכנה + CV מעודכן, ואז בחירת ארגון.
              </div>
            )}
            {alreadyConverted && (
              <div className="col-span-full mt-4 text-[13.5px]" style={{ color: 'var(--accent)' }}>
                ✓ כבר הועבר לרשימת הסטודנטים. רשומת המועמד נשמרת לארכיון.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 pt-8 mt-8 border-t" style={{ borderColor: 'var(--divider)' }}>
            <button type="submit" style={{
              display: 'inline-block', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
              background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>{isNew ? 'צור' : 'שמור'} →</button>
            <button type="button" onClick={openCall} disabled={!form.phone} style={btnSmall(!form.phone)}>📞 התקשר</button>
            <button type="button" onClick={openWhatsApp} disabled={!form.phone} style={btnSmall(!form.phone)}>WhatsApp</button>
            <button type="button" onClick={openMail} disabled={!form.email} style={btnSmall(!form.email)}>✉ מייל</button>
            {!isNew && (
              <button type="button" onClick={sendCvLinkWhatsApp} disabled={!form.phone || !form.email}
                title="שלח לסטודנט קישור עדכון CV בוואטסאפ" style={btnSmall(!(form.phone && form.email))}>📎 קישור CV (WhatsApp)</button>
            )}
            {!isNew && (
              <button type="button" onClick={copyCvUpdateLink} disabled={!form.email}
                title="העתק קישור עדכון CV" style={btnSmall(!form.email)}>🔗 העתק קישור</button>
            )}
            {!isNew && onDelete && (
              <button type="button"
                onClick={() => { if (confirm('למחוק?')) onDelete(form.id); }}
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

function FileField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const isHttpUrl = /^https?:\/\//i.test(value);
  const storageMatch = value.match(/^storage:\/\/([^/]+)\/(.+)$/);
  // Plain path — legacy records saved before the storage:// convention
  const isPlainPath = !isHttpUrl && !storageMatch && /\.(pdf|docx?|doc)$/i.test(value) && value.includes('/');
  const canOpen = isHttpUrl || !!storageMatch || isPlainPath;

  function openFileUrl(rawUrl: string) {
    const isWord = /\.(docx?|doc)$/i.test(rawUrl.split('?')[0]);
    if (isWord) {
      window.open(`https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(rawUrl)}`, '_blank');
    } else {
      window.open(rawUrl, '_blank');
    }
  }

  function openFile() {
    if (isHttpUrl) { openFileUrl(value); return; }
    const bucket = storageMatch ? storageMatch[1] : 'candidate-uploads';
    const path = storageMatch ? storageMatch[2] : value;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    openFileUrl(data.publicUrl);
  }

  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || ''}
          className="input flex-1"
          style={{ padding: '12px 16px', fontSize: '13.5px', fontFamily: isHttpUrl ? 'ui-monospace, monospace' : undefined }}
        />
        {canOpen && (
          <button type="button" onClick={openFile}
            className="mono text-[11px] uppercase tracking-[0.14em] font-semibold px-4 rounded-lg shrink-0"
            style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
            פתח ↗
          </button>
        )}
        {value && (
          <button type="button" onClick={() => onChange('')}
            title="הסר קובץ"
            className="mono text-[11px] uppercase tracking-[0.14em] font-semibold px-3 rounded-lg shrink-0"
            style={{ background: 'transparent', color: 'var(--text-soft)', border: '1px solid var(--divider)' }}>
            ✕
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
