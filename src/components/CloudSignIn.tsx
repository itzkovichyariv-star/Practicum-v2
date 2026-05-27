import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function CloudSignIn({ onSuccess }: { onSuccess: () => void }) {
  const [email,   setEmail]   = useState('');
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');

  // On mount: check if Supabase already has a session (e.g. magic link just clicked)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) onSuccess();
    });

    // Also listen for the SIGNED_IN event fired when magic link token is processed
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') onSuccess();
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setErr('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin,
      },
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div
        className="w-full mx-6"
        style={{
          maxWidth: 440,
          background: 'var(--surface-1)',
          border: '1px solid var(--divider)',
          borderRadius: 24,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          padding: '48px 44px 44px',
          boxShadow: '0 32px 80px rgba(61,15,20,0.12)',
        }}
      >
        {/* Logo */}
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 28,
          boxShadow: '0 8px 24px rgba(122,30,43,0.28)',
        }}>
          <span style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 28, color: '#f4efe6', lineHeight: 1 }}>פ</span>
        </div>

        <div className="chapter-mark mb-2" style={{ fontSize: '11px' }}>פרקטיקום · ענן</div>
        <h1 className="serif mb-1" style={{ fontSize: 36, color: 'var(--ink)', lineHeight: 1.1 }}>כניסה לענן</h1>
        <p className="mb-8" style={{ fontSize: 14.5, color: 'var(--text-soft)', lineHeight: 1.6 }}>
          נשלח קישור כניסה חד-פעמי לכתובת המייל שלך.
        </p>

        {sent ? (
          <div className="text-center p-8 rounded-2xl" style={{ background: 'var(--accent-soft)', border: '1px solid var(--divider)' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📬</div>
            <div className="serif mb-2" style={{ fontSize: 22, color: 'var(--ink)' }}>הקישור נשלח!</div>
            <div style={{ fontSize: 14, color: 'var(--text-soft)', lineHeight: 1.6 }}>
              בדוק את תיבת הדוא״ל שלך ולחץ על הקישור.<br/>
              <strong>חשוב:</strong> לחץ על הקישור באותו הדפדפן שממנו שלחת.
            </div>
          </div>
        ) : (
          <form onSubmit={send} className="flex flex-col gap-5" noValidate>
            <div className="flex flex-col gap-1.5">
              <label className="mono uppercase" style={{ fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--text-soft)' }}>
                כתובת דוא״ל
              </label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setErr(''); }}
                className="input"
                placeholder="you@example.com"
                dir="ltr"
                autoFocus
                autoComplete="email"
              />
            </div>
            {err && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl mono"
                style={{ fontSize: 12.5, background: 'rgba(220,38,38,0.08)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.18)' }}>
                <span style={{ fontSize: 15 }}>⚠</span> {err}
              </div>
            )}
            <button type="submit" disabled={loading} style={{
              display: 'block', width: '100%', marginTop: '4px',
              letterSpacing: '0.14em', borderRadius: 14,
              padding: '14px', fontSize: 13, fontWeight: 600,
              background: loading ? 'var(--divider)' : 'var(--accent)',
              color: 'white', border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
            }}>
              {loading ? 'שולח...' : 'שלח קישור כניסה →'}
            </button>
          </form>
        )}

        <p className="mono text-center mt-7" style={{ fontSize: 10.5, color: 'var(--text-soft)', letterSpacing: '0.1em', opacity: 0.7 }}>
          ARIEL UNIVERSITY · HR PRACTICUM MANAGEMENT
        </p>
      </div>
    </div>
  );
}
