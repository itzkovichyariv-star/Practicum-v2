import { useState } from 'react';
import type { UserProfile } from '../lib/session';
import { setSession } from '../lib/session';

const PASSPHRASE = 'ariel2026';

// Known users — email is used for permissions, not for auth
const KNOWN_USERS: Record<string, string> = {
  'yarivi@ariel.ac.il':      'יריב איצקוביץ',
  'rachelshal@ariel.ac.il':  'רחל שלו',
};

export default function PasswordGate({ onAuth }: { onAuth: (p: UserProfile, email: string) => void }) {
  const [email,       setEmail]       = useState('');
  const [pass,        setPass]        = useState('');
  const [err,         setErr]         = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail) { setErr('נא להזין כתובת מייל'); return; }
    if (pass.trim() !== PASSPHRASE) { setErr('סיסמה שגויה — נסה שוב'); return; }
    setSubmitting(true);
    // Use known display name if available, otherwise derive from email
    const name = KNOWN_USERS[trimEmail] || trimEmail.split('@')[0];
    const profile: UserProfile = { name };
    setSession(profile);
    onAuth(profile, trimEmail);
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      {/* Decorative background rings */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: 600, height: 600, borderRadius: '50%', border: '1px solid var(--divider)', opacity: 0.5 }} />
        <div style={{ position: 'absolute', top: '-5%', right: '5%', width: 380, height: 380, borderRadius: '50%', border: '1px solid var(--divider)', opacity: 0.4 }} />
        <div style={{ position: 'absolute', bottom: '-15%', left: '-8%', width: 500, height: 500, borderRadius: '50%', border: '1px solid var(--divider)', opacity: 0.35 }} />
      </div>

      {/* Card */}
      <div className="relative w-full mx-6" style={{
        maxWidth: 440,
        background: 'var(--surface-1)',
        border: '1px solid var(--divider)',
        borderRadius: 24,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        padding: '48px 44px 44px',
        boxShadow: '0 32px 80px rgba(61,15,20,0.12), 0 2px 8px rgba(61,15,20,0.06)',
      }}>
        {/* Logo mark */}
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 28,
          boxShadow: '0 8px 24px rgba(122,30,43,0.28)',
        }}>
          <span style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 28, color: '#f4efe6', lineHeight: 1 }}>פ</span>
        </div>

        <div className="chapter-mark mb-2" style={{ fontSize: '11px' }}>פרקטיקום · אריאל</div>
        <h1 className="serif mb-1" style={{ fontSize: 36, color: 'var(--ink)', lineHeight: 1.1 }}>ברוכים הבאים</h1>
        <p className="mb-8" style={{ fontSize: 14.5, color: 'var(--text-soft)', lineHeight: 1.6 }}>
          מערכת ניהול פרקטיקום — אוניברסיטת אריאל
        </p>

        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label className="mono uppercase" style={{ fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--text-soft)' }}>
              כתובת מייל
            </label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setErr(''); }}
              className="input"
              placeholder="you@ariel.ac.il"
              dir="ltr"
              autoFocus
              autoComplete="email"
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label className="mono uppercase" style={{ fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--text-soft)' }}>
              סיסמה
            </label>
            <input
              type="password"
              value={pass}
              onChange={e => { setPass(e.target.value); setErr(''); }}
              className="input"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {/* Error */}
          {err && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl mono"
              style={{ fontSize: 12.5, background: 'rgba(220,38,38,0.08)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.18)' }}>
              <span style={{ fontSize: 15 }}>⚠</span> {err}
            </div>
          )}

          {/* Submit */}
          <button type="submit" disabled={submitting} className="btn btn-primary mt-1 disabled:opacity-50"
            style={{ fontSize: 13, letterSpacing: '0.14em', minHeight: 50, borderRadius: 14, justifyContent: 'center' }}>
            {submitting ? 'נכנס...' : 'כניסה'}
            {!submitting && <span className="serif" style={{ fontSize: 18 }}>→</span>}
          </button>
        </form>

        <p className="mono text-center mt-7" style={{ fontSize: 10.5, color: 'var(--text-soft)', letterSpacing: '0.1em', opacity: 0.7 }}>
          ARIEL UNIVERSITY · HR PRACTICUM MANAGEMENT
        </p>
      </div>
    </div>
  );
}
