import { useState, useEffect, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type Status = 'idle' | 'uploading' | 'done' | 'error';

export default function CvUpdateForm() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const prefillEmail = params.get('email') || '';
  const prefillName  = params.get('name')  || '';
  const courseParam  = params.get('course') || '';

  const [email, setEmail] = useState(prefillEmail);
  const [name,  setName]  = useState(prefillName);
  const [file,  setFile]  = useState<File | null>(null);
  const [orgs,  setOrgs]  = useState<string[]>([]);
  const [pref1, setPref1] = useState('');
  const [pref2, setPref2] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [err,    setErr]    = useState<string | null>(null);

  // Load approved organizations so the candidate can state a preference.
  useEffect(() => {
    supabase
      .from('practicum_data')
      .select('data')
      .eq('org_id', 'default')
      .single()
      .then(({ data }) => {
        const all: any[] = (data as any)?.data?.employers || [];
        const names = all
          .filter(e => {
            if (!e?.name) return false;
            if (e.approvalStatus === 'rejected') return false;
            if (courseParam) {
              const ids = e.courseIds || (e.courseId ? [e.courseId] : []);
              if (ids.length && !ids.includes(courseParam)) return false;
            }
            return true;
          })
          .map(e => e.name as string)
          .sort((a, b) => a.localeCompare(b, 'he'));
        setOrgs(Array.from(new Set(names)));
      });
  }, [courseParam]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email.trim()) { setErr('יש להזין מייל'); return; }
    if (!file)         { setErr('יש לבחור קובץ'); return; }

    setStatus('uploading');

    // Upload file to candidate-uploads bucket
    const safeEmail = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || 'candidate';
    const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8) || 'bin';
    const path = `cv-updates/${safeEmail}-${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabase.storage.from('candidate-uploads').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });

    if (uploadErr) {
      setStatus('error');
      setErr('העלאה נכשלה: ' + uploadErr.message);
      return;
    }

    // Record in cv_updates table
    const { error: dbErr } = await supabase.from('cv_updates').insert({
      email: email.trim().toLowerCase(),
      name: name.trim() || null,
      cv_file_path: path,
      org_pref_1: pref1 || null,
      org_pref_2: pref2 || null,
    });

    if (dbErr) {
      setStatus('error');
      setErr('שגיאה בשמירה: ' + dbErr.message);
      return;
    }

    setStatus('done');
  }

  if (status === 'done') {
    return (
      <div className="max-w-[480px] mx-auto p-10 text-center">
        <div className="chapter-mark mb-4">✓ התקבל</div>
        <h1 className="serif text-[36px] leading-[1.1] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
          קורות החיים עודכנו
        </h1>
        <p className="text-[15px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
          הצוות יקבל עדכון ויעיין בגרסה החדשה. תודה!
        </p>
        <div className="mono text-[11px] uppercase tracking-[0.14em] mt-8" style={{ color: 'var(--text-soft)' }}>
          Ariel University · Management · Practicum
        </div>
      </div>
    );
  }

  const busy = status === 'uploading';

  return (
    <div className="max-w-[480px] mx-auto p-10">
      <div className="chapter-mark mb-4">עדכון מסמכים</div>
      <h1 className="serif text-[36px] leading-[1.1] tracking-tight mb-2" style={{ color: 'var(--ink)' }}>
        העלאת CV מעודכן
      </h1>
      <p className="text-[15px] leading-[1.55] mb-8" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        לאחר סדנת קורות חיים — העלה/י את הגרסה המעודכנת כאן.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block">
            <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>מייל *</span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              readOnly={!!prefillEmail}
              className="input w-full"
              style={{
                padding: '12px 16px',
                fontSize: '14.5px',
                opacity: prefillEmail ? 0.7 : 1,
                cursor: prefillEmail ? 'default' : undefined,
              }}
            />
          </label>
        </div>

        {!prefillName && (
          <div>
            <label className="block">
              <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>שם מלא (אופציונלי)</span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="input w-full"
                style={{ padding: '12px 16px', fontSize: '14.5px' }}
              />
            </label>
          </div>
        )}

        <div>
          <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>קורות חיים מעודכנים (PDF / Word) *</span>
          <label
            className="block border-2 border-dashed rounded-xl p-5 cursor-pointer transition-colors hover:bg-[rgba(122,30,43,0.03)]"
            style={{ borderColor: file ? 'var(--accent)' : 'var(--divider)' }}
          >
            <input type="file" accept=".pdf,.doc,.docx" onChange={e => setFile(e.target.files?.[0] || null)} className="hidden" />
            <div className="flex items-center gap-3">
              <span className="serif text-[28px]" style={{ color: file ? 'var(--accent)' : 'var(--text-soft)' }}>
                {file ? '✓' : '📎'}
              </span>
              <div className="flex-1">
                <div className="text-[14px]" style={{ color: file ? 'var(--ink)' : 'var(--text-soft)' }}>
                  {file ? file.name : 'לחץ/י כדי לבחור קובץ'}
                </div>
                {file && (
                  <div className="mono text-[11px] uppercase tracking-[0.12em] mt-0.5" style={{ color: 'var(--text-soft)' }}>
                    {(file.size / 1024).toFixed(0)} KB
                  </div>
                )}
              </div>
              {file && (
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setFile(null); }}
                  className="mono text-[10px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100"
                >
                  הסר
                </button>
              )}
            </div>
          </label>
        </div>

        {orgs.length > 0 && (
          <div className="space-y-4 pt-1">
            <div>
              <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>העדפת ארגון — בחירה ראשונה</span>
              <select
                value={pref1}
                onChange={e => setPref1(e.target.value)}
                className="input w-full"
                style={{ padding: '12px 16px', fontSize: '14.5px' }}
              >
                <option value="">— ללא העדפה —</option>
                {orgs.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>העדפת ארגון — בחירה שנייה (אופציונלי)</span>
              <select
                value={pref2}
                onChange={e => setPref2(e.target.value)}
                className="input w-full"
                style={{ padding: '12px 16px', fontSize: '14.5px' }}
              >
                <option value="">— ללא —</option>
                {orgs.filter(o => o !== pref1).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <p className="text-[12px] leading-[1.5]" style={{ color: 'var(--text-soft)' }}>
              ההעדפה אינה מחייבת שיבוץ — הארגון מראיין בהמשך ויש מועמדים נוספים. ניתן להשאיר ריק.
            </p>
          </div>
        )}

        {err && (
          <div className="mono text-[11.5px] uppercase tracking-[0.14em] py-2" style={{ color: 'var(--accent)' }}>
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !file}
          style={{
            display: 'block', width: '100%', padding: '16px', fontSize: '15px', fontWeight: 600,
            background: (busy || !file) ? 'var(--divider)' : 'var(--accent)',
            color: 'white', border: 'none', borderRadius: '12px',
            cursor: (busy || !file) ? 'not-allowed' : 'pointer',
            opacity: (busy || !file) ? 0.6 : 1,
          }}
        >
          {busy ? 'מעלה...' : 'שלח CV מעודכן ←'}
        </button>
      </form>
    </div>
  );
}
