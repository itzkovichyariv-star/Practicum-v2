import { useEffect, useState } from 'react';
import { openCv } from '../lib/cvUrl';
import { btnPrimary, btnSecondary } from '../lib/design';
import { supabase } from '../lib/supabase';
import { isCancelledSubmission } from '../lib/submissions';
import JSZip from 'jszip';

type Questionnaire = {
  studyTracks?: string;
  gpa?: string;
  workHistory?: string;
  favRole?: string;
  leastFavRole?: string;
  whyPracticum?: string;
  whySuitable?: string;
  persistence?: string;
  expectations?: string;
};

const Q_LABELS: { key: keyof Questionnaire; label: string }[] = [
  { key: 'studyTracks',   label: 'חוגי לימוד' },
  { key: 'gpa',           label: 'ממוצע ציונים א׳+ב׳' },
  { key: 'workHistory',   label: 'ניסיון תעסוקתי' },
  { key: 'favRole',       label: 'תפקיד שאהבת במיוחד' },
  { key: 'leastFavRole',  label: 'תפקיד שפחות התחברת אליו' },
  { key: 'whyPracticum',  label: 'מדוע נרשמת לפרקטיקום' },
  { key: 'whySuitable',   label: 'מדוע אתה מתאים/ה' },
  { key: 'persistence',   label: 'התמדה במשימה מאתגרת' },
  { key: 'expectations',  label: 'ציפיות מהפרקטיקום' },
];

type Submission = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  course_name: string | null;
  year: string | null;
  cv_file_path: string | null;
  application_file_path: string | null;
  notes: string | null;
  questionnaire: Questionnaire | null;
  submitted_at: string;
  processed: boolean;
};

type Props = {
  /** Resolves to the OUTCOME. A submission is stamped נקלט only when this says ok. */
  onAcceptIntoCandidates: (sub: Submission) => Promise<{ ok: boolean; error?: string }>;
  refreshKey?: number;
  /**
   * Does this submission already have a candidate card? Supplied by the page so the
   * inbox and the intake answer it with the same rule and can never disagree.
   */
  hasCandidate?: (sub: Submission) => boolean;
};

export default function SubmissionsInbox({ onAcceptIntoCandidates, refreshKey, hasCandidate }: Props) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [showProcessed, setShowProcessed] = useState(false);
  const [acceptMsg, setAcceptMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from('candidate_submissions')
      .select('*')
      .order('submitted_at', { ascending: false });
    setLoading(false);
    if (error) {
      setError(
        error.code === '42P01' || error.message.includes('does not exist')
          ? 'טבלת ההגשות לא קיימת. הרץ את supabase_registration.sql ב‑Supabase כדי להפעיל.'
          : error.message
      );
      return;
    }
    setSubmissions(data || []);
  }

  useEffect(() => { load(); }, [refreshKey]);

  /**
   * Stamped נקלט, yet no candidate card exists for them.
   *
   * Two roads lead here: an intake that stamped the submission without the save
   * landing, or a candidate deleted afterwards. The inbox cannot tell those
   * apart, so it states the fact and leaves the judgement to the coordinator
   * rather than accusing anything of having failed.
   *
   * A cancelled interview is the one case we CAN name, so it is excluded — a
   * withdrawal is a finished story, not an open question.
   */
  const isOrphan = (s: Submission) =>
    !!hasCandidate && s.processed && !isCancelledSubmission(s.notes) && !hasCandidate(s);
  const orphans = submissions.filter(isOrphan);
  const visible = submissions.filter(s => showProcessed || !s.processed);

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }

  function toggleAll() {
    if (selectedIds.size === visible.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(visible.map(s => s.id)));
  }

  async function bulkDownload(mode: 'cv' | 'application' | 'both') {
    if (selectedIds.size === 0) return;
    setDownloading(true); setDownloadMsg(null);
    try {
      const zip = new JSZip();
      const selected = submissions.filter(s => selectedIds.has(s.id));
      let count = 0;
      for (const sub of selected) {
        const base = (sub.name || 'candidate').replace(/[^\u0590-\u05FFa-zA-Z0-9]/g, '_');
        if ((mode === 'cv' || mode === 'both') && sub.cv_file_path) {
          const { data } = await supabase.storage.from('candidate-uploads')
            .download(sub.cv_file_path);
          if (data) {
            const ext = sub.cv_file_path.split('.').pop() || 'pdf';
            const folder = mode === 'both' ? 'קורות_חיים/' : '';
            zip.file(`${folder}${base}_CV.${ext}`, data);
            count++;
          }
        }
        if ((mode === 'application' || mode === 'both') && sub.application_file_path) {
          const { data } = await supabase.storage.from('candidate-uploads')
            .download(sub.application_file_path);
          if (data) {
            const ext = sub.application_file_path.split('.').pop() || 'pdf';
            const folder = mode === 'both' ? 'טפסי_מועמדות/' : '';
            zip.file(`${folder}${base}_application.${ext}`, data);
            count++;
          }
        }
      }
      if (count === 0) {
        setDownloadMsg('אין קבצים להורדה בבחירה הנוכחית');
        setDownloading(false);
        return;
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const name = mode === 'cv' ? 'קורות_חיים' : mode === 'application' ? 'טפסי_מועמדות' : 'מסמכי_מועמדים';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloadMsg(`✓ הורדו ${count} קבצים`);
      setTimeout(() => setDownloadMsg(null), 4000);
    } catch (e: any) {
      setDownloadMsg('שגיאה: ' + (e?.message || 'הורדה נכשלה'));
    }
    setDownloading(false);
  }

  async function acceptSelected() {
    // An orphan may be taken in again — that is the way back from an intake whose
    // save never landed. Without it, a stamped submission is a dead end.
    const selected = submissions.filter(s => selectedIds.has(s.id) && (!s.processed || isOrphan(s)));
    if (selected.length === 0) return;
    setAcceptMsg(null);
    const succeeded = new Set<string>();
    let stopped = '';
    for (const sub of selected) {
      const res = await onAcceptIntoCandidates(sub);
      if (!res?.ok) {
        // Deliberately do NOT stamp. The submission stays exactly as it was, so it
        // can be retried once whatever failed has passed. Stamping here is what
        // used to make someone disappear: marked taken-in, never created.
        stopped = `נעצר על ${sub.name}: ${res?.error || 'השמירה נכשלה'} — לא סומן/ה כנקלט/ת, אפשר לנסות שוב`;
        break;
      }
      const { error: stampErr } = await supabase.from('candidate_submissions')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('id', sub.id);
      if (stampErr) {
        // The candidate IS saved — say so, so nobody takes them in twice looking
        // for a badge that never appeared.
        stopped = `${sub.name} נקלט/ה בהצלחה, אך סימון ההגשה נכשל: ${stampErr.message}`;
        succeeded.add(sub.id);
        break;
      }
      succeeded.add(sub.id);
    }
    setAcceptMsg(stopped || (succeeded.size ? `✓ נקלטו ${succeeded.size}` : null));
    // Keep whatever did not go through selected, ready for another try.
    setSelectedIds(prev => new Set([...prev].filter(id => !succeeded.has(id))));
    load();
  }

  async function deleteOne(sub: Submission) {
    const filesWillBeKept = sub.processed;
    const msg = sub.processed
      ? `למחוק את רשומת ההגשה של "${sub.name}"?\nהמועמד/ת כבר נקלט/ה — הקבצים יישמרו בכרטיס המועמד.`
      : `למחוק את ההגשה של "${sub.name}"? הפעולה גם מוחקת את קבצי ה‑CV והטופס שהועלו.`;
    if (!confirm(msg)) return;
    // Only remove files from storage if submission was NOT processed (files not yet linked to a candidate)
    if (!filesWillBeKept) {
      const paths = [sub.cv_file_path, sub.application_file_path].filter(Boolean) as string[];
      if (paths.length > 0) {
        await supabase.storage.from('candidate-uploads').remove(paths);
      }
    }
    // Remove submission row
    await supabase.from('candidate_submissions').delete().eq('id', sub.id);
    // Remove from selection if it was selected
    const next = new Set(selectedIds);
    next.delete(sub.id);
    setSelectedIds(next);
    load();
  }

  async function deleteSelected() {
    const selected = submissions.filter(s => selectedIds.has(s.id));
    if (selected.length === 0) return;
    const unprocessed = selected.filter(s => !s.processed);
    const processed   = selected.filter(s =>  s.processed);
    const msg = processed.length > 0
      ? `למחוק ${selected.length} הגשות?\n${unprocessed.length} שלא נקלטו — הקבצים שלהן יימחקו.\n${processed.length} שנקלטו — הקבצים יישמרו בכרטיסי המועמדים.\nפעולה זו לא ניתנת לשחזור.`
      : `למחוק ${selected.length} הגשות וגם את כל הקבצים שלהן?\nפעולה זו לא ניתנת לשחזור.`;
    if (!confirm(msg)) return;
    // Only delete files for unprocessed submissions
    const paths: string[] = [];
    for (const s of unprocessed) {
      if (s.cv_file_path) paths.push(s.cv_file_path);
      if (s.application_file_path) paths.push(s.application_file_path);
    }
    if (paths.length > 0) {
      const { error: storageErr } = await supabase.storage.from('candidate-uploads').remove(paths);
      if (storageErr) console.warn('file delete error:', storageErr);
    }
    const ids = selected.map(s => s.id);
    const { data: deleted, error: delErr } = await supabase
      .from('candidate_submissions')
      .delete()
      .in('id', ids)
      .select();
    if (delErr) {
      alert('שגיאת מחיקה: ' + delErr.message + '\n\nייתכן שחסרה מדיניות DELETE. הרץ בSupabase SQL Editor:\n\nCREATE POLICY "auth_delete" ON candidate_submissions FOR DELETE TO authenticated USING (true);');
      return;
    }
    if (!deleted || deleted.length < ids.length) {
      alert(`נמחקו רק ${deleted?.length || 0} מתוך ${ids.length} — RLS חוסם חלק מהשורות. הרץ:\n\nCREATE POLICY "auth_delete" ON candidate_submissions FOR DELETE TO authenticated USING (true);`);
    }
    setSelectedIds(new Set());
    load();
  }

  return (
    <section className="mb-12 rounded-xl border" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
      <div className="flex items-baseline justify-between gap-4 p-5 border-b" style={{ borderColor: 'var(--divider)' }}>
        <div>
          <div className="chapter-mark mb-1" style={{ fontSize: '11px' }}>Inbox</div>
          <h2 className="serif text-[24px] tracking-tight" style={{ color: 'var(--ink)' }}>
            הגשות שהתקבלו
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <label className="mono text-[11px] uppercase tracking-[0.14em] font-semibold cursor-pointer flex items-center gap-2" style={{ color: 'var(--text-soft)' }}>
            <input type="checkbox" checked={showProcessed} onChange={e => setShowProcessed(e.target.checked)} />
            הצג גם מעובדים
          </label>
          <button onClick={load} className="mono text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--accent)' }}>
            ↻ רענן
          </button>
        </div>
      </div>

      {/* Surfaced whether or not processed rows are shown — the whole point is that
          nobody has to go looking to discover someone fell between the two lists. */}
      {orphans.length > 0 && (
        <div data-inbox-orphans={orphans.length} className="px-5 py-3 text-[13px] border-b"
          style={{ borderColor: 'var(--divider)', background: 'rgba(217,119,6,0.10)', color: 'var(--ink)' }}>
          {orphans.length === 1
            ? <>הגשה אחת מסומנת כנקלטה, אך אין לה כרטיס מועמד: </>
            : <><strong>{orphans.length}</strong> הגשות מסומנות כנקלטו, אך אין להן כרטיס מועמד: </>}
          {orphans.map(o => o.name).join(', ')}.
          <span style={{ color: 'var(--text-soft)' }}> ייתכן שהמועמד/ת נמחק/ה, או שהקליטה לא הושלמה.</span>
          {!showProcessed && (
            <button data-inbox-show-orphans onClick={() => setShowProcessed(true)}
              className="mono text-[11px] uppercase tracking-[0.14em] font-semibold mr-2"
              style={{ color: 'var(--accent)' }}>
              הצג אותן ←
            </button>
          )}
        </div>
      )}

      {error ? (
        <div className="p-6 text-[14px]" style={{ color: 'var(--accent)' }}>
          ⚠ {error}
        </div>
      ) : loading ? (
        <div className="p-6 text-[14px]" style={{ color: 'var(--text-soft)' }}>טוען...</div>
      ) : visible.length === 0 ? (
        <div className="p-8 text-center text-[14px]" style={{ color: 'var(--text-soft)' }}>
          אין הגשות חדשות. הפצת קישור הרשמה:
          <div className="mono text-[12px] mt-3 p-3 rounded-lg" style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--ink)', userSelect: 'all', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
            {location.origin}/register/?course=פרקטיקום+משאבי+אנוש&year=תשפ״ז
          </div>
        </div>
      ) : (
        <>
          <div className="p-4 flex flex-wrap gap-3 items-center border-b" style={{ borderColor: 'var(--divider)' }}>
            <button onClick={toggleAll} className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-3 py-1 rounded-full border"
              style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>
              {selectedIds.size === visible.length ? '☐ נקה בחירה' : '☑ בחר הכל'}
            </button>
            <span className="mono text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>
              {selectedIds.size} נבחרו / {visible.length} סה״כ
            </span>
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap gap-2 mr-auto">
                <button onClick={() => bulkDownload('cv')} disabled={downloading} style={btnSecondary(downloading)}>📄 הורד CV נבחרים</button>
                <button onClick={acceptSelected} disabled={downloading} style={btnPrimary(downloading)}>
                  ✓ קלוט למערכת
                </button>
                <button onClick={deleteSelected} disabled={downloading}
                  className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-3.5 py-1.5 rounded-full border"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                  🗑 מחק נבחרים
                </button>
              </div>
            )}
          </div>

          {downloadMsg && (
            <div className="px-5 py-2 mono text-[11.5px] uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
              {downloadMsg}
            </div>
          )}

          {acceptMsg && (
            <div data-inbox-accept-msg className="px-5 py-2 text-[12.5px]" style={{ color: 'var(--accent)' }}>
              {acceptMsg}
            </div>
          )}

          <ul>
            {visible.map(s => <SubmissionCard key={s.id} s={s} orphan={isOrphan(s)} selected={selectedIds.has(s.id)} onToggle={() => toggle(s.id)} onDelete={() => deleteOne(s)} />)}
          </ul>
        </>
      )}
    </section>
  );
}

function SubmissionCard({ s, selected, orphan, onToggle, onDelete }: {
  s: Submission; selected: boolean; orphan?: boolean; onToggle: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasQ = s.questionnaire && Object.values(s.questionnaire).some(v => v?.trim());

  return (
    <li className="border-b" style={{ borderColor: 'var(--divider)', opacity: s.processed ? 0.6 : 1 }}>
      {/* ── header row ── */}
      <div className="flex items-start gap-4 px-5 py-4 hover:bg-[rgba(122,30,43,0.02)]">
        <label className="shrink-0 inline-flex items-start cursor-pointer" style={{ padding: '8px', margin: '-4px -8px' }} title="בחר / בטל בחירה">
          <input type="checkbox" checked={selected} onChange={onToggle} data-inbox-cb className="cursor-pointer" />
        </label>
        <div className="flex-1 min-w-0">
          {/* A long unbroken token — an id, a machine-generated name, a long address — has
              no break opportunity, so it overflowed the flex column and ran under the CV
              circle beside it. Yariv 2026-08-11: "העיגול שמקיף אותם דורס את השם."
              `anywhere` breaks mid-token only when there is no other option. */}
          <div className="serif text-[18px] leading-[1.2]"
            style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>
            {s.name}
            {s.processed && (
              <span className="mono text-[10px] uppercase tracking-[0.14em] font-semibold mr-2 px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)' }}>✓ נקלט</span>
            )}
            {isCancelledSubmission(s.notes) && (
              <span data-cancelled-badge className="mono text-[10px] uppercase tracking-[0.14em] font-semibold mr-2 px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(100,116,139,0.16)', color: '#475569' }}
                title="הראיון בוטל והמשבצת שוחררה">
                בוטל
              </span>
            )}
            {orphan && (
              <span data-orphan-badge className="mono text-[10px] uppercase tracking-[0.14em] font-semibold mr-2 px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(217,119,6,0.16)', color: '#b45309' }}
                title="מסומן/ת כנקלט/ת, אך אין כרטיס מועמד. אפשר לבחור ולקלוט שוב.">
                ללא כרטיס מועמד
              </span>
            )}
          </div>
          <div className="text-[12.5px] flex flex-wrap gap-x-3 gap-y-0.5 mt-1" style={{ color: 'var(--text-soft)' }}>
            {s.phone && <span dir="ltr">{s.phone}</span>}
            {s.email && <span style={{ overflowWrap: 'anywhere' }}>{s.email}</span>}
            {s.questionnaire?.studyTracks && <span className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>· {s.questionnaire.studyTracks}</span>}
            {s.questionnaire?.gpa && <span className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>· ממוצע {s.questionnaire.gpa}</span>}
            {s.course_name && <span>· {s.course_name}</span>}
            {s.year && <span>· {s.year}</span>}
            <span>· {new Date(s.submitted_at).toLocaleDateString('he-IL')}</span>
          </div>
          {s.notes && (
            <div className="mt-1.5 mono text-[11px] tracking-[0.04em] px-2 py-1 rounded"
              style={{ background: 'rgba(122,30,43,0.06)', color: 'var(--accent)', display: 'inline-block' }}>
              {s.notes}
            </div>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0 items-center mt-0.5">
          {s.cv_file_path && <FilePill label="CV" path={s.cv_file_path} />}
          {s.application_file_path && <FilePill label="טופס" path={s.application_file_path} />}
          {hasQ && (
            <button onClick={() => setOpen(o => !o)}
              className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2.5 py-1 rounded-full border hover:bg-[rgba(122,30,43,0.08)]"
              style={{ borderColor: 'var(--divider)', color: open ? 'var(--accent)' : 'var(--text-soft)' }}>
              שאלון {open ? '▲' : '▼'}
            </button>
          )}
          <button onClick={onDelete} title="מחק הגשה"
            className="w-7 h-7 rounded-full grid place-items-center text-[13px] hover:bg-[rgba(122,30,43,0.1)]"
            style={{ color: 'var(--accent)' }}>🗑</button>
        </div>
      </div>

      {/* ── questionnaire panel ── */}
      {open && hasQ && (
        <div className="px-14 pb-5 space-y-4">
          {Q_LABELS.filter(({ key }) => s.questionnaire?.[key]?.trim()).map(({ key, label }) => (
            <div key={key}>
              <div className="mono text-[10.5px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--accent)' }}>{label}</div>
              <p className="text-[13.5px] leading-[1.65] whitespace-pre-wrap" style={{ color: 'var(--ink)' }}>
                {s.questionnaire![key]}
              </p>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function FilePill({ label, path }: { label: string; path: string }) {
  const [loading, setLoading] = useState(false);

  async function open() {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const isWord = ext === 'docx' || ext === 'doc';

    const { data } = supabase.storage.from('candidate-uploads').getPublicUrl(path);
    const publicUrl = data.publicUrl;

    if (isWord) {
  // Every CV opener goes through openCv, and none of them reroutes Word through
  // Microsoft's Office Online viewer any more: that viewer answers with an empty frame whenever
  // it cannot fetch the file, and that empty frame was the blank page reported five
  // times. window.open is gone with it — an installed PWA has no tab bar to put one in.
      void openCv(publicUrl);
      return;
    }

    // PDF: fetch via public URL, force application/pdf so browser shows inline (not download)
    setLoading(true);
    const win = window.open('about:blank', '_blank'); // open before await
    try {
      const resp = await fetch(publicUrl);
      const buf = await resp.arrayBuffer();
      const blob = new Blob([buf], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      if (win) win.location.href = blobUrl;
      else window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
    } catch {
      if (win) win.location.href = publicUrl;
      else window.open(publicUrl, '_blank');
    }
    setLoading(false);
  }

  return (
    <button onClick={open} disabled={loading}
      className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2.5 py-1 rounded-full border hover:bg-[rgba(122,30,43,0.08)] disabled:opacity-50"
      style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
      {loading ? '...' : `${label} ↗`}
    </button>
  );
}
