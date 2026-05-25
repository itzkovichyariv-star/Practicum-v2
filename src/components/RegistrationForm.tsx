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

async function uploadFile(file: File, prefix: string): Promise<string | null> {
  // Supabase Storage rejects non-ASCII keys. Keep only safe chars in both folder and filename.
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
  // Read URL query params for pre-filled course + year
  const urlParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  const urlCourse = urlParams.get('course') || '';
  const urlYear   = urlParams.get('year')   || '';

  const [form, setForm] = useState({
    name: '', phone: '', email: '', city: '',
    course: urlCourse,
    year:   urlYear || 'תשפ״ז',
    notes: '',
  });
  const locked = !!(urlCourse && urlYear);
  const [cv, setCv] = useState<File | null>(null);
  const [app, setApp] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<PublicSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');
  const [notifyDiag, setNotifyDiag] = useState<string | null>(null);
  const [courses, setCourses] = useState<{ name: string; year?: string }[]>([]);
  const [years, setYears] = useState<string[]>(['תשפ״ו', 'תשפ״ז']);

  // Fetch course catalog from practicum_data (practicum courses only, public readable)
  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase
        .from('practicum_data')
        .select('data')
        .order('updated_at', { ascending: false })
        .limit(1);
      const allCourses: any[] = rows?.[0]?.data?.courses || [];
      // Only show practicum courses (not internal lecture/skills courses)
      const practicumCourses = allCourses.filter((c: any) =>
        c.id && (c.id.includes('practicum') || c.name?.includes('פרקטיקום'))
      );
      const list = practicumCourses.map((c: any) => ({ name: c.name as string, year: c.year as string | undefined }));
      // De-dupe by name+year
      const seen = new Set<string>();
      const unique = list.filter(c => {
        const key = `${c.name}||${c.year||''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      // Sort: newest year first
      unique.sort((a, b) => (b.year || '').localeCompare(a.year || '', 'he'));
      setCourses(unique);
      // Derive years
      const yearsSet = new Set<string>(['תשפ״ז', 'תשפ״ו']);
      list.forEach(c => c.year && yearsSet.add(c.year));
      setYears(Array.from(yearsSet).sort().reverse());
      // Default to first course (newest year) — only if not pre-filled via URL
      if (!urlCourse && unique.length > 0) {
        setForm(f => f.course ? f : { ...f, course: unique[0].name });
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase.from('public_interview_slots')
        .select('*')
        .gte('date', today)
        .order('date').order('start_time');
      if (error) console.warn('slot fetch:', error);
      const all = (data || []) as PublicSlot[];
      // Show all upcoming slots that aren't full. Course-specific filter removed per feedback:
      // admin can put course context in the note; candidates pick the time that suits them.
      setAvailableSlots(all.filter(s => s.booked_count < s.capacity));
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!form.name.trim() || !form.email.trim()) {
      setErr('שם ומייל נדרשים'); return;
    }
    if (!cv) { setErr('יש להעלות קורות חיים'); return; }
    if (!app) { setErr('יש להעלות טופס מועמדות'); return; }
    // Require slot selection when slots are available
    if (availableSlots.length > 0 && !selectedSlotId) {
      setErr('יש לבחור מועד ראיון מהרשימה');
      // Scroll to the slot list
      document.querySelector('input[name="slot"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setStatus('uploading');
    // Supabase Storage requires ASCII-only keys. Use a stable prefix based on email or timestamp.
    const prefix = (form.email.split('@')[0] || 'candidate').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || `c${Date.now()}`;
    const cvPath = await uploadFile(cv, prefix);
    const appPath = await uploadFile(app, prefix);
    if (!cvPath || !appPath) {
      setStatus('error'); setErr('העלאת קובץ נכשלה. נסה/י שוב.'); return;
    }

    setStatus('saving');
    const slot = availableSlots.find(s => s.id === selectedSlotId) || null;
    const noteWithSlot = slot
      ? `${form.notes.trim() ? form.notes.trim() + '\n' : ''}בחר מועד ראיון: ${slot.date} ${slot.start_time}–${slot.end_time}`
      : form.notes.trim();

    const record = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim(),
      city: form.city.trim() || null,
      course_name: form.course,
      year: form.year,
      cv_file_path: cvPath,
      application_file_path: appPath,
      notes: noteWithSlot || null,
    };

    const { error } = await supabase.from('candidate_submissions').insert(record);
    if (error) {
      setStatus('error');
      setErr('שמירה נכשלה: ' + error.message);
      return;
    }

    // Bump slot booking count. Check the return value — the RLS policy might reject the update silently.
    if (slot) {
      const { data: updated, error: updErr } = await supabase.from('public_interview_slots')
        .update({ booked_count: slot.booked_count + 1, booked_by: form.name })
        .eq('id', slot.id)
        .select();
      if (updErr) {
        setNotifyDiag(`slot booking failed: ${updErr.message} — כל המועמדים יקבלו אותה שעה עד שתתקן RLS`);
      } else if (!updated || updated.length === 0) {
        setNotifyDiag('slot booking: UPDATE ran but 0 rows changed (likely RLS blocks anon UPDATE). הרץ את supabase_slots.sql מחדש.');
      }
    }

    // Call edge function directly for email notifications.
    // Diagnostic output is surfaced in the success screen if anything goes wrong.
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
        const diag = `notify-submission HTTP ${r.status}: ${body.slice(0, 200)}`;
        console.warn(diag);
        setNotifyDiag(diag);
      } else {
        console.log('notify-submission OK');
      }
    } catch (e: any) {
      const diag = 'notify-submission network error: ' + (e?.message || e);
      console.warn(diag);
      setNotifyDiag(diag);
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
          הבקשה וקבצי המועמדות נקלטו.
        </p>

        {bookedSlot ? (
          <div className="mt-6 rounded-xl p-5 text-right" style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--accent)' }}>
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--accent)' }}>
              מועד הראיון שבחרת
            </div>
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
          <p className="text-[14px] mt-4" style={{ color: 'var(--text-soft)' }}>
            הצוות ייצור איתך קשר לקביעת ראיון.
          </p>
        )}

        {/* Diagnostic hidden from candidates — written to console only */}

        <div className="mono text-[11px] uppercase tracking-[0.14em] mt-8" style={{ color: 'var(--text-soft)' }}>
          Ariel University · Management · Practicum
        </div>
      </div>
    );
  }

  const busy = status === 'uploading' || status === 'saving';

  return (
    <div className="max-w-[580px] mx-auto p-10">
      <div className="chapter-mark mb-4">הרשמה לפרקטיקום</div>
      <h1 className="serif text-[36px] leading-[1.1] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
        הגשת מועמדות
      </h1>
      <p className="text-[15.5px] leading-[1.55] mb-8" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        מילוי הטופס + העלאת קורות חיים וטופס מועמדות.
        בחירת מועד ראיון מתבצעת בסוף הטופס; אם אין מועדים פנויים, ניצור איתך קשר לתיאום.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="שם מלא *"><Input value={form.name} onChange={v => setForm({ ...form, name: v })} required /></Field>
        <Field label="מייל *"><Input type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} required /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="טלפון"><Input type="tel" value={form.phone} onChange={v => setForm({ ...form, phone: v })} /></Field>
          <Field label="עיר מגורים"><Input value={form.city} onChange={v => setForm({ ...form, city: v })} /></Field>
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
              <Select value={form.year} onChange={v => setForm({ ...form, year: v })}
                options={years} />
            </Field>
          </div>
        )}

        <div className="pt-2">
          <FileInput label="קורות חיים (PDF / Word) *" file={cv} onChange={setCv} />
          <FileInput label="טופס הגשת מועמדות (PDF / Word) *" file={app} onChange={setApp} />
        </div>

        {availableSlots.length > 0 && (
          <Field label="בחר מועד ראיון *">
            <div className="space-y-1.5">
              {availableSlots.map(s => (
                <label key={s.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-[rgba(122,30,43,0.04)]"
                  style={{
                    borderColor: selectedSlotId === s.id ? 'var(--accent)' : 'var(--divider)',
                    background: selectedSlotId === s.id ? 'rgba(122,30,43,0.06)' : 'transparent',
                  }}>
                  <input type="radio" name="slot" value={s.id}
                    checked={selectedSlotId === s.id}
                    onChange={() => setSelectedSlotId(s.id)} />
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
            <div className="text-[11.5px] mt-2" style={{ color: 'var(--text-soft)' }}>
              {selectedSlotId ? 'תוכל/י לשנות את המועד מול הצוות אם צריך.' : 'בחירת מועד נדרשת להמשך.'}
            </div>
          </Field>
        )}

        <Field label="הערות (אופציונלי)">
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
            rows={3} className="input w-full" style={{ padding: '12px 16px', fontSize: '14px', resize: 'vertical' }}/>
        </Field>

        {err && (
          <div className="mono text-[11.5px] uppercase tracking-[0.14em] py-2" style={{ color: 'var(--accent)' }}>
            {err}
          </div>
        )}

        <button type="submit" disabled={busy} style={{
          display: 'block', width: '100%', marginTop: '16px', padding: '16px',
          fontSize: '15px', fontWeight: 600,
          background: busy ? 'var(--divider)' : 'var(--accent)',
          color: 'white', border: 'none', borderRadius: '12px',
          cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1,
        }}>
          {status === 'uploading' ? 'מעלה קבצים...' : status === 'saving' ? 'שומר...' : 'שלח הגשת מועמדות ←'}
        </button>

        <p className="mono text-[10.5px] uppercase tracking-[0.14em] text-center pt-2" style={{ color: 'var(--text-soft)' }}>
          הקבצים נשמרים באופן מאובטח. רק הצוות שלנו רואה אותם.
        </p>
      </form>
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

function Input({ value, onChange, type = 'text', required }: { value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
      className="input w-full" style={{ padding: '12px 16px', fontSize: '14.5px' }} />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="input w-full"
      style={{ padding: '12px 16px', fontSize: '14.5px',
        appearance: 'none', WebkitAppearance: 'none',
        backgroundImage: 'linear-gradient(45deg, transparent 50%, var(--accent) 50%), linear-gradient(135deg, var(--accent) 50%, transparent 50%)',
        backgroundPosition: 'calc(100% - 14px) center, calc(100% - 10px) center',
        backgroundSize: '5px 5px', backgroundRepeat: 'no-repeat', paddingLeft: '28px' }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function FileInput({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  return (
    <label className="block mb-3">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <div className="border-2 border-dashed rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors hover:bg-[rgba(122,30,43,0.04)]"
        style={{ borderColor: file ? 'var(--accent)' : 'var(--divider)' }}>
        <input type="file" accept=".pdf,.doc,.docx"
          onChange={e => onChange(e.target.files?.[0] || null)}
          className="hidden" />
        <span className="serif text-[24px]" style={{ color: file ? 'var(--accent)' : 'var(--text-soft)' }}>
          {file ? '✓' : '📎'}
        </span>
        <span className="text-[13.5px] flex-1" style={{ color: file ? 'var(--ink)' : 'var(--text-soft)' }}>
          {file ? file.name : 'לחץ כדי לבחור קובץ'}
        </span>
        {file && (
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(null); }}
            className="mono text-[10px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100">
            הסר
          </button>
        )}
      </div>
    </label>
  );
}
