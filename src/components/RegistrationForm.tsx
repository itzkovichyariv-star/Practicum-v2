import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type Status = 'idle' | 'uploading' | 'saving' | 'done' | 'error';

type PublicSlot = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  booked_count: number;
  course_name?: string;
  note?: string;
};

type Questionnaire = {
  studyTracks: string;
  gpa: string;
  workHistory: string;
  favRole: string;
  leastFavRole: string;
  whyPracticum: string;
  whySuitable: string;
  persistence: string;
  expectations: string;
};

const EMPTY_Q: Questionnaire = {
  studyTracks: '',
  gpa: '',
  workHistory: '',
  favRole: '',
  leastFavRole: '',
  whyPracticum: '',
  whySuitable: '',
  persistence: '',
  expectations: '',
};

async function uploadFile(file: File, prefix: string): Promise<string | null> {
  const safeFolder = (prefix || '').replace(/[^a-zA-Z0-9._-]/g, '') || 'candidate';
  const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8) || 'bin';
  const randomTag = Math.random().toString(36).slice(2, 10);
  const path = `${safeFolder}/${Date.now()}-${randomTag}.${ext}`;
  const { error } = await supabase.storage.from('candidate-uploads').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) { console.error('upload failed:', error); return null; }
  return path;
}

export default function RegistrationForm() {
  const urlParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  const urlCourse = urlParams.get('course') || '';
  const urlYear   = urlParams.get('year')   || '';

  const [form, setForm] = useState({
    name: '', phone: '', email: '', city: '',
    course: urlCourse,
    year: urlYear || 'תשפ״ז',
  });
  const locked = !!(urlCourse && urlYear);
  const [q, setQ] = useState<Questionnaire>(EMPTY_Q);
  const [cv, setCv] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [qErrors, setQErrors] = useState<Partial<Record<keyof Questionnaire, boolean>>>({});
  const [availableSlots, setAvailableSlots] = useState<PublicSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');
  const [slotErr, setSlotErr] = useState(false);
  const [notifyDiag, setNotifyDiag] = useState<string | null>(null);
  const [courses, setCourses] = useState<{ name: string; year?: string }[]>([]);
  const [years, setYears] = useState<string[]>(['תשפ״ו', 'תשפ״ז']);

  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase
        .from('practicum_data').select('data').order('updated_at', { ascending: false }).limit(1);
      const allCourses: any[] = rows?.[0]?.data?.courses || [];
      const practicumCourses = allCourses.filter((c: any) =>
        c.id && (c.id.includes('practicum') || c.name?.includes('פרקטיקום'))
      );
      const list = practicumCourses.map((c: any) => ({ name: c.name as string, year: c.year as string | undefined }));
      const seen = new Set<string>();
      const unique = list.filter(c => {
        const key = `${c.name}||${c.year||''}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      unique.sort((a, b) => (b.year || '').localeCompare(a.year || '', 'he'));
      setCourses(unique);
      const yearsSet = new Set<string>(['תשפ״ז', 'תשפ״ו']);
      list.forEach(c => c.year && yearsSet.add(c.year));
      setYears(Array.from(yearsSet).sort().reverse());
      if (!urlCourse && unique.length > 0) setForm(f => f.course ? f : { ...f, course: unique[0].name });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase.from('public_interview_slots')
        .select('*').gte('date', today).order('date').order('start_time');
      if (error) console.warn('slot fetch:', error);
      setAvailableSlots(((data || []) as PublicSlot[]).filter(s => s.booked_count < s.capacity));
    })();
  }, []);

  function updateQ(key: keyof Questionnaire, val: string) {
    setQ(prev => ({ ...prev, [key]: val }));
    if (val.trim()) setQErrors(prev => ({ ...prev, [key]: false }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!form.name.trim() || !form.email.trim()) { setErr('שם ומייל נדרשים'); return; }
    if (!cv) { setErr('יש להעלות קורות חיים'); return; }

    // Validate all questionnaire fields
    const missingQ: Partial<Record<keyof Questionnaire, boolean>> = {};
    (Object.keys(EMPTY_Q) as (keyof Questionnaire)[]).forEach(k => {
      if (!q[k].trim()) missingQ[k] = true;
    });
    if (Object.keys(missingQ).length > 0) {
      setQErrors(missingQ);
      setErr('יש למלא את כל שדות השאלון');
      const firstKey = Object.keys(missingQ)[0];
      setTimeout(() => document.getElementById(`q-${firstKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }

    if (availableSlots.length > 0 && !selectedSlotId) {
      setSlotErr(true);
      setErr('יש לבחור מועד ראיון לפני שליחת הטופס');
      setTimeout(() => document.getElementById('slot-err-banner')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }

    setStatus('uploading');
    const prefix = (form.email.split('@')[0] || 'candidate').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || `c${Date.now()}`;
    const cvPath = await uploadFile(cv, prefix);
    if (!cvPath) { setStatus('error'); setErr('העלאת קורות החיים נכשלה. נסה/י שוב.'); return; }

    setStatus('saving');
    const slot = availableSlots.find(s => s.id === selectedSlotId) || null;
    const noSlotsMarker = availableSlots.length === 0
      ? '⚠ לא היו מועדים פנויים בעת ההגשה — המועמד/ת הופנה/תה לד״ר איצקוביץ לתיאום ראיון ידני'
      : '';
    const noteWithSlot = slot
      ? `בחר מועד ראיון: ${slot.date} ${slot.start_time}–${slot.end_time}`
      : noSlotsMarker;

    const record = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim(),
      city: form.city.trim() || null,
      course_name: form.course,
      year: form.year,
      cv_file_path: cvPath,
      application_file_path: null,
      notes: noteWithSlot || null,
      questionnaire: q,
    };

    const { error } = await supabase.from('candidate_submissions').insert(record);
    if (error) { setStatus('error'); setErr('שמירה נכשלה: ' + error.message); return; }

    if (slot) {
      const { data: updated, error: updErr } = await supabase.from('public_interview_slots')
        .update({ booked_count: slot.booked_count + 1, booked_by: form.name })
        .eq('id', slot.id).select();
      if (updErr) setNotifyDiag(`slot booking failed: ${updErr.message}`);
      else if (!updated || updated.length === 0) setNotifyDiag('slot booking: 0 rows changed (likely RLS).');
    }

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token || 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
      const r = await fetch('https://vpqgmcmavnszcnakhiat.supabase.co/functions/v1/notify-submission', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt',
        },
        body: JSON.stringify({ record }),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        setNotifyDiag(`notify-submission HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
    } catch (e: any) {
      setNotifyDiag('notify-submission network error: ' + (e?.message || e));
    }

    setStatus('done');
  }

  if (status === 'done') {
    const bookedSlot = availableSlots.find(s => s.id === selectedSlotId);
    return (
      <div className="max-w-[560px] mx-auto p-10 text-center">
        <div className="chapter-mark mb-4">✓ נקלט/ה</div>
        <h1 className="serif text-[40px] leading-[1.1] tracking-tight mb-4" style={{ color: 'var(--ink)' }}>
          תודה, <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{form.name.split(' ')[0] || 'מועמד/ת'}</em>.
        </h1>
        <p className="text-[16px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
          הבקשה וקורות החיים נקלטו.
        </p>

        {bookedSlot ? (
          <div className="mt-6 rounded-xl p-5 text-right" style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--accent)' }}>
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--accent)' }}>מועד הראיון שבחרת</div>
            <div className="serif text-[22px]" style={{ color: 'var(--ink)' }}>
              {new Date(bookedSlot.date).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <div className="mono text-[13px] tracking-[0.08em] mt-1" style={{ color: 'var(--ink)' }}>
              <span dir="ltr" style={{ display: 'inline-block' }}>{bookedSlot.start_time}–{bookedSlot.end_time}</span>
              {bookedSlot.note && ` · ${bookedSlot.note}`}
            </div>
            <div className="text-[12px] mt-3" style={{ color: 'var(--text-soft)' }}>
              נשלח אישור מפורט למייל שהזנת. אם צריך לשנות — צור קשר.
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-xl p-5 text-right" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--divider)' }}>
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--text-soft)' }}>תיאום ראיון</div>
            <p className="text-[14.5px] leading-[1.7]" style={{ color: 'var(--ink)' }}>
              מאחר ולא היו מועדי ראיון זמינים לבחירה, יש ליצור קשר ביוזמתך עם מנחה הפרקטיקום לתיאום מועד ראיון:
            </p>
            <p className="mt-2 font-semibold text-[15px]" style={{ color: 'var(--ink)' }}>ד״ר יריב איצקוביץ</p>
            <a href="mailto:yarivi@ariel.ac.il" className="mono text-[13px] tracking-[0.06em]"
              style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
              yarivi@ariel.ac.il
            </a>
            <p className="text-[12.5px] leading-[1.6] mt-3" style={{ color: 'var(--text-soft)' }}>
              בכל שאלה או בעיה אחרת ניתן לפנות לד״ר יריב איצקוביץ או לרחל.
            </p>
          </div>
        )}

        <div className="mono text-[11px] uppercase tracking-[0.14em] mt-8" style={{ color: 'var(--text-soft)' }}>
          Ariel University · Management · Practicum
        </div>
      </div>
    );
  }

  const busy = status === 'uploading' || status === 'saving';

  return (
    <div className="max-w-[600px] mx-auto p-10">
      <div className="chapter-mark mb-4">הרשמה לפרקטיקום</div>
      <h1 className="serif text-[36px] leading-[1.1] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
        הגשת מועמדות
      </h1>
      <p className="text-[15px] leading-[1.6] mb-3" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        יש למלא את כל שדות הטופס, לצרף קורות חיים מעודכנים ולבחור מועד ראיון.
        כל השדות הכרחיים. יש להגיש לפחות שבוע לפני מועד הראיון שנבחר.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── פרטים אישיים ── */}
        <SectionTitle>פרטים אישיים</SectionTitle>

        <Field label="שם מלא *"><Input value={form.name} onChange={v => setForm({ ...form, name: v })} required /></Field>
        <Field label="מייל *"><Input type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} required /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="טלפון נייד *"><Input type="tel" value={form.phone} onChange={v => setForm({ ...form, phone: v })} required /></Field>
          <Field label="עיר מגורים *"><Input value={form.city} onChange={v => setForm({ ...form, city: v })} required /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="חוגי לימוד *" error={qErrors.studyTracks}>
            <Input id="q-studyTracks" value={q.studyTracks} onChange={v => updateQ('studyTracks', v)} required error={qErrors.studyTracks} />
          </Field>
          <Field label="ממוצע ציונים שנה א׳+ב׳ *" error={qErrors.gpa}>
            <Input id="q-gpa" value={q.gpa} onChange={v => updateQ('gpa', v)} required error={qErrors.gpa} />
          </Field>
        </div>

        {locked ? (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--divider)' }}>
            <span className="text-[18px]">🎓</span>
            <div>
              <div className="text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>{form.course}</div>
              <div className="mono text-[11px] uppercase tracking-[0.13em]" style={{ color: 'var(--text-soft)' }}>{form.year}</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="קורס">
              <Select value={form.course} onChange={v => setForm({ ...form, course: v })}
                options={courses.length > 0 ? courses.map(c => c.name) : ['פרקטיקום משאבי אנוש', 'אחר']} />
            </Field>
            <Field label="שנה אקדמית">
              <Select value={form.year} onChange={v => setForm({ ...form, year: v })} options={years} />
            </Field>
          </div>
        )}

        {/* ── שאלון אישי ── */}
        <SectionTitle>שאלון אישי</SectionTitle>

        <QField id="q-workHistory" label="תאר/י את מקומות העבודה המרכזיים בהם עבדת עד כה, תפקידך בכל אחד מהם ומשך העסקה." error={qErrors.workHistory}>
          <Textarea id="q-workHistory" value={q.workHistory} onChange={v => updateQ('workHistory', v)} rows={4} error={qErrors.workHistory} />
        </QField>

        <QField id="q-favRole" label="בחר/י תפקיד אחד שאהבת במיוחד — מה בתוכו היה משמעותי עבורך?" error={qErrors.favRole}>
          <Textarea id="q-favRole" value={q.favRole} onChange={v => updateQ('favRole', v)} rows={4} error={qErrors.favRole} />
        </QField>

        <QField id="q-leastFavRole" label="בחר/י תפקיד שפחות התחברת אליו — מה הייתה הסיבה לכך?" error={qErrors.leastFavRole}>
          <Textarea id="q-leastFavRole" value={q.leastFavRole} onChange={v => updateQ('leastFavRole', v)} rows={4} error={qErrors.leastFavRole} />
        </QField>

        <QField id="q-whyPracticum" label="מהן הסיבות שבגללן בחרת להירשם לפרקטיקום במשאבי אנוש?" error={qErrors.whyPracticum}>
          <Textarea id="q-whyPracticum" value={q.whyPracticum} onChange={v => updateQ('whyPracticum', v)} rows={4} error={qErrors.whyPracticum} />
        </QField>

        <QField id="q-whySuitable" label="מדוע אתה חושב/ת שאת/ה מתאים/ה לפרקטיקום?" error={qErrors.whySuitable}>
          <Textarea id="q-whySuitable" value={q.whySuitable} onChange={v => updateQ('whySuitable', v)} rows={4} error={qErrors.whySuitable} />
        </QField>

        <QField id="q-persistence" label="ספר/י על מצב בעבר שבו נדרשת להתמיד במשימה מאתגרת לאורך זמן, למרות קשיים או עומסים. מה עזר לך? מה היו התוצאות?" error={qErrors.persistence}>
          <Textarea id="q-persistence" value={q.persistence} onChange={v => updateQ('persistence', v)} rows={5} error={qErrors.persistence} />
        </QField>

        <QField id="q-expectations" label="מה הציפיות שלך מהפרקטיקום?" error={qErrors.expectations}>
          <Textarea id="q-expectations" value={q.expectations} onChange={v => updateQ('expectations', v)} rows={4} error={qErrors.expectations} />
        </QField>

        {/* ── קורות חיים ── */}
        <SectionTitle>קורות חיים</SectionTitle>
        <FileInput label="קורות חיים מעודכנים (PDF / Word) *" file={cv} onChange={setCv} />

        {/* ── מועד ראיון ── */}
        <SectionTitle>מועד ראיון</SectionTitle>

        {availableSlots.length > 0 ? (
          <div>
            {slotErr && (
              <div id="slot-err-banner" className="mb-3 px-4 py-3 rounded-lg text-[14px] font-semibold text-center"
                style={{ background: 'rgba(122,30,43,0.1)', color: 'var(--accent)', border: '1.5px solid var(--accent)' }}>
                ⚠ יש לבחור מועד ראיון לפני שליחת הטופס
              </div>
            )}
            <div className="space-y-1.5">
              {availableSlots.map(s => (
                <label key={s.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-[rgba(122,30,43,0.04)]"
                  style={{
                    borderColor: selectedSlotId === s.id ? 'var(--accent)' : slotErr ? 'rgba(122,30,43,0.3)' : 'var(--divider)',
                    background: selectedSlotId === s.id ? 'rgba(122,30,43,0.06)' : 'transparent',
                  }}>
                  <input type="radio" name="slot" value={s.id}
                    checked={selectedSlotId === s.id}
                    onChange={() => { setSelectedSlotId(s.id); setSlotErr(false); setErr(null); }} />
                  <span className="serif text-[16px]" style={{ color: 'var(--ink)' }}>
                    {new Date(s.date).toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: 'long' })}
                  </span>
                  <span className="mono text-[12px] tracking-[0.1em]" style={{ color: 'var(--accent)' }}>
                    {s.start_time}–{s.end_time}
                  </span>
                  {s.note && <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>· {s.note}</span>}
                  <span className="mr-auto mono text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>
                    {s.capacity - s.booked_count} פנויים
                  </span>
                </label>
              ))}
            </div>
            <div className="text-[11.5px] mt-2" style={{ color: slotErr ? 'var(--accent)' : 'var(--text-soft)' }}>
              {selectedSlotId ? 'תוכל/י לשנות את המועד מול הצוות אם צריך.' : 'בחירת מועד ראיון נדרשת להמשך.'}
            </div>
          </div>
        ) : (
          <div className="rounded-xl p-5 text-right" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--divider)' }}>
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--text-soft)' }}>תיאום ראיון</div>
            <p className="text-[14.5px] leading-[1.7]" style={{ color: 'var(--ink)' }}>
              אין כרגע מועדי ראיון זמינים לבחירה. ניתן להשלים את ההגשה, ולאחר מכן יש ליצור קשר ביוזמתך עם מנחה הפרקטיקום לתיאום מועד ראיון:
            </p>
            <p className="mt-2 font-semibold text-[15px]" style={{ color: 'var(--ink)' }}>ד״ר יריב איצקוביץ</p>
            <a href="mailto:yarivi@ariel.ac.il" className="mono text-[13px] tracking-[0.06em]"
              style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
              yarivi@ariel.ac.il
            </a>
            <p className="text-[12.5px] leading-[1.6] mt-3" style={{ color: 'var(--text-soft)' }}>
              בכל שאלה או בעיה אחרת ניתן לפנות לד״ר יריב איצקוביץ או לרחל.
            </p>
          </div>
        )}

        {err && (
          <div className="px-4 py-3 rounded-lg text-[13.5px] font-semibold"
            style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
            ⚠ {err}
          </div>
        )}

        <button type="submit" disabled={busy} style={{
          display: 'block', width: '100%', marginTop: '8px', padding: '16px',
          fontSize: '15px', fontWeight: 600,
          background: busy ? 'var(--divider)' : 'var(--accent)',
          color: 'white', border: 'none', borderRadius: '12px',
          cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1,
        }}>
          {status === 'uploading' ? 'מעלה קורות חיים...' : status === 'saving' ? 'שומר...' : 'שלח הגשת מועמדות ←'}
        </button>

        <p className="mono text-[10.5px] uppercase tracking-[0.14em] text-center pt-1" style={{ color: 'var(--text-soft)' }}>
          הקבצים נשמרים באופן מאובטח. רק הצוות שלנו רואה אותם.
        </p>
      </form>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="pt-3 pb-1 border-b" style={{ borderColor: 'var(--divider)' }}>
      <span className="mono text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--accent)' }}>{children}</span>
    </div>
  );
}

function Field({ label, children, error }: { label: string; children: any; error?: boolean }) {
  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em', color: error ? 'var(--accent)' : undefined }}>{label}</span>
      {children}
    </label>
  );
}

function QField({ id, label, children, error }: { id: string; label: string; children: any; error?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="block mb-1.5 text-[14px] leading-[1.5]"
        style={{ color: error ? 'var(--accent)' : 'var(--ink)', fontWeight: error ? 600 : 400 }}>
        {label}
        {error && <span className="mr-2 mono text-[11px] uppercase tracking-[0.12em]">— שדה חובה</span>}
      </label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', required, id, error }: {
  value: string; onChange: (v: string) => void; type?: string; required?: boolean; id?: string; error?: boolean;
}) {
  return (
    <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
      className="input w-full" style={{
        padding: '12px 16px', fontSize: '14.5px',
        borderColor: error ? 'var(--accent)' : undefined,
        outline: error ? '2px solid rgba(122,30,43,0.2)' : undefined,
      }} />
  );
}

function Textarea({ value, onChange, rows = 4, id, error }: {
  value: string; onChange: (v: string) => void; rows?: number; id?: string; error?: boolean;
}) {
  return (
    <textarea id={id} value={value} onChange={e => onChange(e.target.value)} rows={rows}
      className="input w-full" style={{
        padding: '12px 16px', fontSize: '14px', resize: 'vertical',
        borderColor: error ? 'var(--accent)' : undefined,
        outline: error ? '2px solid rgba(122,30,43,0.2)' : undefined,
      }} />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  // Deduplicate options before rendering — course names can repeat across
  // academic years, causing React duplicate-key warnings when keyed by value.
  const unique = options.filter((o, i) => options.indexOf(o) === i);
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="input w-full"
      style={{
        padding: '12px 16px', fontSize: '14.5px',
        appearance: 'none', WebkitAppearance: 'none',
        backgroundImage: 'linear-gradient(45deg, transparent 50%, var(--accent) 50%), linear-gradient(135deg, var(--accent) 50%, transparent 50%)',
        backgroundPosition: 'calc(100% - 14px) center, calc(100% - 10px) center',
        backgroundSize: '5px 5px', backgroundRepeat: 'no-repeat', paddingLeft: '28px',
      }}>
      {unique.map((o, i) => <option key={i} value={o}>{o}</option>)}
    </select>
  );
}

function FileInput({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  return (
    <label className="block mb-3">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <div className="border-2 border-dashed rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors hover:bg-[rgba(122,30,43,0.04)]"
        style={{
          borderColor: file ? 'var(--accent)' : 'var(--accent)',
          background: file ? 'transparent' : 'rgba(122,30,43,0.05)',
        }}>
        <input type="file" accept=".pdf,.doc,.docx" onChange={e => onChange(e.target.files?.[0] || null)} className="hidden" />
        <span className="serif text-[24px]" style={{ color: 'var(--accent)' }}>{file ? '✓' : '📎'}</span>
        <span className="text-[13.5px] flex-1" style={{ color: file ? 'var(--ink)' : 'var(--accent)', fontWeight: '500' }}>
          {file ? file.name : 'לחץ כדי לבחור קובץ'}
        </span>
        {file && (
          <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onChange(null); }}
            className="mono text-[10px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100">הסר</button>
        )}
      </div>
    </label>
  );
}
