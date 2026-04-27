import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function CloudSignIn({ onSuccess }: { onSuccess: () => void }) {
  const [email,   setEmail]   = useState('');
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setErr('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  }

  // Poll for session after magic-link click (user opened link in same browser)
  if (!sent) {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') onSuccess();
    });
  }

  return (
    <div className="fixed inset-0 grid place-items-center p-6" style={{ background: 'var(--bg)' }}>
      <div style={{ maxWidth: 400, width: '100%' }}>
        <div className="chapter-mark mb-6">פרקטיקום · ענן</div>
        <h1 className="serif text-[38px] leading-[1.1] mb-2" style={{ color: 'var(--ink)' }}>כניסה לענן</h1>
        <p className="text-[15px] mb-8 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          נשלח קישור כניסה לכתובת המייל שלך.
        </p>

        {sent ? (
          <div className="surface p-6 text-center">
            <div className="text-[28px] mb-3">📬</div>
            <div className="serif text-[20px] mb-2" style={{ color: 'var(--ink)' }}>נשלח!</div>
            <div className="text-[14px]" style={{ color: 'var(--text-soft)' }}>
              בדוק את תיבת הדוא״ל שלך ולחץ על קישור הכניסה.
            </div>
          </div>
        ) : (
          <form onSubmit={send} className="flex flex-col gap-4">
            <div>
              <label className="mono text-[10.5px] uppercase tracking-[0.14em] mb-1.5 block" style={{ color: 'var(--text-soft)' }}>
                כתובת דוא״ל
              </label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setErr(''); }}
                className="input w-full"
                placeholder="you@example.com"
                dir="ltr"
                autoFocus
              />
            </div>
            {err && (
              <div className="mono text-[12px] uppercase tracking-[0.12em]" style={{ color: '#dc2626' }}>
                {err}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn btn-primary mt-2 disabled:opacity-50">
              {loading ? 'שולח...' : 'שלח קישור כניסה'} <span className="serif text-[16px]">→</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
