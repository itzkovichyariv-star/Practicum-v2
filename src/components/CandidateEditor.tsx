import { useState, useEffect, useRef, type FormEvent } from 'react';
import { btnSmall, btnSecondary } from '../lib/design';
import type { Candidate, Course } from '../lib/supabase';
import { randomId } from '../lib/dataApi';
import { supabase } from '../lib/supabase';
import { openMailto } from '../lib/openMailto';
import Modal from './Modal';

type Props = {
  candidate: Candidate | null;
  courses: Course[];
  years: string[];
  defaultCourseId?: string;
  defaultYear?: string;
  onSave: (c: Candidate) => void;
  /** Debounced silent persist so a live interview assessment is never lost. */
  onAutoSave?: (c: Candidate) => Promise<void>;
  onDelete?: (id: string) => void;
  onConvertToStudent?: (c: Candidate) => void;
  onClose: () => void;
};

export default function CandidateEditor({
  candidate, courses, years, defaultCourseId, defaultYear, onSave, onAutoSave, onDelete, onConvertToStudent, onClose,
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
    interviewConducted: candidate?.interviewConducted || false,
    interviewConductedAt: candidate?.interviewConductedAt || '',
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

  // ── Auto-save (debounced) — a live interview assessment is never lost ──
  // Persists ~1.5s after you stop editing, silently. The pass/fail decision can
  // stay "ממתין" — it's saved like any other field, no decision is forced.
  const [autoSave, setAutoSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (!onAutoSave || !form.name.trim()) return;
    // While the result is "ממתין" we auto-save freely (the whole point). Once a
    // pass/fail is set we mirror the explicit-save rules so we never persist an
    // invalid final state: passed/failed need a summary; failed also needs a reason.
    if ((form.interviewResult === 'passed' || form.interviewResult === 'failed') && !form.interviewSummary?.trim()) return;
    if (form.interviewResult === 'failed' && !form.rejectionReason?.trim()) return;
    const t = setTimeout(async () => {
      setAutoSave('saving');
      try { await onAutoSave(form); setAutoSave('saved'); }
      catch { setAutoSave('error'); }
    }, 1500);
    return () => clearTimeout(t);
  }, [form]); // re-armed on every edit; the timeout debounces

  // Pipeline stage
  const hasDocs = !!form.cvUrl;
  const hasInterview = !!form.interviewDate;
  const passed = form.interviewResult === 'passed';
  const alreadyConverted = !!form.convertedToStudentId;
  const conductedPending = !!form.interviewConducted && form.interviewResult !== 'passed' && form.interviewResult !== 'failed';
  const stage = alreadyConverted ? 'הועבר לסטודנטים' :
                passed ? 'עבר — מוכן/ה להעברה' :
                hasInterview && form.interviewResult === 'failed' ? 'לא עבר ראיון' :
                conductedPending ? 'ראיון בוצע — בהערכה (החלטה בהמשך)' :
                hasInterview ? 'ממתין/ה לראיון' :
                hasDocs ? 'קורות חיים הוגשו — לקבוע ראיון' :
                'ממתין/ה לקורות חיים';

  function update<K extends keyof Candidate>(k: K, v: Candidate[K]) { setForm(f => ({ ...f, [k]: v })); }

  // "ראיון בוצע" toggle. Marking it also fires an IMMEDIATE save (not the 1.5s
  // debounce) — a deliberate checkpoint so the assessment captured during the
  // interview is protected the moment you flag the interview as done.
  async function setConducted(v: boolean) {
    const updated: Candidate = {
      ...form,
      interviewConducted: v,
      interviewConductedAt: v ? (form.interviewConductedAt || new Date().toISOString()) : form.interviewConductedAt,
    };
    setForm(updated);
    if (onAutoSave && updated.name.trim()) {
      setAutoSave('saving');
      try { await onAutoSave(updated); setAutoSave('saved'); } catch { setAutoSave('error'); }
    }
  }

  // Unified status selector behind the "תוצאה / סטטוס" dropdown. It maps the four
  // user-facing states onto the two underlying fields, and keeps the "ראיון בוצע"
  // checkbox + the candidates-page filter tab perfectly in sync:
  //   pending   → not conducted, no result
  //   conducted → interview happened, decision pending (immediate checkpoint save,
  //               the same protection the checkbox gives)
  //   passed/failed → a decision implies the interview was conducted
  async function setStatus(status: string) {
    if (status === 'conducted') { await setConducted(true); return; }
    if (status === 'pending') {
      setForm(f => ({ ...f, interviewResult: 'pending', interviewConducted: false }));
      return;
    }
    // passed | failed
    setForm(f => ({
      ...f,
      interviewResult: status as Candidate['interviewResult'],
      interviewConducted: true,
      interviewConductedAt: f.interviewConductedAt || new Date().toISOString(),
    }));
  }
  const statusValue =
    form.interviewResult === 'passed' ? 'passed' :
    form.interviewResult === 'failed' ? 'failed' :
    form.interviewConducted ? 'conducted' : 'pending';
  const STATUS_OPTIONS = [
    { value: 'pending',   label: 'טרם רואיין' },
    { value: 'conducted', label: 'ראיון בוצע' },
    { value: 'passed',    label: 'עבר' },
    { value: 'failed',    label: 'לא התקבל' },
  ];

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
              {onAutoSave && !isNew && autoSave !== 'idle' && (
                <div className="mono text-[11px] mt-1.5" style={{ color: autoSave === 'error' ? '#b91c1c' : autoSave === 'saving' ? 'var(--text-soft)' : '#15803d' }}>
                  {autoSave === 'saving' ? 'שומר…' : autoSave === 'saved' ? '✓ נשמר אוטומטית ☁️' : '⚠ שמירה אוטומטית נכשלה — לחץ/י שמור'}
                </div>
              )}
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
            <div className="col-span-full">
              <FileField label="קורות חיים" value={form.cvUrl||''} onChange={v=>update('cvUrl',v)}
                placeholder="לכאן יועלו קורות החיים שהמועמד/ת יצרף/ת דרך קישור ההרשמה"/>
            </div>
            {candidate?.questionnaire && (
              <div className="col-span-full">
                <QuestionnaireView q={candidate.questionnaire} candidateName={candidate.name} />
              </div>
            )}

            <div className="col-span-full">
              <div className="chapter-mark mb-3 mt-4" style={{ fontSize: '11px', color: form.cvUrl ? 'var(--accent)' : 'var(--text-soft)' }}>
                שלב 2 — ראיון {!form.cvUrl && ' 🔒 (יש להגיש קורות חיים קודם)'}
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

            <div className="col-span-full">
              <label className="flex items-start gap-2.5 cursor-pointer rounded-xl p-3"
                style={{ background: form.interviewConducted ? 'rgba(217,119,6,0.09)' : 'rgba(0,0,0,0.02)', border: `1px solid ${form.interviewConducted ? 'rgba(217,119,6,0.4)' : 'var(--divider)'}` }}>
                <input type="checkbox" checked={!!form.interviewConducted}
                  onChange={e => setConducted(e.target.checked)}
                  className="mt-0.5" style={{ accentColor: 'var(--accent)', width: 16, height: 16 }} />
                <span className="text-[13.5px] leading-[1.55]" style={{ color: 'var(--ink)' }}>
                  <strong>הראיון בוצע</strong> — סמן/י לאחר קיום הראיון. ההערכה נשמרת <strong>מיד</strong> (שמירת ביניים, מנגנון הגנה) וניתן להחליט עבר / לא עבר בהמשך.
                  {form.interviewConducted && form.interviewConductedAt && (
                    <span className="block mono text-[11px] mt-1" style={{ color: '#b45309' }}>
                      ✓ סומן: {new Date(form.interviewConductedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                </span>
              </label>
            </div>

            <Field label="תוצאה / סטטוס">
              <Select value={statusValue} onChange={v=>setStatus(v)} options={STATUS_OPTIONS}/>
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

  function getPublicUrl() {
    if (isHttpUrl) return value;
    const bucket = storageMatch ? storageMatch[1] : 'candidate-uploads';
    const path = storageMatch ? storageMatch[2] : value;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  function openFile() {
    openFileUrl(getPublicUrl());
  }

  async function downloadFile() {
    const bucket = storageMatch ? storageMatch[1] : 'candidate-uploads';
    const path = storageMatch ? storageMatch[2] : (isPlainPath ? value : null);
    if (path) {
      const { data: blob } = await supabase.storage.from(bucket).download(path);
      if (blob) {
        const filename = path.split('/').pop() || 'file';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        return;
      }
    }
    // Fallback for HTTP URLs
    const a = document.createElement('a'); a.href = getPublicUrl(); a.download = ''; a.target = '_blank'; a.click();
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
          <>
            <button type="button" onClick={openFile}
              className="mono text-[11px] uppercase tracking-[0.14em] font-semibold px-4 rounded-lg shrink-0"
              style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
              פתח ↗
            </button>
            <button type="button" onClick={downloadFile}
              className="mono text-[11px] uppercase tracking-[0.14em] font-semibold px-3 rounded-lg shrink-0"
              style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' }}
              title="הורד קובץ">
              ↓
            </button>
          </>
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

const Q_ITEMS: { key: string; question: string }[] = [
  { key: 'workHistory',   question: 'תאר/י את מקומות העבודה המרכזיים בהם עבדת עד כה, תפקידך בכל אחד מהם ומשך העסקה.' },
  { key: 'favRole',       question: 'בחר/י תפקיד אחד שאהבת במיוחד — מה בתוכו היה משמעותי עבורך?' },
  { key: 'leastFavRole',  question: 'בחר/י תפקיד שפחות התחברת אליו — מה הייתה הסיבה לכך?' },
  { key: 'whyPracticum',  question: 'מהן הסיבות שבגללן בחרת להירשם לפרקטיקום במשאבי אנוש?' },
  { key: 'whySuitable',   question: 'מדוע אתה חושב/ת שאת/ה מתאים/ה לפרקטיקום?' },
  { key: 'persistence',   question: 'ספר/י על מצב בעבר שבו נדרשת להתמיד במשימה מאתגרת לאורך זמן, למרות קשיים או עומסים. מה עזר לך? מה היו התוצאות?' },
  { key: 'expectations',  question: 'מה הציפיות שלך מהפרקטיקום?' },
];

export function QuestionnaireView({ q, candidateName }: { q: NonNullable<import('../lib/supabase').Candidate['questionnaire']>; candidateName?: string }) {
  const [open, setOpen] = useState(false);
  const filled = Q_ITEMS.filter(item => (q as any)[item.key]?.trim());
  if (filled.length === 0) return null;

  function buildHtml() {
    const rows = Q_ITEMS.map((item, idx) => {
      const ans = (q as any)[item.key]?.trim() || '';
      return `<div style="margin-bottom:20px;page-break-inside:avoid">
        <div style="font-weight:600;font-size:13px;margin-bottom:6px;direction:rtl">${idx+1}. ${item.question}</div>
        <div style="background:#f9f5f4;border:1px solid #ddd;border-radius:6px;padding:10px 14px;font-size:13px;line-height:1.7;direction:rtl;white-space:pre-wrap">${ans || '<span style="color:#aaa;font-style:italic">לא מולא</span>'}</div>
      </div>`;
    }).join('');
    return `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8">
      <title>שאלון מועמדות — ${candidateName || ''}</title>
      <style>body{font-family:Arial,sans-serif;max-width:720px;margin:32px auto;padding:0 24px;direction:rtl}
      h1{font-size:18px;margin-bottom:4px}p{color:#666;font-size:12px;margin-bottom:24px}
      @media print{body{margin:16px}}</style></head>
      <body>
        <h1>טופס הגשת מועמדות — פרקטיקום משאבי אנוש</h1>
        <p>${candidateName || ''}${q.studyTracks ? ' · ' + q.studyTracks : ''}${q.gpa ? ' · ממוצע ' + q.gpa : ''}</p>
        ${rows}
      </body></html>`;
  }

  function handlePrint() {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(buildHtml());
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 300);
  }

  function handleDownload() {
    const blob = new Blob([buildHtml()], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `שאלון_${(candidateName || 'מועמד').replace(/\s+/g, '_')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-6" style={{ borderTop: '1px solid var(--divider)', paddingTop: '24px' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 mono text-[11px] uppercase tracking-[0.14em] font-semibold"
          style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <span>שאלון מועמדות</span>
          <span style={{ fontSize: '10px', opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="mono text-[10.5px]" style={{ color: 'var(--text-soft)' }}>
            {filled.length} / {Q_ITEMS.length} שאלות
          </span>
          <button type="button" onClick={handlePrint}
            className="mono text-[10px] uppercase tracking-[0.12em] font-semibold px-2.5 py-1 rounded-full border"
            style={{ color: 'var(--accent)', borderColor: 'var(--accent)', background: 'transparent', cursor: 'pointer' }}>
            🖨 הדפס
          </button>
          <button type="button" onClick={handleDownload}
            className="mono text-[10px] uppercase tracking-[0.12em] font-semibold px-2.5 py-1 rounded-full border"
            style={{ color: 'var(--accent)', borderColor: 'var(--accent)', background: 'transparent', cursor: 'pointer' }}>
            ↓ הורד
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 rounded-xl overflow-hidden" style={{ border: '1px solid var(--divider)' }}>
          {/* Document header strip */}
          <div className="px-6 py-4 flex items-center justify-between"
            style={{ background: 'rgba(122,30,43,0.06)', borderBottom: '1px solid var(--divider)' }}>
            <div>
              <div className="serif text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>טופס הגשת מועמדות — פרקטיקום משאבי אנוש</div>
              {q.studyTracks && (
                <div className="mono text-[11px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
                  חוג: {q.studyTracks}{q.gpa ? ` · ממוצע: ${q.gpa}` : ''}
                </div>
              )}
            </div>
            <div className="mono text-[10px] uppercase tracking-widest px-2 py-1 rounded"
              style={{ background: 'rgba(122,30,43,0.1)', color: 'var(--accent)' }}>
              קריאה בלבד
            </div>
          </div>

          {/* Questions */}
          <div className="divide-y" style={{ '--tw-divide-opacity': 1 } as any}>
            {Q_ITEMS.map((item, idx) => {
              const answer = (q as any)[item.key]?.trim() || '';
              return (
                <div key={item.key} className="px-6 py-5" style={{ background: idx % 2 === 0 ? 'white' : 'rgba(0,0,0,0.015)' }}>
                  {/* Question */}
                  <div className="flex gap-3 mb-3">
                    <span className="mono text-[10px] font-semibold shrink-0 mt-0.5 w-5 text-center rounded-full h-5 flex items-center justify-center"
                      style={{ background: answer ? 'rgba(122,30,43,0.1)' : 'rgba(0,0,0,0.06)', color: answer ? 'var(--accent)' : 'var(--text-soft)', lineHeight: 1 }}>
                      {idx + 1}
                    </span>
                    <span className="text-[13px] font-semibold leading-snug" style={{ color: 'var(--ink)' }}>{item.question}</span>
                  </div>
                  {/* Answer */}
                  {answer ? (
                    <div className="mr-8 px-4 py-3 rounded-lg text-[13.5px] leading-relaxed whitespace-pre-wrap"
                      style={{ background: 'rgba(122,30,43,0.04)', border: '1px solid rgba(122,30,43,0.12)', color: 'var(--ink)', direction: 'rtl' }}>
                      {answer}
                    </div>
                  ) : (
                    <div className="mr-8 px-4 py-2 rounded-lg text-[12.5px] italic"
                      style={{ color: 'var(--text-soft)', background: 'rgba(0,0,0,0.03)' }}>
                      לא מולא
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
