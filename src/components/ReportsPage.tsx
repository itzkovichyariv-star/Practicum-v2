import { useMemo, useState } from 'react';
import { btnTab, btnSecondary } from '../lib/design';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear } from './pageShared';
import type { Student, Employer, Course, Dispatch } from '../lib/supabase';
import { countSlotsByStatus } from '../lib/placement';

type ReportKey = 'yoy' | 'timeline' | 'orgs' | 'students' | 'candidates' | 'lecturers'
              | 'placement_vacancy' | 'placement_dispatches' | 'placement_employers' | 'placement_students'
              | 'placement_by_org';

const REPORTS: { key: ReportKey; title: string; desc: string }[] = [
  { key: 'yoy',        title: 'השוואה בין שנים', desc: 'מדדי מפתח לפי שנה אקדמית — מסוננים לפי הקשר הנבחר. כשלא נבחר קורס מוצגים כל הנתונים.' },
  { key: 'timeline',   title: 'התקדמות השמה',    desc: 'פילוח שיבוצים לפי חודש עבור הקשר הנבחר — נרשם אוטומטית מכאן והלאה בכל שיבוץ חדש.' },
  { key: 'orgs',       title: 'ארגוני שיאנים',   desc: 'דירוג ארגוני השמה לפי מספר סטודנטים, עם השוואה בין שנים — לפי הקשר הנבחר.' },
  { key: 'students',   title: 'סטודנטים',        desc: 'רשימת סטודנטים מלאה לפי הקשר הנבחר — ייצוא ל‑CSV / הדפסה.' },
  { key: 'candidates', title: 'מועמדים',          desc: 'מועמדים עם פרטי ראיון, הערכה וציון — לפי הקשר הנבחר.' },
  { key: 'lecturers',  title: 'מרצים',            desc: 'מרצים, עלות מצטברת ומצב הרצאות — לפי הקשר הנבחר.' },
  { key: 'placement_vacancy',    title: '📍 מקומות שיבוץ',  desc: 'סיכום מקומות השיבוץ לפי קורס — כמה פנויים, בתהליך, שובצו.' },
  { key: 'placement_dispatches', title: '📤 יומן שליחות',   desc: 'כל שליחויות המועמדות — סטודנט, מעסיק, ערוץ, תאריך, תוצאה ואורך המתנה.' },
  { key: 'placement_employers',  title: '🏢 מעסיקים — שיבוץ', desc: 'פירוט לפי מעסיק: כמה מועמדויות נשלחו, שובצו, ואחוז קבלה.' },
  { key: 'placement_students',   title: '👤 סטודנטים — שיבוץ', desc: 'פירוט לפי סטודנט: סטטוס, כמה שליחויות, ימי המתנה והעדפה נוכחית.' },
  { key: 'placement_by_org',     title: '🏢 שיבוץ לפי ארגון — פירוט', desc: 'לכל ארגון: אילו סטודנטים נשלחו, הסטטוס, הערוץ והתאריך, וכמה מקומות נותרו פנויים. מקובץ לפי ארגון · להדפסה / CSV.' },
];

export default function ReportsPage({ data, context }: PageProps & { data: any }) {
  const [active, setActive] = useState<ReportKey>('yoy');

  const courses = data.courses || [];
  const students   = (data.students   || []).filter((s: any) => sameContext(s, context, courses));
  const candidates = (data.candidates || []).filter((c: any) => sameContext(c, context, courses));
  const lectures   = (data.lectures   || []).filter((l: any) => sameContext(l, context, courses));

  const allEmployers: Employer[] = data.employers || [];
  const allStudents: Student[]   = data.students  || [];
  const dispatches: Dispatch[]   = data.dispatches || [];
  const placementCourses: Course[] = (courses as Course[]).filter((c: Course) => (c as any).type === 'practicum');

  /* ── For YoY: when a course is selected, gather all courses with same name (cross-year) ── */
  const yoyStudents = useMemo(() => {
    if (!context.courseId) return data.students || [];
    const sel = courses.find(c => c.id === context.courseId);
    if (!sel) return data.students || [];
    const sameIds = new Set(courses.filter(c => c.name === sel.name).map(c => c.id));
    return (data.students || []).filter(s => sameIds.has(s.courseId));
  }, [context.courseId, courses, data]);

  const yoyCandidates = useMemo(() => {
    if (!context.courseId) return data.candidates || [];
    const sel = courses.find(c => c.id === context.courseId);
    if (!sel) return data.candidates || [];
    const sameIds = new Set(courses.filter(c => c.name === sel.name).map(c => c.id));
    return (data.candidates || []).filter(c => sameIds.has(c.courseId));
  }, [context.courseId, courses, data]);

  const yoyLectures = useMemo(() => {
    if (!context.courseId) return data.lectures || [];
    const sel = courses.find(c => c.id === context.courseId);
    if (!sel) return data.lectures || [];
    const sameIds = new Set(courses.filter(c => c.name === sel.name).map(c => c.id));
    return (data.lectures || []).filter(l => sameIds.has(l.courseId || ''));
  }, [context.courseId, courses, data]);

  const allYears = useMemo(() => {
    const s = new Set<string>();
    yoyStudents.forEach(x => x.year && s.add(normalizeYear(x.year)));
    yoyLectures.forEach(x => x.year && s.add(normalizeYear(x.year)));
    return Array.from(s).sort();
  }, [yoyStudents, yoyLectures]);

  const courseLabel = (id?: string) => courses.find(c => c.id === id)?.name || '—';

  /* ── Report builder ── */
  const report = useMemo(() => {
    switch (active) {

      /* ── YoY: context-aware (all courses with same name, across years) ── */
      case 'yoy': {
        const rows = allYears.map(y => {
          const s = yoyStudents.filter(x => normalizeYear(x.year || '') === y);
          const c = yoyCandidates.filter(x => normalizeYear(x.year || '') === y);
          const l = yoyLectures.filter(x => normalizeYear(x.year || '') === y);
          const placed     = s.filter(x => x.acceptedOrg).length;
          const hired      = s.filter(x => x.hired).length;
          const prepPassed = s.filter(x => x.preparation?.passed).length;
          const orgsTotal  = s
            .filter(x => x.acceptedOrg)
            .reduce((sum, st) =>
              sum + (st.firstChoiceResult !== 'failed' ? 1 : st.secondChoiceOrg ? 2 : 1), 0);
          const avgOrgs = placed > 0 ? (orgsTotal / placed).toFixed(1) : '—';
          return [
            y,
            c.length > 0 ? String(c.length) : '—',
            String(s.length),
            String(prepPassed),
            String(placed),
            String(hired),
            s.length > 0 ? `${Math.round((placed / s.length) * 100)}%` : '—',
            avgOrgs,
            String(l.length),
          ];
        });
        return {
          headers: ['שנה', 'מועמדים', 'סטודנטים', 'עברו הכנה', 'שובצו', 'נקלטו', 'שיעור השמה', 'ממוצע ארגונים', 'הרצאות'],
          rows,
        };
      }

      /* ── Timeline: custom render — return null so PlacementChart renders instead ── */
      case 'timeline':
        return null;

      /* ── Org rankings: context-filtered, pivot by year ── */
      case 'orgs': {
        const placed = students.filter(s => s.acceptedOrg);
        if (placed.length === 0) return { headers: [], rows: [] };

        const pivot: Record<string, Record<string, number>> = {};
        placed.forEach(s => {
          const org  = s.acceptedOrg!;
          const year = normalizeYear(s.year || '') || '—';
          pivot[org] ??= {};
          pivot[org][year] = (pivot[org][year] || 0) + 1;
        });

        const orgYears = Array.from(
          new Set(placed.map(s => normalizeYear(s.year || '') || '—'))
        ).sort();

        const lastYear = orgYears[orgYears.length - 1] ?? '';

        const sorted = Object.entries(pivot)
          .map(([org, byYear]) => {
            const total  = Object.values(byYear).reduce((s, v) => s + v, 0);
            const inLast = byYear[lastYear] || 0;
            return { org, total, inLast, byYear };
          })
          .sort((a, b) => b.inLast - a.inLast || b.total - a.total);

        const headers = ['#', 'ארגון', 'סה״כ', ...orgYears];
        const rows = sorted.map((item, i) => [
          String(i + 1),
          item.org,
          String(item.total),
          ...orgYears.map(y => item.byYear[y] ? String(item.byYear[y]) : ''),
        ]);

        return { headers, rows };
      }

      /* ── Students list ── */
      case 'students': return {
        headers: ['שם', 'סטטוס', 'שובץ ב', 'בחירה 1', 'בחירה 2', 'נקלט', 'הכנה', 'תאריך שיבוץ', 'שעות מאושרות', 'טלפון', 'מייל', 'עיר', 'קורס', 'שנה', 'הערות'],
        rows: students.map(s => {
          const status =
            s.hired                                              ? '✅ נקלט לעבודה' :
            s.acceptedOrg                                        ? '✓ שובץ בארגון'  :
            s.firstChoiceResult === 'failed' && s.secondChoiceOrg ? '↺ בבחירה שנייה'  :
            s.preparation?.passed                                ? '⏳ בחיפוש ארגון' :
            (s as any).fromCandidate                             ? '📚 ממתין להכנה'  : '— פעיל/ה';
          return [
            s.name || '',
            status,
            s.acceptedOrg || '',
            s.firstChoiceOrg
              ? `${s.firstChoiceOrg}${s.firstChoiceResult === 'passed' ? ' ✓' : s.firstChoiceResult === 'failed' ? ' ✗' : ''}`
              : '',
            s.secondChoiceOrg
              ? `${s.secondChoiceOrg}${s.secondChoiceResult === 'passed' ? ' ✓' : s.secondChoiceResult === 'failed' ? ' ✗' : ''}`
              : '',
            s.hired ? '✓' : '',
            s.preparation?.passed
              ? `✓${s.preparation.date ? ' · ' + new Date(s.preparation.date).toLocaleDateString('he-IL') : ''}`
              : '—',
            s.placedAt ? new Date(s.placedAt).toLocaleDateString('he-IL') : '',
            String(s.hoursApproved || 0),
            s.phone || '',
            s.email || '',
            s.city  || '',
            courseLabel(s.courseId),
            normalizeYear(s.year || ''),
            s.notes || '',
          ];
        }),
      };

      /* ── Candidates list ── */
      case 'candidates': return {
        headers: ['שם', 'תאריך הגשה', 'תאריך ראיון', 'תוצאה', 'ציון', 'תחום', 'מחויבות', 'מוטיבציה', 'תקשורת', 'סיבת דחייה', 'טלפון', 'מייל', 'קורס', 'שנה'],
        rows: candidates.map(c => [
          c.name || '',
          c.applicationDate ? new Date(c.applicationDate).toLocaleDateString('he-IL') : '',
          c.interviewDate   ? new Date(c.interviewDate).toLocaleDateString('he-IL')   : 'לא נקבע',
          c.interviewResult === 'passed' ? '✓ עבר/ה' : c.interviewResult === 'failed' ? '✗ לא התקבל' : 'ממתין',
          c.evalScore != null ? String(c.evalScore) : '',
          c.preferredArea     || '',
          c.evalCommitment    || '',
          c.evalMotivation    || '',
          c.evalCommunication || '',
          c.rejectionReason   || '',
          c.phone || '',
          c.email || '',
          courseLabel(c.courseId),
          normalizeYear(c.year || ''),
        ]),
      };

      /* ── Lecturers summary ── */
      case 'lecturers': {
        const by: Record<string, {
          name: string; count: number; approved: number; pending: number;
          cancelled: number; totalCost: number; email: string; phone: string;
        }> = {};
        lectures.forEach(l => {
          const k = l.lecturer || '—';
          by[k] ??= { name: k, count: 0, approved: 0, pending: 0, cancelled: 0, totalCost: 0, email: '', phone: '' };
          by[k].count++;
          if (l.status === 'מאושר')         by[k].approved++;
          if (l.status === 'ממתין לאישור')  by[k].pending++;
          if (l.status === 'בוטל')          by[k].cancelled++;
          by[k].totalCost += Number(l.cost) || 0;
          if (l.lecturerEmail) by[k].email = l.lecturerEmail;
          if (l.lecturerPhone) by[k].phone = l.lecturerPhone;
        });
        return {
          headers: ['מרצה', 'הרצאות', 'מאושרות', 'ממתינות', 'בוטלו', 'עלות מצטברת', 'מייל', 'טלפון'],
          rows: Object.values(by)
            .sort((a, b) => b.count - a.count)
            .map(r => [
              r.name, String(r.count), String(r.approved), String(r.pending), String(r.cancelled),
              r.totalCost > 0 ? '₪' + r.totalCost.toLocaleString('he-IL') : '—',
              r.email, r.phone,
            ]),
        };
      }

      /* ── Placement: Vacancy per course ── */
      case 'placement_vacancy': {
        if (placementCourses.length === 0) return { headers: [], rows: [] };
        const rows = placementCourses.map(c => {
          const emps = allEmployers.filter(e => (e.courseIds || []).includes(c.id));
          let total = 0, available = 0, tentative = 0, under_review = 0, placed = 0, sent = 0;
          emps.forEach(e => {
            const counts = countSlotsByStatus(e as any, c.id);
            total        += counts.total;
            available    += counts.available;
            tentative    += counts.tentative;
            under_review += counts.under_review;
            placed       += counts.placed;
            sent         += counts.tentative + counts.under_review + counts.placed;
          });
          return [c.name, String(emps.length), String(total), String(available), String(tentative + under_review), String(sent), String(placed)];
        });
        return { headers: ['קורס', 'מעסיקים', 'סה"כ מקומות', 'פנויים', 'בתהליך', 'מועמדויות נשלחו', 'שובצו'], rows };
      }

      /* ── Placement: Dispatch log ── */
      case 'placement_dispatches': {
        if (dispatches.length === 0) return { headers: [], rows: [] };
        const sorted = [...dispatches].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
        const rows = sorted.map(d => {
          const student = allStudents.find(s => s.id === d.studentId);
          const employer = allEmployers.find(e => e.id === d.employerId);
          const sentDate = new Date(d.sentAt);
          const resultDate = d.resultAt ? new Date(d.resultAt) : null;
          const waitDays = resultDate
            ? Math.round((resultDate.getTime() - sentDate.getTime()) / 86400000)
            : Math.round((Date.now() - sentDate.getTime()) / 86400000);
          const resultLabel =
            d.result === 'placed'    ? '✅ שובץ' :
            d.result === 'rejected'  ? '❌ נדחה' :
            d.result === 'withdrawn' ? '🚫 בוטל' : '⏳ ממתין';
          const channelLabel = d.channel === 'whatsapp' ? '💬 WhatsApp' : '📧 אימייל';
          return [
            student?.name || d.studentId,
            employer?.name || d.employerId,
            channelLabel,
            sentDate.toLocaleDateString('he-IL'),
            resultLabel,
            resultDate ? resultDate.toLocaleDateString('he-IL') : '—',
            `${waitDays} ימים`,
          ];
        });
        return { headers: ['סטודנט', 'מעסיק', 'ערוץ', 'תאריך שליחה', 'תוצאה', 'תאריך תוצאה', 'אורך המתנה'], rows };
      }

      /* ── Placement: Per-employer breakdown ── */
      case 'placement_employers': {
        const empsWithSlots = allEmployers.filter(e => (e as any).vacancySlots?.length > 0);
        if (empsWithSlots.length === 0) return { headers: [], rows: [] };
        const rows = empsWithSlots.map(e => {
          const counts = countSlotsByStatus(e as any);
          const empDispatches = dispatches.filter(d => d.employerId === e.id);
          const placedCount = empDispatches.filter(d => d.result === 'placed').length;
          const sentCount   = empDispatches.length;
          const rate        = sentCount > 0 ? `${Math.round((placedCount / sentCount) * 100)}%` : '—';
          const courseNames = (e.courseIds || [])
            .map((cid: string) => courses.find((c: any) => c.id === cid)?.name || cid)
            .join(', ');
          return [
            e.name,
            courseNames,
            String(counts.total),
            String(counts.available),
            String(counts.tentative + counts.under_review),
            String(sentCount),
            String(placedCount),
            rate,
          ];
        });
        return { headers: ['מעסיק', 'קורסים', 'סה"כ מקומות', 'פנויים', 'בתהליך', 'שליחויות', 'שובצו', 'אחוז קבלה'], rows };
      }

      /* ── Placement: Per-student placement breakdown ── */
      case 'placement_students': {
        const practicumStudents = allStudents.filter(s => {
          const course = courses.find((c: any) => c.id === s.courseId);
          return course && (course as any).type === 'practicum';
        });
        if (practicumStudents.length === 0) return { headers: [], rows: [] };
        const rows = practicumStudents.map(s => {
          const prefs: any[] = (s as any).preferences || [];
          const studDispatches = dispatches.filter(d => d.studentId === s.id);
          const submissionStatus = (s as any).submissionStatus || 'draft';
          const statusLabel =
            submissionStatus === 'placed'    ? '✅ שובץ' :
            submissionStatus === 'submitted' ? '📤 הוגש' :
            submissionStatus === 'exhausted' ? '⚠️ מוצה' : '📝 טיוטה';
          const currentPref = prefs.find(p => p.status === 'under_review') || prefs.find(p => p.status === 'tentative');
          const currentEmp  = currentPref ? allEmployers.find(e => e.id === currentPref.employerId)?.name || '—' : '—';
          const oldestDispatch = studDispatches.reduce((oldest: Date | null, d) => {
            const dt = new Date(d.sentAt);
            return (!oldest || dt < oldest) ? dt : oldest;
          }, null);
          const daysInSystem = oldestDispatch
            ? Math.round((Date.now() - oldestDispatch.getTime()) / 86400000)
            : 0;
          const course = courses.find((c: any) => c.id === s.courseId);
          return [
            s.name || '',
            (course as any)?.name || '—',
            statusLabel,
            String(studDispatches.length),
            daysInSystem > 0 ? `${daysInSystem} ימים` : '—',
            currentEmp,
          ];
        });
        return { headers: ['סטודנט', 'קורס', 'סטטוס', 'שליחויות', 'ימי המתנה', 'העדפה נוכחית'], rows };
      }

      /* ── Placement: per-organization detail (who was sent, status, remaining) ── */
      case 'placement_by_org': {
        const statusLabel = (st: string) => ({
          tentative: 'ממתין לשליחה', under_review: 'בבדיקה אצל מעסיק',
          placed: '✅ שובץ', rejected: '❌ נדחה', withdrawn: '🚫 בוטל',
        } as Record<string, string>)[st] || st || '—';
        const groups = allEmployers
          .map(e => ({ e, studs: allStudents.filter(s => ((s as any).preferences || []).some((p: any) => p.employerId === e.id)) }))
          .filter(g => g.studs.length > 0)
          .sort((a, b) => (a.e.name || '').localeCompare(b.e.name || '', 'he'));
        if (groups.length === 0) return { headers: [], rows: [] };
        const rows: string[][] = [];
        for (const { e, studs } of groups) {
          const c = countSlotsByStatus(e as any);
          const cap = `${c.available} / ${c.total}`;
          const sorted = [...studs].sort((a, b) => {
            const pa = ((a as any).preferences || []).find((p: any) => p.employerId === e.id)?.rank ?? 99;
            const pb = ((b as any).preferences || []).find((p: any) => p.employerId === e.id)?.rank ?? 99;
            return pa - pb;
          });
          for (const s of sorted) {
            const pref = ((s as any).preferences || []).find((p: any) => p.employerId === e.id);
            const ds = dispatches.filter(d => d.studentId === s.id && d.employerId === e.id)
              .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
            const last = ds[0];
            rows.push([
              e.name,
              cap,
              s.name || '',
              pref ? `#${pref.rank}` : '—',
              statusLabel(pref?.status),
              last ? (last.channel === 'whatsapp' ? 'WhatsApp' : 'מייל') : '—',
              last ? new Date(last.sentAt).toLocaleDateString('he-IL') : '—',
            ]);
          }
        }
        return { headers: ['ארגון', 'פנויים / סה"כ', 'סטודנט', 'העדפה', 'סטטוס', 'ערוץ אחרון', 'תאריך שליחה'], rows };
      }

      default: return null;
    }
  }, [active, students, candidates, lectures, allYears, yoyStudents, yoyCandidates, yoyLectures, courses, data, dispatches, allEmployers, allStudents, placementCourses]);

  /* ── Drop empty columns ── */
  const compactReport = useMemo(() => {
    if (!report || report.rows.length === 0) return report;
    const keep = report.headers.map((_, col) =>
      report.rows.some(r => { const v = r[col]; return v != null && String(v).trim() !== '' && v !== '—'; })
    );
    return {
      headers: report.headers.filter((_, i) => keep[i]),
      rows: report.rows.map(r => r.filter((_, i) => keep[i])),
    };
  }, [report]);

  function downloadCsv() {
    if (!compactReport) return;
    const { headers, rows } = compactReport;
    const csv = [headers, ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`))]
      .map(r => r.join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${active}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-10 pt-14 pb-28">

      <section className="pt-4 pb-12 border-b mb-10 print:hidden" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">VIII · דוחות</div>
        <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>דוחות</h1>
        <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
          כל הדוחות מסוננים לפי הקשר הנבחר. השוואה בין שנים עוקבת אחר כל שנות הקורס הנבחר.
        </p>
      </section>

      {/* Tabs */}
      <section className="mb-8 flex flex-wrap gap-2 print:hidden">
        {REPORTS.map(r => (
          <button key={r.key} onClick={() => setActive(r.key)} style={btnTab(r.key === active)}>
            {r.title}
          </button>
        ))}
      </section>

      {/* Description + export */}
      <section className="mb-8 print:hidden">
        <p className="text-[14px]" style={{ color: 'var(--text-soft)' }}>
          {REPORTS.find(r => r.key === active)?.desc}
        </p>
        {active !== 'timeline' && active !== 'placement_dispatches' && (
          <div className="flex gap-3 mt-5">
            <button onClick={downloadCsv} style={btnSecondary()}>📊 הורד CSV</button>
            <button onClick={() => window.print()} style={btnSecondary()}>🖨 הדפס / PDF</button>
            {compactReport && (
              <span className="mr-auto mono text-[12px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>
                {compactReport.rows.length} שורות · {compactReport.headers.length} עמודות
              </span>
            )}
          </div>
        )}
      </section>

      {/* Content */}
      <section>
        {active === 'timeline' ? (
          <PlacementChart students={students} />
        ) : active === 'placement_dispatches' ? (
          <PlacementDispatchTable dispatches={dispatches} students={allStudents} employers={allEmployers} />
        ) : !compactReport || compactReport.rows.length === 0 ? (
          <div className="py-16 text-center text-[15px]" style={{ color: 'var(--text-soft)' }}>
            אין נתונים בהקשר הנוכחי
          </div>
        ) : (
          <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
            <table className="w-full text-[14px]" dir="rtl">
              <thead>
                <tr style={{ background: 'rgba(122,30,43,0.06)' }}>
                  {compactReport.headers.map((h, i) => (
                    <th key={i}
                      className="mono text-[11.5px] uppercase tracking-[0.12em] font-semibold text-right px-4 py-3 whitespace-nowrap"
                      style={{ color: 'var(--ink)', borderBottom: '1px solid var(--divider)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compactReport.rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--divider)' }}
                    className={active === 'orgs' ? 'hover:bg-[rgba(122,30,43,0.03)]' : ''}>
                    {row.map((cell, j) => (
                      <td key={j} className="px-4 py-3 align-top"
                        style={{
                          color: active === 'orgs' && j === 0 ? 'var(--text-soft)' : 'var(--ink)',
                          fontWeight: active === 'orgs' && j === 0 ? 700 : undefined,
                        } as React.CSSProperties}>
                        {cell || <span style={{ color: 'var(--text-soft)' }}>—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </main>
  );
}

/* ── Placement Dispatch Table (sortable with aging) ────────────────────── */

type DispatchSortKey = 'sentAt' | 'student' | 'employer' | 'result' | 'waitDays';

function PlacementDispatchTable({
  dispatches, students, employers,
}: { dispatches: Dispatch[]; students: Student[]; employers: Employer[] }) {
  const [sortKey, setSortKey]   = useState<DispatchSortKey>('sentAt');
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc');
  const [filterResult, setFilterResult] = useState<string>('all');

  function toggleSort(key: DispatchSortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const rows = useMemo(() => {
    const enriched = dispatches.map(d => {
      const student  = students.find(s => s.id === d.studentId);
      const employer = employers.find(e => e.id === d.employerId);
      const sentDate  = new Date(d.sentAt);
      const resultDate = d.resultAt ? new Date(d.resultAt) : null;
      const waitDays   = resultDate
        ? Math.round((resultDate.getTime() - sentDate.getTime()) / 86400000)
        : Math.round((Date.now() - sentDate.getTime()) / 86400000);
      return { d, student, employer, sentDate, resultDate, waitDays };
    });

    const filtered = filterResult === 'all'
      ? enriched
      : enriched.filter(r => r.d.result === filterResult);

    return filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'sentAt')   cmp = a.sentDate.getTime() - b.sentDate.getTime();
      if (sortKey === 'student')  cmp = (a.student?.name || '').localeCompare(b.student?.name || '', 'he');
      if (sortKey === 'employer') cmp = (a.employer?.name || '').localeCompare(b.employer?.name || '', 'he');
      if (sortKey === 'result')   cmp = a.d.result.localeCompare(b.d.result);
      if (sortKey === 'waitDays') cmp = a.waitDays - b.waitDays;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [dispatches, students, employers, sortKey, sortDir, filterResult]);

  if (dispatches.length === 0) {
    return (
      <div className="py-16 text-center text-[15px]" style={{ color: 'var(--text-soft)' }}>
        אין שליחויות עדיין — שלח מועמדות ראשונה מלשונית הסטודנטים
      </div>
    );
  }

  const agingThreshold = 14; // default; could come from settings

  const SortBtn = ({ k, label }: { k: DispatchSortKey; label: string }) => (
    <button
      onClick={() => toggleSort(k)}
      className="flex items-center gap-1 whitespace-nowrap"
      style={{ color: 'var(--ink)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'ui-monospace, monospace', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600, padding: 0 }}>
      {label}
      {sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
    </button>
  );

  const resultOptions = [
    { value: 'all',      label: 'הכל' },
    { value: 'pending',  label: '⏳ ממתין' },
    { value: 'placed',   label: '✅ שובץ' },
    { value: 'rejected', label: '❌ נדחה' },
    { value: 'withdrawn',label: '🚫 בוטל' },
  ];

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }} dir="rtl">
        <span style={{ fontSize: '13px', color: 'var(--text-soft)', alignSelf: 'center' }}>סינון:</span>
        {resultOptions.map(opt => (
          <button key={opt.value} onClick={() => setFilterResult(opt.value)}
            style={{ padding: '5px 14px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer', fontWeight: filterResult === opt.value ? 700 : 400, border: '1px solid var(--divider)', background: filterResult === opt.value ? 'var(--accent-soft)' : 'transparent', color: filterResult === opt.value ? 'var(--accent)' : 'var(--ink)' }}>
            {opt.label}
          </button>
        ))}
        <span style={{ marginRight: 'auto', fontSize: '12px', color: 'var(--text-soft)', alignSelf: 'center' }}>
          {rows.length} מתוך {dispatches.length} שורות
        </span>
      </div>

      <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
        <table className="w-full text-[13.5px]" dir="rtl">
          <thead>
            <tr style={{ background: 'rgba(122,30,43,0.06)' }}>
              <th className="text-right px-4 py-3" style={{ borderBottom: '1px solid var(--divider)' }}>
                <SortBtn k="student" label="סטודנט" />
              </th>
              <th className="text-right px-4 py-3" style={{ borderBottom: '1px solid var(--divider)' }}>
                <SortBtn k="employer" label="מעסיק" />
              </th>
              <th className="text-right px-4 py-3 whitespace-nowrap" style={{ borderBottom: '1px solid var(--divider)', color: 'var(--ink)', fontFamily: 'ui-monospace, monospace', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>ערוץ</th>
              <th className="text-right px-4 py-3" style={{ borderBottom: '1px solid var(--divider)' }}>
                <SortBtn k="sentAt" label="תאריך שליחה" />
              </th>
              <th className="text-right px-4 py-3" style={{ borderBottom: '1px solid var(--divider)' }}>
                <SortBtn k="result" label="תוצאה" />
              </th>
              <th className="text-right px-4 py-3 whitespace-nowrap" style={{ borderBottom: '1px solid var(--divider)', color: 'var(--ink)', fontFamily: 'ui-monospace, monospace', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>תאריך תוצאה</th>
              <th className="text-right px-4 py-3" style={{ borderBottom: '1px solid var(--divider)' }}>
                <SortBtn k="waitDays" label="אורך המתנה" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ d, student, employer, sentDate, resultDate, waitDays }) => {
              const isAging  = d.result === 'pending' && waitDays >= agingThreshold;
              const resultLabel =
                d.result === 'placed'    ? '✅ שובץ' :
                d.result === 'rejected'  ? '❌ נדחה' :
                d.result === 'withdrawn' ? '🚫 בוטל' : '⏳ ממתין';
              const channelLabel = d.channel === 'whatsapp' ? '💬 WhatsApp' : '📧 אימייל';
              return (
                <tr key={d.id} style={{ borderBottom: '1px solid var(--divider)', background: isAging ? 'rgba(185,28,28,0.04)' : undefined }}>
                  <td className="px-4 py-3" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                    {student?.name || d.studentId}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--ink)' }}>
                    {employer?.name || d.employerId}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-soft)', fontSize: '12px' }}>
                    {channelLabel}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                    {sentDate.toLocaleDateString('he-IL')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: d.result === 'placed' ? '#15803d' : d.result === 'rejected' ? '#b91c1c' : d.result === 'withdrawn' ? 'var(--text-soft)' : 'var(--ink)' }}>
                    {resultLabel}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-soft)', fontSize: '12px' }}>
                    {resultDate ? resultDate.toLocaleDateString('he-IL') : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: isAging ? '#b91c1c' : 'var(--ink)', fontWeight: isAging ? 700 : undefined }}>
                    {waitDays} ימים{isAging ? ' ⚠️' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Placement Timeline Chart ───────────────────────────────────────────── */

const HE_MONTHS: Record<string, string> = {
  '01': 'ינו׳', '02': 'פבר׳', '03': 'מרץ', '04': 'אפר׳',
  '05': 'מאי',  '06': 'יוני', '07': 'יול׳', '08': 'אוג׳',
  '09': 'ספט׳', '10': 'אוק׳', '11': 'נוב׳', '12': 'דצמ׳',
};

function PlacementChart({ students }: { students: Student[] }) {
  const placed = students.filter(s => s.placedAt);

  if (placed.length === 0) {
    return (
      <div className="py-20 text-center">
        <div className="serif text-[22px] mb-3" style={{ color: 'var(--ink)' }}>אין נתוני תאריך שיבוץ עדיין</div>
        <div className="text-[14px] max-w-[440px] mx-auto leading-[1.7]" style={{ color: 'var(--text-soft)' }}>
          השדה "תאריך שיבוץ" נרשם אוטומטית מעכשיו בכל שיבוץ חדש.
          הגרף יתמלא בהדרגה ויאפשר להשוות בין שנות לימוד.
        </div>
      </div>
    );
  }

  // Group by YYYY-MM, then by year separately for comparison
  const byMonth: Record<string, number> = {};
  const byYearMonth: Record<string, Record<string, number>> = {};

  placed.forEach(s => {
    const m = s.placedAt!.slice(0, 7); // YYYY-MM
    const [yr, mo] = m.split('-');
    byMonth[m] = (byMonth[m] || 0) + 1;
    byYearMonth[yr] ??= {};
    byYearMonth[yr][mo] = (byYearMonth[yr][mo] || 0) + 1;
  });

  const allMonths = Object.keys(byMonth).sort();
  const years = Object.keys(byYearMonth).sort();
  const max = Math.max(...Object.values(byMonth), 1);

  // SVG dimensions
  const W = 800, H = 220;
  const PAD = { top: 24, bottom: 44, left: 32, right: 16 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const n = allMonths.length;
  const barW = Math.max(12, Math.min(36, (chartW / n) * 0.6));
  const step = chartW / n;

  // Cumulative
  let cum = 0;
  const cumPoints: { x: number; y: number }[] = [];
  allMonths.forEach((m, i) => {
    cum += byMonth[m];
    const x = PAD.left + i * step + step / 2;
    const y = PAD.top + chartH - (cum / (placed.length || 1)) * chartH;
    cumPoints.push({ x, y });
  });
  const cumPath = cumPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Y-axis gridlines
  const yTicks = max <= 4 ? [1, 2, 3, 4].filter(v => v <= max) : [Math.ceil(max / 4), Math.ceil(max / 2), Math.ceil(max * 3 / 4), max];

  return (
    <div>
      {/* Year comparison legend */}
      {years.length > 1 && (
        <div className="flex gap-5 mb-6 flex-wrap">
          {years.map((y, i) => (
            <div key={y} className="flex items-center gap-2">
              <div className="w-8 h-2 rounded" style={{ background: i === years.length - 1 ? 'var(--accent)' : 'rgba(122,30,43,0.3)' }} />
              <span className="mono text-[11px] uppercase tracking-[0.13em]" style={{ color: 'var(--text-soft)' }}>{y}</span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <svg width="32" height="8"><line x1="0" y1="4" x2="32" y2="4" stroke="rgba(122,30,43,0.5)" strokeWidth="1.5" strokeDasharray="3,2" /></svg>
            <span className="mono text-[11px] uppercase tracking-[0.13em]" style={{ color: 'var(--text-soft)' }}>מצטבר %</span>
          </div>
        </div>
      )}

      {/* SVG Chart */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
          {/* Grid lines */}
          {yTicks.map(v => {
            const y = PAD.top + chartH - (v / max) * chartH;
            return (
              <g key={v}>
                <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                  stroke="var(--divider)" strokeWidth="0.8" />
                <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="9"
                  fill="var(--text-soft)">{v}</text>
              </g>
            );
          })}

          {/* Bars */}
          {allMonths.map((m, i) => {
            const [yr, mo] = m.split('-');
            const isLatestYear = yr === years[years.length - 1];
            const barH = (byMonth[m] / max) * chartH;
            const x = PAD.left + i * step + step / 2 - barW / 2;
            const y = PAD.top + chartH - barH;
            const label = HE_MONTHS[mo] || mo;
            return (
              <g key={m}>
                <rect x={x} y={y} width={barW} height={barH}
                  fill={isLatestYear ? 'var(--accent)' : 'rgba(122,30,43,0.3)'}
                  rx="3" />
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="10"
                  fill="var(--ink)">{byMonth[m]}</text>
                <text x={PAD.left + i * step + step / 2} y={H - PAD.bottom + 14}
                  textAnchor="middle" fontSize="9.5" fill="var(--text-soft)">{label}</text>
                {/* Year label below month if multi-year */}
                {years.length > 1 && (
                  <text x={PAD.left + i * step + step / 2} y={H - PAD.bottom + 26}
                    textAnchor="middle" fontSize="8" fill="var(--text-soft)" opacity="0.6">{yr}</text>
                )}
              </g>
            );
          })}

          {/* Cumulative % line */}
          {cumPoints.length > 1 && (
            <path d={cumPath} fill="none"
              stroke="rgba(122,30,43,0.5)" strokeWidth="1.5" strokeDasharray="4 2" />
          )}
          {cumPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3"
              fill="white" stroke="rgba(122,30,43,0.6)" strokeWidth="1.5" />
          ))}

          {/* Baseline */}
          <line x1={PAD.left} y1={PAD.top + chartH} x2={W - PAD.right} y2={PAD.top + chartH}
            stroke="var(--divider)" strokeWidth="1" />
        </svg>
      </div>

      {/* Summary stats below chart */}
      <div className="flex flex-wrap gap-8 mt-6">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--text-soft)' }}>סה״כ שובצו</div>
          <div className="serif text-[28px]" style={{ color: 'var(--ink)' }}>{placed.length}</div>
        </div>
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--text-soft)' }}>פעיל משנת</div>
          <div className="serif text-[28px]" style={{ color: 'var(--ink)' }}>{allMonths[0]?.slice(0, 4) || '—'}</div>
        </div>
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--text-soft)' }}>שיא חודשי</div>
          <div className="serif text-[28px]" style={{ color: 'var(--ink)' }}>
            {Math.max(...Object.values(byMonth))}
            <span className="text-[14px] font-normal mr-1" style={{ color: 'var(--text-soft)' }}>
              {(() => { const peak = allMonths.find(m => byMonth[m] === Math.max(...Object.values(byMonth))); return peak ? HE_MONTHS[peak.split('-')[1]] : ''; })()}
            </span>
          </div>
        </div>
        {years.length > 1 && years.map(y => {
          const total = Object.values(byYearMonth[y] || {}).reduce((s, v) => s + v, 0);
          return (
            <div key={y}>
              <div className="mono text-[11px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--text-soft)' }}>{y}</div>
              <div className="serif text-[28px]" style={{ color: 'var(--ink)' }}>{total}</div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
        💡 הגרף מציג שיבוצים לפי תאריך רישום ב"תאריך שיבוץ". הנתון נרשם אוטומטית מעכשיו בכל שיבוץ חדש — שנים עתידיות ייראו בגרף ברגע שתיצבר היסטוריה.
      </p>
    </div>
  );
}
