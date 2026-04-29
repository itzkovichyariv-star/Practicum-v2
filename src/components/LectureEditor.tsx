import { useState, type FormEvent } from 'react';
import type { Lecture, Course } from '../lib/supabase';
import { randomId } from '../lib/dataApi';

const DEFAULT_TYPES = ['הרצאה', 'סדנה', 'סימולציה', 'מפגש', 'ייעוץ'];
const DEFAULT_STATUSES = ['מאושר', 'ממתין לאישור', 'בקשה נשלחה', 'שינוי מתבצע', 'בוטל'];
const SEMESTERS = ['א׳', 'ב׳', 'קיץ'];
const DELIVERY_MODES = ['פרונטלי', 'זום', 'היברידי'];

type Props = {
  lecture: Lecture | null; // null = new
  courses: Course[];
  years: string[];
  defaultCourseId?: string;
  defaultYear?: string;
  typeOptions?: string[];     // merged presets + existing data
  statusOptions?: string[];   // merged presets + existing data
  onSave: (l: Lecture) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
};

export default function LectureEditor({
  lecture, courses, years, defaultCourseId, defaultYear, typeOptions, statusOptions, onSave, onDelete, onClose,
}: Props) {
  const types = Array.from(new Set([...(typeOptions || []), ...DEFAULT_TYPES])).filter(Boolean);
  const statuses = Array.from(new Set([...(statusOptions || []), ...DEFAULT_STATUSES])).filter(Boolean);
  const isNew = !lecture;
  const [form, setForm] = useState<Lecture>({
    id: lecture?.id || randomId('lec'),
    type: lecture?.type || 'הרצאה',
    status: lecture?.status || 'ממתין לאישור',
    semester: lecture?.semester || 'ב׳',
    courseId: lecture?.courseId || (defaultCourseId !== '__all__' ? defaultCourseId : ''),
    year: lecture?.year || (defaultYear !== '__all__' ? defaultYear : ''),
    date: lecture?.date || '',
    startTime: lecture?.startTime || '',
    endTime: lecture?.endTime || '',
    topic: lecture?.topic || '',
    lecturer: lecture?.lecturer || '',
    lecturerEmail: lecture?.lecturerEmail || '',
    lecturerPhone: lecture?.lecturerPhone || '',
    institution: lecture?.institution || 'אוניברסיטת אריאל',
    location: lecture?.location || '',
    link: lecture?.link || '',
    cost: lecture?.cost ?? '',
    notes: lecture?.notes || '',
  });

  function update<K extends keyof Lecture>(key: K, v: Lecture[K]) {
    setForm(f => ({ ...f, [key]: v }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const missing: string[] = [];
    if (!form.lecturer?.trim()) missing.push('שם המרצה');
    if (!form.lecturerPhone?.trim()) missing.push('טלפון המרצה');
    if (!form.lecturerEmail?.trim()) missing.push('מייל המרצה');
    if (missing.length) {
      alert('שדות חובה חסרים:\n• ' + missing.join('\n• '));
      return;
    }
    const selectedCourse = courses.find(c => c.id === form.courseId);
    const toSave: Lecture = {
      ...form,
      courseName: selectedCourse?.name || form.courseName,
    };
    onSave(toSave);
  }

  function openCall() {
    if (!form.lecturerPhone) { alert('לא הוזן טלפון של המרצה'); return; }
    window.location.href = `tel:${form.lecturerPhone.replace(/[^\d+]/g, '')}`;
  }

  function addHour(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const nh = (h + 1) % 24;
    return `${String(nh).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
  }

  function openWhatsApp() {
    if (!form.lecturerPhone) { alert('לא הוזן טלפון של המרצה'); return; }
    let n = form.lecturerPhone.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '972' + n.slice(1);
    window.open(`https://wa.me/${n}`, '_blank');
  }

  function openOutlookCompose() {
    if (!form.lecturerEmail) { alert('לא הוזן מייל של המרצה'); return; }
    const course = courses.find(c => c.id === form.courseId);
    const subject = encodeURIComponent(`${form.type}: ${course?.name || ''} — ${form.topic || ''}`);
    const body = encodeURIComponent(
`שלום ${form.lecturer || ''},

אנא אשר את הפרטים להלן:
קורס: ${course?.name || ''}
נושא: ${form.topic || ''}
תאריך: ${form.date || ''}  שעה: ${form.startTime || ''}
מיקום: ${form.location || form.link || ''}

תודה,
ד״ר יריב איצקוביץ
`);
    const url = `mailto:${encodeURIComponent(form.lecturerEmail)}?subject=${subject}&body=${body}`;
    window.location.href = url;
  }

  function addToOutlookCalendar() {
    if (!form.date || !form.startTime) {
      alert('חסר תאריך / שעת התחלה');
      return;
    }
    const course = courses.find(c => c.id === form.courseId);
    // Build ISO datetimes in Israel timezone
    const startLocal = `${form.date}T${form.startTime}:00`;
    const endLocal = form.endTime ? `${form.date}T${form.endTime}:00` : `${form.date}T${addHour(form.startTime)}:00`;
    const subject = encodeURIComponent(`${form.type || 'הרצאה'}: ${form.topic || course?.name || ''}`);
    const location = encodeURIComponent(form.link || form.location || form.institution || '');
    const body = encodeURIComponent(
`${form.topic || ''}
${course?.name ? 'קורס: ' + course.name : ''}
${form.lecturer ? 'מרצה: ' + form.lecturer : ''}
${form.lecturerEmail ? 'מייל: ' + form.lecturerEmail : ''}
${form.lecturerPhone ? 'טלפון: ' + form.lecturerPhone : ''}
${form.notes ? '\nהערות: ' + form.notes : ''}`);
    const attendees = form.lecturerEmail ? `&to=${encodeURIComponent(form.lecturerEmail)}` : '';
    // Outlook for Work deeplink — opens create-event form pre-filled
    const url = `https://outlook.office.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=${subject}&body=${body}&location=${location}&startdt=${encodeURIComponent(startLocal)}&enddt=${encodeURIComponent(endLocal)}${attendees}`;
    window.open(url, '_blank');
  }

  return (
    <div
      className="fixed inset-0 z-[200] overflow-y-auto"
      style={{ background: 'rgba(26, 22, 18, 0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative max-w-[800px] w-full my-6 mx-auto rounded-2xl"
        style={{ background: 'var(--bg)', boxShadow: '0 24px 80px rgba(26, 22, 18, 0.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="px-10 py-10">
          <div className="flex items-start justify-between gap-8 pb-6 border-b mb-8" style={{ borderColor: 'var(--divider)' }}>
            <div>
              <div className="chapter-mark mb-2">{isNew ? 'הרצאה חדשה' : 'עריכת הרצאה'}</div>
              <h2 className="serif text-[32px] leading-[1.1] tracking-tight" style={{ color: 'var(--ink)' }}>
                {form.topic || (isNew ? 'הוסף פרטים' : 'ללא נושא')}
              </h2>
            </div>
            <button type="button" onClick={onClose} className="mono text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">סגור ✕</button>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <Field label="סוג (בחר או הקלד חדש)">
              <Combobox value={form.type||''} onChange={v=>update('type',v)} options={types} placeholder="הרצאה / סדנה / סמינר..."/>
            </Field>
            <Field label="סטטוס"><Select value={form.status||''} onChange={v=>update('status',v)} options={statuses}/></Field>

            <Field label="קורס">
              <Select
                value={form.courseId||''}
                onChange={v=>update('courseId',v)}
                options={courses.map(c => ({ value: c.id, label: c.name }))}
                placeholder="בחר קורס"
              />
            </Field>
            <Field label="שנה אקדמית">
              <Select value={form.year||''} onChange={v=>update('year',v)} options={years} placeholder="בחר שנה" />
            </Field>

            <Field label="סמסטר"><Select value={form.semester||''} onChange={v=>update('semester',v)} options={SEMESTERS}/></Field>
            <Field label="מוסד"><Input value={form.institution||''} onChange={v=>update('institution',v)} placeholder="אוניברסיטת אריאל"/></Field>

            <Field label="תאריך"><Input type="date" value={form.date||''} onChange={v=>update('date',v)}/></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="שעת התחלה"><Input type="time" value={form.startTime||''} onChange={v=>update('startTime',v)}/></Field>
              <Field label="שעת סיום"><Input type="time" value={form.endTime||''} onChange={v=>update('endTime',v)}/></Field>
            </div>

            <div className="col-span-2">
              <Field label="נושא / כותרת"><Input value={form.topic||''} onChange={v=>update('topic',v)} placeholder="למשל: בניית תכנית התערבות"/></Field>
            </div>

            <Field label="שם המרצה *" required><Input value={form.lecturer||''} onChange={v=>update('lecturer',v)} placeholder="שם מלא" highlight={!form.lecturer?.trim()}/></Field>
            <Field label="מייל המרצה *" required><Input type="email" value={form.lecturerEmail||''} onChange={v=>update('lecturerEmail',v)} placeholder="name@example.com" highlight={!form.lecturerEmail?.trim()}/></Field>
            <Field label="טלפון המרצה *" required><Input value={form.lecturerPhone||''} onChange={v=>update('lecturerPhone',v)} placeholder="05X-XXXXXXX" highlight={!form.lecturerPhone?.trim()}/></Field>
            <Field label="אופן העברה"><Select value={form.location||''} onChange={v=>update('location',v)} options={DELIVERY_MODES} placeholder="בחר..."/></Field>

            <div className="col-span-2">
              <Field label="קישור / כיתה (זום או מיקום פיזי)"><Input value={form.link||''} onChange={v=>update('link',v)} placeholder="https://... או בניין 100 כיתה 301"/></Field>
            </div>

            <Field label="עלות (₪)"><Input value={String(form.cost ?? '')} onChange={v=>update('cost', v)} placeholder="0"/></Field>
            <div />

            <div className="col-span-2">
              <Field label="הערות"><Textarea value={form.notes||''} onChange={v=>update('notes',v)} rows={3}/></Field>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-8 mt-8 border-t" style={{ borderColor: 'var(--divider)' }}>
            <button type="submit" className="btn btn-primary">
              {isNew ? 'צור הרצאה' : 'שמור שינויים'} <span className="serif text-[16px]">→</span>
            </button>
            <button type="button" onClick={addToOutlookCalendar} className="btn" disabled={!form.date || !form.startTime}>📅 הוסף ליומן Outlook</button>
            <button type="button" onClick={openCall} className="btn" disabled={!form.lecturerPhone}>📞 התקשר למרצה</button>
            <button type="button" onClick={openWhatsApp} className="btn" disabled={!form.lecturerPhone}>WhatsApp</button>
            <button type="button" onClick={openOutlookCompose} className="btn" disabled={!form.lecturerEmail}>
              מייל למרצה (Outlook)
            </button>
            {!isNew && onDelete && (
              <button
                type="button"
                onClick={() => { if (confirm('למחוק הרצאה זו?')) onDelete(form.id); }}
                className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold mr-auto hover:opacity-70"
                style={{ color: 'var(--accent)' }}
              >
                🗑 מחק
              </button>
            )}
            <button type="button" onClick={onClose} className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold opacity-60 hover:opacity-100">
              בטל
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ==== Form primitives ==== */

function Field({ label, children, required }: { label: string; children: any; required?: boolean }) {
  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>
        {label}
        {required && <span style={{ color: 'var(--accent)', marginRight: '3px' }}>*</span>}
      </span>
      {children}
    </label>
  );
}

function Input({
  value, onChange, type = 'text', placeholder, highlight,
}: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string; highlight?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="input"
      style={{
        padding: '12px 16px', fontSize: '14.5px',
        borderColor: highlight ? 'rgba(122,30,43,0.5)' : undefined,
        background: highlight ? 'rgba(122,30,43,0.03)' : undefined,
      }}
    />
  );
}

function Textarea({
  value, onChange, rows = 3,
}: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      className="input"
      style={{ padding: '12px 16px', fontSize: '14.5px', resize: 'vertical', minHeight: '72px' }}
    />
  );
}

function Combobox({
  value, onChange, options, placeholder,
}: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  const listId = 'cb-' + Math.random().toString(36).slice(2, 8);
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
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

function Select({
  value, onChange, options, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
  placeholder?: string;
}) {
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
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
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
