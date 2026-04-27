import { useState } from 'react';
import type { UserProfile } from '../lib/session';
import { setSession } from '../lib/session';

// Shared passphrase — simple first-line auth before Supabase cloud auth.
const PASSPHRASE = 'practicum2025';

export default function PasswordGate({ onAuth }: { onAuth: (p: UserProfile) => void }) {
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [err,  setErr]  = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('נא להזין שם מלא'); return; }
    if (pass.trim() !== PASSPHRASE) { setErr('סיסמה שגויה'); return; }
    const profile: UserProfile = { name: name.trim() };
    setSession(profile);
    onAuth(profile);
  }

  return (
    <div className="fixed inset-0 grid place-items-center p-6" style={{ background: 'var(--bg)' }}>
      <div style={{ maxWidth: 400, width: '100%' }}>
        <div className="chapter-mark mb-6">פרקטיקום · ניהול</div>
        <h1 className="serif text-[38px] leading-[1.1] mb-2" style={{ color: 'var(--ink)' }}>כניסה</h1>
        <p className="text-[15px] mb-8 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          אוניברסיטת אריאל · מערכת ניהול פרקטיקום
        </p>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="mono text-[10.5px] uppercase tracking-[0.14em] mb-1.5 block" style={{ color: 'var(--text-soft)' }}>
              שם מלא
            </label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setErr(''); }}
              className="input w-full"
              placeholder="ד״ר יריב איצקוביץ"
              autoFocus
            />
          </div>
          <div>
            <label className="mono text-[10.5px] uppercase tracking-[0.14em] mb-1.5 block" style={{ color: 'var(--text-soft)' }}>
              סיסמה
            </label>
            <input
              type="password"
              value={pass}
              onChange={e => { setPass(e.target.value); setErr(''); }}
              className="input w-full"
              placeholder="••••••••"
            />
          </div>
          {err && (
            <div className="mono text-[12px] uppercase tracking-[0.12em]" style={{ color: '#dc2626' }}>
              {err}
            </div>
          )}
          <button type="submit" className="btn btn-primary mt-2">
            כניסה <span className="serif text-[16px]">→</span>
          </button>
        </form>
      </div>
    </div>
  );
}
