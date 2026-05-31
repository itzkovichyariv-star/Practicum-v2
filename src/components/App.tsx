import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ToastType } from '../lib/toast';
import PasswordGate from './PasswordGate';
import CloudSignIn from './CloudSignIn';
import TopBar, { type Page } from './TopBar';
import Dashboard from './Dashboard';
import LecturesPage from './LecturesPage';
import StudentsPage from './StudentsPage';
import EmployersPage from './EmployersPage';
import TrainersPage from './TrainersPage';
import CandidatesPage from './CandidatesPage';
import CalendarPage from './CalendarPage';
import ReportsPage from './ReportsPage';
import FormsPage from './FormsPage';
import ManagementPage from './ManagementPage';
import SettingsPage from './SettingsPage';
import GlobalSearch from './GlobalSearch';
import {
  getSession, setSession, getContext, setContext as persistContext, signOut, normalizeYear,
  type UserProfile, type Context,
} from '../lib/session';
import { TOAST_COLORS, btnPrimary } from '../lib/design';
import { loadSnapshot, supabase, type PracticumData } from '../lib/supabase';
import { saveSnapshot, ensureAutoSnapshot } from '../lib/dataApi';
import { migratePlacementData } from '../lib/placement';
import { filterByPermissions, permissionsFor, describePermissions, type UserPermissions } from '../lib/permissions';
import { CONTACT_PATCHES } from '../lib/contactPatches';

const PAGE_STORAGE = 'practicum_v2_page';

/* ── Day/Night automated theme ─────────────────────────────────────────
   Night = 19:00–07:00. Overridden by manual preference stored in localStorage.
   data-theme="dark"|"light"|"auto" on <html> drives CSS below.           */
const THEME_KEY = 'practicum_theme';
type ThemeMode = 'auto' | 'dark' | 'light';

function getNightMode(): boolean {
  const h = new Date().getHours();
  return h >= 19 || h < 7;
}

function applyTheme(mode: ThemeMode) {
  const isDark = mode === 'dark' || (mode === 'auto' && getNightMode());
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

export function useTheme(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof localStorage === 'undefined') return 'auto';
    return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'auto';
  });
  useEffect(() => {
    applyTheme(mode);
    if (mode !== 'auto') return;
    // In auto mode: re-check every minute for time boundary crossing
    const id = setInterval(() => applyTheme('auto'), 60_000);
    return () => clearInterval(id);
  }, [mode]);
  function set(m: ThemeMode) {
    setMode(m);
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, m);
    applyTheme(m);
  }
  return [mode, set];
}

export default function App() {
  const [themeMode, setThemeMode] = useTheme();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [cloudAuthed, setCloudAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<PracticumData | null>(null);
  const [cloudEmail, setCloudEmail] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Context>({ courseId: '__all__', year: '__all__' });
  const [lastUpdated, setLastUpdated] = useState<string | undefined>();
  const [lastEditor, setLastEditor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  // The last snapshot version we actually rendered. Used to drop redundant
  // realtime events (identical updated_at → nothing changed → skip the re-render).
  const lastUpdatedRef = useRef<string | undefined>(undefined);
  // Debounce timer for realtime-driven refreshes. A burst of writes (e.g. the
  // candidate editor's 1.5s auto-save, or several quick edits) would otherwise
  // re-run the migration + re-render the whole app once PER write — that churn
  // blocks the main thread and swallows clicks ("needed 3 clicks to open a card").
  // Coalesce them into a single refresh that fires after activity settles.
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [page, setPage] = useState<Page>(() => {
    if (typeof localStorage === 'undefined') return 'dashboard';
    return (localStorage.getItem(PAGE_STORAGE) as Page) || 'dashboard';
  });

  // Resume session on page load
  useEffect(() => {
    const s = getSession();
    if (s?.profile) {
      setProfile(s.profile);
      // If email was stored in the profile, restore cloud auth state too
      if (s.profile.email) {
        setCloudEmail(s.profile.email);
        setCloudAuthed(true);
      }
    }
    setCtx(getContext());
    setReady(true);
  }, []);

  const refresh = useCallback(async (retryCount = 0) => {
    setLoading(true);
    setLoadError(null);
    const snap = await loadSnapshot();
    if (!snap) {
      // Auto-retry up to 3 times with increasing delay before giving up
      if (retryCount < 3) {
        const delay = (retryCount + 1) * 3000; // 3s, 6s, 9s
        setTimeout(() => refresh(retryCount + 1), delay);
        return;
      }
      setLoadError('לא הצלחנו לטעון מהענן. ודא חיבור אינטרנט.');
      setLoading(false);
      return;
    }
    // Dedupe: if this is the exact version we already rendered, skip the
    // migration + setData (which would re-render the whole tree for nothing).
    // Realtime can deliver the same event more than once; this makes that free.
    if (snap.updated_at && snap.updated_at === lastUpdatedRef.current) {
      setLoading(false);
      return;
    }
    lastUpdatedRef.current = snap.updated_at;
    const migratedData = migratePlacementData(snap.data);
    setData(migratedData);
    setLastUpdated(snap.updated_at);
    setLastEditor(snap.last_editor_name);
    setLoading(false);
    // Fire-and-forget heartbeat: writes a snapshot if >12h since the last one.
    // Provides a guaranteed recent backup even without user activity.
    const s = getSession();
    if (s?.profile) ensureAutoSnapshot(snap.data, { name: s.profile.name });
  }, []); // setters are stable; loadSnapshot is a module import — no deps needed

  useEffect(() => {
    if (profile) refresh();
  }, [profile, refresh]);

  // Silently patch contact details on first data load (fires for all users, not just Management page visitors)
  const contactPatchedRef = useRef(false);
  useEffect(() => {
    if (!data || !profile || contactPatchedRef.current) return;
    const lectures: any[] = data.lectures || [];
    const patched = lectures.map(l => {
      const p = CONTACT_PATCHES[l.lecturer || ''];
      if (!p) return l;
      const needsUpdate =
        (p.name  && l.lecturer      !== p.name)  ||
        (p.phone && !l.lecturerPhone)             ||
        (p.email && !l.lecturerEmail);
      if (!needsUpdate) return l;
      return {
        ...l,
        lecturer:      p.name  && l.lecturer !== p.name  ? p.name  : l.lecturer,
        lecturerPhone: p.phone && !l.lecturerPhone       ? p.phone : l.lecturerPhone,
        lecturerEmail: p.email && !l.lecturerEmail       ? p.email : l.lecturerEmail,
      };
    });
    const hasChanges = patched.some((l, i) =>
      l.lecturer !== lectures[i].lecturer ||
      l.lecturerPhone !== lectures[i].lecturerPhone ||
      l.lecturerEmail !== lectures[i].lecturerEmail
    );
    contactPatchedRef.current = true;  // mark done regardless — avoid re-running
    if (!hasChanges) return;
    // Fire and forget — silently persist the patched contacts, then re-fetch
    saveSnapshot({ ...data, lectures: patched }, { name: profile.name }).then(res => {
      if (res.ok) refresh();
    });
  }, [data, profile, refresh]);

  // Real-time sync: subscribe to changes in practicum_data and re-fetch when anyone
  // updates the snapshot. Also watches candidate_submissions and public_interview_slots
  // so the Inbox, Calendar, and Slots views update live.
  useEffect(() => {
    if (!profile || !cloudAuthed) return;
    // Debounced refresh: coalesce a burst of DB writes into a single re-fetch
    // ~700ms after the last one, so editing/auto-save doesn't trigger a
    // re-render storm that blocks the main thread and drops clicks.
    const bump = () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = setTimeout(() => { realtimeTimer.current = null; refresh(); }, 700);
    };
    const ch = supabase
      .channel('practicum-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'practicum_data' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'candidate_submissions' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_interview_slots' }, bump)
      .subscribe();
    return () => {
      if (realtimeTimer.current) { clearTimeout(realtimeTimer.current); realtimeTimer.current = null; }
      supabase.removeChannel(ch);
    };
  }, [profile, cloudAuthed, refresh]);

  function handleContextChange(next: Context) {
    setCtx(next);
    persistContext(next);
  }

  function handleNavigate(next: Page) {
    setPage(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(PAGE_STORAGE, next);
    window.scrollTo(0, 0);
  }

  function handleSignOut() {
    signOut();
    setProfile(null);
    setData(null);
  }

  // Permission-scoped data — Rachel only sees her courses/students/lectures
  const perms: UserPermissions = useMemo(() => permissionsFor(cloudEmail), [cloudEmail]);
  const scopedForOptions = useMemo(() => data ? filterByPermissions(data, perms) : null, [data, perms]);

  // Compute context options from already-scoped data so forbidden courses don't appear
  // NOTE: we show ALL courses regardless of selected year so the selector never falls back
  // to displaying a raw course ID. Year + course together filter the data shown downstream.
  const courseOptions = useMemo(() => {
    const courses = (scopedForOptions?.courses || []);
    // Show each unique course NAME once — year is the orthogonal selector.
    const seen = new Set<string>();
    const unique = courses.filter(c => {
      if (!c.name || seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });
    return [
      { value: '__all__', label: 'כל הקורסים' },
      ...unique.map(c => ({ value: c.name, label: c.name })),
    ];
  }, [scopedForOptions]);

  const yearOptions = useMemo(() => {
    if (!scopedForOptions) return [{ value: '__all__', label: 'כל השנים' }];
    const set = new Set<string>();
    (scopedForOptions.courses || []).forEach(c => c.year && set.add(normalizeYear(c.year)));
    (scopedForOptions.students || []).forEach(s => s.year && set.add(normalizeYear(s.year)));
    (scopedForOptions.lectures || []).forEach(l => l.year && set.add(normalizeYear(l.year)));
    (data?.academicYears || []).forEach(y => set.add(normalizeYear(y)));
    return [
      { value: '__all__', label: 'כל השנים' },
      ...Array.from(set).sort().reverse().map(y => ({ value: y, label: y })),
    ];
  }, [data]);

  if (!ready) return null;
  if (!profile) return <PasswordGate onAuth={(p, email) => {
    const profileWithEmail = { ...p, email };
    setSession(profileWithEmail);   // persist email so it survives refresh
    setProfile(profileWithEmail);
    setCloudEmail(email);
    setCloudAuthed(true); // email+passphrase is sufficient — no magic link needed
  }} />;
  // Show loader whenever data hasn't arrived yet (catches both the brief pre-loading
  // frame and the actual in-flight request). Error state takes priority.
  if (!data && loadError) {
    return (
      <Loader
        text={loadError}
        action={<button onClick={refresh} style={{ ...btnPrimary(), marginTop: '24px' }}>נסה שוב</button>}
      />
    );
  }
  if (!data) return <Loader text="טוען נתונים מהענן..." />;

  const pageProps = {
    data: scopedForOptions || {},
    context: ctx,
    onContext: handleContextChange,
    userName: profile.name,
    lastUpdated,
    lastEditor,
    onRefresh: refresh,
    onNavigate: handleNavigate,
  };

  return (
    <>
      <ToastContainer />
      {data && <GlobalSearch data={scopedForOptions || {}} onNavigate={handleNavigate} />}
      <TopBar
        userName={profile.name}
        onSignOut={handleSignOut}
        context={ctx}
        onContext={handleContextChange}
        courseOptions={courseOptions}
        yearOptions={yearOptions}
        page={page}
        onNavigate={handleNavigate}
        themeMode={themeMode}
        onThemeChange={setThemeMode}
      />
      {/* Spacer that matches the fixed header height exactly */}
      <div style={{ height: 'var(--header-h, 108px)' }} />

      {page === 'dashboard'  && <Dashboard  {...pageProps} />}
      {page === 'lectures'   && <LecturesPage  {...pageProps} />}
      {page === 'students'   && <StudentsPage  {...pageProps} />}
      {page === 'employers'  && <EmployersPage {...pageProps} />}
      {page === 'trainers'   && <TrainersPage  {...pageProps} />}
      {page === 'candidates' && <CandidatesPage {...pageProps} />}
      {page === 'calendar'   && <CalendarPage  {...pageProps} />}
      {page === 'reports'    && <ReportsPage   {...pageProps} />}
      {page === 'forms'      && <FormsPage     {...pageProps} />}
      {page === 'management' && <ManagementPage {...pageProps} />}
      {page === 'settings'   && <SettingsPage  {...pageProps} />}

      <footer className="max-w-[1200px] mx-auto px-4 sm:px-10 py-12 border-t flex justify-between items-center" style={{ borderColor: 'var(--divider)' }}>
        <div className="small-caps" style={{ letterSpacing: '0.16em' }}>
          פרקטיקום · Ariel University · Management
        </div>
        <div className="small-caps" style={{ letterSpacing: '0.16em' }}>
          v2 · {profile.name} · {describePermissions(perms)}
        </div>
      </footer>
    </>
  );
}

function Loader({ text, action }: { text: string; action?: any }) {
  return (
    <div className="fixed inset-0 grid place-items-center p-10" style={{ background: 'var(--bg)' }}>
      <div className="text-center">
        <div className="chapter-mark mb-4">Loading</div>
        <div className="serif text-[28px]" style={{ color: 'var(--ink)' }}>{text}</div>
        {action}
      </div>
    </div>
  );
}

/* ─── Global toast container ─────────────────────────────────────────── */
type Toast = { id: number; msg: string; type: ToastType };

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    function handle(e: Event) {
      const { msg, type = 'success', duration = 3500 } = (e as CustomEvent).detail;
      const id = Date.now() + Math.random();
      setToasts(t => [...t, { id, msg, type }]);
      const timer = setTimeout(() => {
        setToasts(t => t.filter(x => x.id !== id));
        timers.current.delete(id);
      }, duration);
      timers.current.set(id, timer);
    }
    window.addEventListener('practicum:toast', handle);
    return () => window.removeEventListener('practicum:toast', handle);
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-8 left-1/2 z-[9999] flex flex-col gap-2"
      style={{ transform: 'translateX(-50%)', minWidth: '260px', maxWidth: '480px' }}>
      {toasts.map(t => (
        <div key={t.id}
          className="px-5 py-3 rounded-xl text-[14px] font-semibold shadow-2xl flex items-center gap-3"
          style={{
            background: TOAST_COLORS[t.type]?.bg ?? 'var(--accent)',
            color: TOAST_COLORS[t.type]?.text ?? 'white',
            animation: 'toast-in 0.25s ease',
          }}>
          <span style={{ fontSize: '16px' }}>
            {t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : t.type === 'warn' ? '⚠' : 'ℹ'}
          </span>
          {t.msg}
        </div>
      ))}
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
