import { useMemo, useState } from 'react';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear } from './pageShared';

type ReportKey = 'students' | 'candidates' | 'employers' | 'placement' | 'lecturers' | 'yoy';

const REPORTS: { key: ReportKey; title: string; desc: string }[] = [
  { key: 'students',   title: 'סטודנטים',       desc: 'רשימה מלאה: שם, קורס, שנה, סטטוס הכנה, השמה, נקלטו, שעות' },
  { key: 'candidates', title: 'מועמדים',         desc: 'מועמדים עם ראיון, הערכה, ציון, ותוצאה סופית' },
  { key: 'employers',  title: 'מעסיקים',        desc: 'ארגונים, אנשי קשר, משרות (סה״כ / מאוישות / פתוחות), סטודנטים בכל ארגון' },
  { key: 'placement',  title: 'תמונת השמה',    desc: 'שיעור השמה לפי קורס, לפי מוסד, ופילוח נקלטו/טרם שובצו' },
  { key: 'lecturers',  title: 'מרצים',           desc: 'רשימת מרצים, כמות הרצאות, שעות, סטטוסים, עלות מצטברת' },
  { key: 'yoy',        title: 'השוואה בין שנים', desc: 'סה״כ סטודנטים, מעסיקים, הרצאות, ואחוז השמה לכל שנה אקדמית' },
];

export default function ReportsPage({ data, context }: PageProps) {
  const [active, setActive] = useState<ReportKey>('students');

  const courses = data.courses || [];
  const students = (data.students || []).filter(s => sameContext(s, context, courses));
  const candidates = (data.candidates || []).filter(c => sameContext(c, context, courses));
  const lectures = (data.lectures || []).filter(l => sameContext(l, context, courses));
  // Employers use courseIds[] — custom filter with name-aware matching
  const employers = (data.employers || []).filter(e => {
    const ids: string[] = e.courseIds?.length ? e.courseIds : (e.courseId ? [e.courseId] : []);
    if (context.courseId !== '__all__') {
      const allowedIds = new Set(
        courses.filter(c => c.name === context.courseId || c.id === context.courseId).map(c => c.id)
      );
      if (!ids.some(id => allowedIds.has(id))) return false;
    }
    if (context.year !== '__all__') {
      const matches = ids.some(cid => {
        const course = courses.find(c => c.id === cid);
        return course && normalizeYear(course.year) === normalizeYear(context.year);
      });
      if (!matches) return false;
    }
    return true;
  });

  const allYears = useMemo(() => {
    const s = new Set<string>();
    (data.students || []).forEach(x => x.year && s.add(normalizeYear(x.year)));
    (data.employers || []).forEach(x => x.year && s.add(normalizeYear(x.year)));
    (data.lectures || []).forEach(x => x.year && s.add(normalizeYear(x.year)));
    return Array.from(s).sort();
  }, [data]);

  const courseLabel = (id?: string) => courses.find(c => c.id === id)?.name || '—';

  // Build report rows
  const report = useMemo(() => {
    switch (active) {
      case 'students': return {
        headers: ['שם', 'סטטוס', 'שובץ ב', 'בחירה 1', 'בחירה 2', 'נקלט', 'הכנה', 'שעות מאושרות', 'טלפון', 'מייל', 'עיר', 'קורס', 'שנה', 'חוו״ד ארגון', 'הערות'],
        rows: students.map(s => {
          const status =
            s.hired ? '✅ נקלט לעבודה' :
            s.acceptedOrg ? '✓ שובץ בארגון' :
            s.firstChoiceResult === 'failed' && s.secondChoiceOrg ? '↺ בבחירה שנייה' :
            s.preparation?.passed ? '⏳ בחיפוש ארגון' :
            s.fromCandidate ? '📚 ממתין/ה להכנה' :
            '— פעיל/ה';
          return [
            s.name || '',
            status,
            s.acceptedOrg || '',
            s.firstChoiceOrg ? `${s.firstChoiceOrg}${s.firstChoiceResult === 'passed' ? ' ✓' : s.firstChoiceResult === 'failed' ? ' ✗' : ''}` : '',
            s.secondChoiceOrg ? `${s.secondChoiceOrg}${s.secondChoiceResult === 'passed' ? ' ✓' : s.secondChoiceResult === 'failed' ? ' ✗' : ''}` : '',
            s.hired ? '✓' : '',
            s.preparation?.passed ? `✓ עבר/ה${s.preparation.date ? ' · ' + new Date(s.preparation.date).toLocaleDateString('he-IL') : ''}` : '—',
            String(s.hoursApproved || 0),
            s.phone || '',
            s.email || '',
            s.city || '',
            courseLabel(s.courseId),
            normalizeYear(s.year || ''),
            s.feedbackText ? '✓' : '',
            s.notes || '',
          ];
        }),
      };
      case 'candidates': return {
        headers: ['שם', 'תאריך הגשה', 'תאריך ראיון', 'תוצאה', 'ציון', 'תחום מבוקש', 'מחויבות', 'מוטיבציה', 'תקשורת', 'אנגלית', 'הכרות', 'סיבת דחייה', 'טלפון', 'מייל', 'עיר', 'קורס', 'שנה', 'סיכום ראיון'],
        rows: candidates.map(c => [
          c.name || '',
          c.applicationDate ? new Date(c.applicationDate).toLocaleDateString('he-IL') : '',
          c.interviewDate ? new Date(c.interviewDate).toLocaleDateString('he-IL') : 'לא נקבע',
          c.interviewResult === 'passed' ? '✓ עבר/ה' : c.interviewResult === 'failed' ? '✗ לא התקבל' : 'ממתין',
          c.evalScore != null ? String(c.evalScore) : '',
          c.preferredArea || '',
          c.evalCommitment || '',
          c.evalMotivation || '',
          c.evalCommunication || '',
          c.evalEnglish || '',
          c.evalAcquaintance || '',
          c.rejectionReason || '',
          c.phone || '',
          c.email || '',
          c.city || '',
          courseLabel(c.courseId),
          normalizeYear(c.year || ''),
          c.interviewSummary || '',
        ]),
      };
      case 'employers': return {
        headers: ['ארגון', 'איש קשר', 'טלפון', 'מייל', 'מיקום', 'משרות', 'מאוישות', 'פתוחות'],
        rows: employers.map(e => {
          const total = Number(e.positions) || 0;
          const filled = Number(e.filledPositions) || 0;
          return [
            e.name, e.contactPerson || '', e.contactPhone || '', e.contactEmail || '',
            e.location || '', String(total), String(filled), String(Math.max(0, total - filled)),
          ];
        }),
      };
      case 'placement': {
        // Group by course
        const byCourse: Record<string, { total: number; placed: number; hired: number }> = {};
        students.forEach(s => {
          const k = courseLabel(s.courseId);
          byCourse[k] ||= { total: 0, placed: 0, hired: 0 };
          byCourse[k].total++;
          if (s.acceptedOrg) byCourse[k].placed++;
          if (s.hired) byCourse[k].hired++;
        });
        return {
          headers: ['קורס', 'סטודנטים', 'שובצו', 'נקלטו', 'שיעור השמה'],
          rows: Object.entries(byCourse).map(([course, v]) => [
            course,
            String(v.total),
            String(v.placed),
            String(v.hired),
            v.total > 0 ? `${Math.round((v.placed / v.total) * 100)}%` : '—',
          ]),
        };
      }
      case 'lecturers': {
        const by: Record<string, { name: string; count: number; approved: number; pending: number; cancelled: number; totalCost: number; email: string; phone: string }> = {};
        lectures.forEach(l => {
          const k = l.lecturer || '—';
          by[k] ||= { name: k, count: 0, approved: 0, pending: 0, cancelled: 0, totalCost: 0, email: l.lecturerEmail || '', phone: l.lecturerPhone || '' };
          by[k].count++;
          if (l.status === 'מאושר') by[k].approved++;
          if (l.status === 'ממתין לאישור') by[k].pending++;
          if (l.status === 'בוטל') by[k].cancelled++;
          by[k].totalCost += Number(l.cost) || 0;
          if (l.lecturerEmail) by[k].email = l.lecturerEmail;
          if (l.lecturerPhone) by[k].phone = l.lecturerPhone;
        });
        return {
          headers: ['מרצה', 'הרצאות', 'מאושרות', 'ממתינות', 'בוטלו', 'עלות מצטברת', 'מייל', 'טלפון'],
          rows: Object.values(by)
            .sort((a, b) => b.count - a.count)
            .map(r => [r.name, String(r.count), String(r.approved), String(r.pending), String(r.cancelled), '₪' + r.totalCost.toLocaleString('he-IL'), r.email, r.phone]),
        };
      }
      case 'yoy': {
        const allS = data.students || [];
        const allE = data.employers || [];
        const allL = data.lectures || [];
        return {
          headers: ['שנה', 'סטודנטים', 'שובצו', 'נקלטו', 'שיעור השמה', 'מעסיקים', 'הרצאות'],
          rows: allYears.map(y => {
            const ny = normalizeYear(y);
            const s = allS.filter(x => normalizeYear(x.year || '') === ny);
            const e = allE.filter(x => normalizeYear(x.year || '') === ny);
            const l = allL.filter(x => normalizeYear(x.year || '') === ny);
            const placed = s.filter(x => x.acceptedOrg).length;
            const hired = s.filter(x => x.hired).length;
            return [
              y,
              String(s.length),
              String(placed),
              String(hired),
              s.length > 0 ? `${Math.round((placed / s.length) * 100)}%` : '—',
              String(e.length),
              String(l.length),
            ];
          }),
        };
      }
    }
  }, [active, students, candidates, employers, lectures, allYears, courses, data]);

  // Drop columns that are empty across all rows — keeps the report tight
  const compactReport = useMemo(() => {
    if (!report || report.rows.length === 0) return report;
    const keep = report.headers.map((_, colIdx) =>
      report.rows.some(row => {
        const v = row[colIdx];
        return v != null && String(v).trim() !== '' && v !== '—';
      })
    );
    return {
      headers: report.headers.filter((_, i) => keep[i]),
      rows: report.rows.map(r => r.filter((_, i) => keep[i])),
    };
  }, [report]);

  function downloadCsv() {
    const { headers, rows } = compactReport;
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    // Prepend BOM so Excel opens Hebrew correctly
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    window.print();
  }

  return (
    <main className="max-w-[1200px] mx-auto px-10 pt-14 pb-28">

      <section className="pt-4 pb-12 border-b mb-10 print:hidden" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">VIII · דוחות</div>
        <h1 className="serif text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>דוחות</h1>
        <p className="text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
          חמישה דוחות מוכנים להדפסה או ייצוא לאקסל. מסוננים לפי ההקשר שבחרת בבר העליון.
        </p>
      </section>

      {/* Report selector */}
      <section className="mb-8 flex flex-wrap gap-2 print:hidden">
        {REPORTS.map(r => {
          const isActive = r.key === active;
          return (
            <button
              key={r.key}
              onClick={() => setActive(r.key)}
              className="mono text-[12px] uppercase tracking-[0.14em] font-semibold px-4 py-1.5 rounded-full border transition-colors"
              style={{
                color: isActive ? 'var(--bg)' : 'var(--accent)',
                background: isActive ? 'var(--accent)' : 'transparent',
                borderColor: 'var(--accent)',
              }}
            >
              {r.title}
            </button>
          );
        })}
      </section>

      <section className="mb-6 print:hidden">
        <p className="text-[14px]" style={{ color: 'var(--text-soft)' }}>
          {REPORTS.find(r => r.key === active)?.desc}
        </p>
        <div className="flex gap-3 mt-5">
          <button onClick={downloadCsv} className="btn">📊 הורד כאקסל (CSV)</button>
          <button onClick={printReport} className="btn">🖨 הדפס / PDF</button>
          <span className="mr-auto mono text-[12px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>
            {compactReport.rows.length} שורות · {compactReport.headers.length} עמודות
          </span>
        </div>
      </section>

      {/* Report table */}
      <section>
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
          <table className="w-full text-[14px]" dir="rtl">
            <thead>
              <tr style={{ background: 'rgba(122,30,43,0.06)' }}>
                {compactReport.headers.map((h, i) => (
                  <th key={i} className="mono text-[11.5px] uppercase tracking-[0.12em] font-semibold text-right px-4 py-3 whitespace-nowrap"
                    style={{ color: 'var(--ink)', borderBottom: '1px solid var(--divider)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compactReport.rows.length === 0 ? (
                <tr>
                  <td colSpan={compactReport.headers.length} className="py-12 text-center" style={{ color: 'var(--text-soft)' }}>
                    אין נתונים בהקשר הנוכחי
                  </td>
                </tr>
              ) : compactReport.rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--divider)' }}>
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-3 align-top" style={{ color: 'var(--ink)' }}>
                      {cell || <span style={{ color: 'var(--text-soft)' }}>—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </main>
  );
}
