// Local session management (profile + context stored in localStorage)

export type UserProfile = {
  name: string;
  email?: string;
};

export type Context = {
  courseId: string;
  year: string;
};

const SESSION_KEY = 'practicum_v2_session';
const CONTEXT_KEY = 'practicum_v2_context';

export function getSession(): { profile: UserProfile } | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const s = localStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

export function setSession(profile: UserProfile) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ profile })); } catch {}
}

export function getContext(): Context {
  try {
    if (typeof localStorage === 'undefined') return { courseId: '__all__', year: '__all__' };
    const c = localStorage.getItem(CONTEXT_KEY);
    return c ? JSON.parse(c) : { courseId: '__all__', year: '__all__' };
  } catch { return { courseId: '__all__', year: '__all__' }; }
}

export function setContext(ctx: Context) {
  try { localStorage.setItem(CONTEXT_KEY, JSON.stringify(ctx)); } catch {}
}

export function signOut() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

/** Normalises academic-year strings so comparisons work regardless of spacing/dash variants. */
export function normalizeYear(y: string | undefined | null): string {
  if (!y) return '';
  return String(y).trim().replace(/\s+/g, '-');
}
