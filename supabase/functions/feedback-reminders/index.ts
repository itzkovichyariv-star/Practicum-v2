// Supabase Edge Function — Weekly Employer-Feedback Reminders
//
// Sends a gentle weekly reminder to the workplace mentor (חונך) of every PLACED
// student whose employer feedback (משוב מעסיק) is still missing, starting ≥7 days
// after the feedback link was first requested (student.feedbackRequestedAt, with a
// placedAt fallback for links generated before that field existed). Yariv + Rachel
// are CC'd on every reminder as REAL copies. The weekly cron cadence is what makes
// it "repeat every week"; a student drops out automatically the moment their
// feedbackSubmittedAt / feedbackText is set.
//
// Students whose org has NO email on file can't be mailed — those are collected and
// reported to Yariv + Rachel in ONE summary email so nothing falls through the cracks.
//
// DATA-INTEGRITY GUARD: before sending, the function compares the current feedback count
// (and student roster) against the last 25 practicum_snapshots. Feedback is monotonic, so a
// DROP means a bad write clobbered data — in that case it ABORTS the send and emails Yariv +
// Rachel an alert instead of mailing employers on corrupted data (?dry=1 reports without alerting).
//
// Deploy:   supabase functions deploy feedback-reminders
// Schedule: Sundays 05:00 UTC  (= 08:00 Israel summer / 07:00 winter — a fixed-UTC
//           cron drifts 1h with DST, same as nightly-digest). Set via the Supabase
//           dashboard → Edge Functions → Cron (this project schedules there, not in
//           config.toml).
//
// Required secrets (supabase secrets set KEY=value):
//   RESEND_API_KEY          — from resend.com (shared with the other functions)
//   FEEDBACK_REMINDER_CC    — comma-separated CC list, e.g.
//                             "itzkovichyariv@gmail.com,rachel@ariel.ac.il"
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-provided by the platform
//
// Verification modes (safe — never sends):
//   GET/POST ?dry=1  — returns exactly who WOULD be emailed + the missing-email list,
//                      WITHOUT sending anything. Run this against prod before the first
//                      real send to eyeball the selection.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const FEEDBACK_BASE_URL = 'https://practicum.yarivitzkovich.org';
const FROM = 'practicum@yarivitzkovich.org';
const REMIND_AFTER_DAYS = 7;
const SEND_GAP_MS = 550; // stay under Resend's ~2 req/s

// Mirror of hasEmployerFeedback() in StudentsPage.tsx — kept inline because a Deno
// edge function can't import the app's .tsx. If the app predicate changes, change this.
const hasEmployerFeedback = (s: any): boolean =>
  !!s.feedbackSubmittedAt || !!(s.feedbackText && String(s.feedbackText).trim());

const buildFeedbackUrl = (token: string): string =>
  `${FEEDBACK_BASE_URL}/f?t=${encodeURIComponent(token)}`;

function daysSince(iso: string, now: Date): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return NaN;
  return (now.getTime() - t) / 86_400_000;
}

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Rec = {
  studentName: string;
  orgName: string;
  mentorEmail: string;
  mentorName: string;
  link: string;
  ageDays: number | null;   // null = legacy link with no recorded request time (overdue)
};

function mentorEmailHtml(r: Rec): string {
  const greet = r.mentorName ? `שלום ${esc(r.mentorName)},` : 'שלום,';
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"></head>
<body style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:28px;color:#3d0f14;background:#f4efe6;direction:rtl">
  <div style="border-bottom:2px solid #7a1e2b;padding-bottom:14px;margin-bottom:22px">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7a1e2b;margin-bottom:5px">פרקטיקום · אוניברסיטת אריאל</div>
    <h1 style="font-family:Georgia,serif;font-size:24px;margin:0;color:#3d0f14">תזכורת — משוב מעסיק</h1>
  </div>
  <p style="font-size:15px;line-height:1.75;margin:0 0 14px">${greet}</p>
  <p style="font-size:15px;line-height:1.75;margin:0 0 14px">
    הסטודנט/ית <strong>${esc(r.studentName)}</strong> ביצע/ה את הפרקטיקום ב<strong>${esc(r.orgName)}</strong> בהנחייתך. נשמח מאוד לקבל את חוות דעתך.
  </p>
  <p style="font-size:15px;line-height:1.75;margin:0 0 18px">
    המשוב טרם התקבל אצלנו, והוא חשוב להשלמת הערכת הסטודנט/ית. המילוי לוקח רק כמה דקות:
  </p>
  <p style="margin:0 0 20px">
    <a href="${esc(r.link)}" style="display:inline-block;background:#7a1e2b;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 26px;border-radius:999px">מילוי המשוב ›</a>
  </p>
  <p style="font-size:13px;line-height:1.7;margin:0 0 14px;color:#6b5b52">אם כבר מילאת לאחרונה — אפשר להתעלם מההודעה, ותודה על הסבלנות 🙏</p>
  <p style="font-size:13px;line-height:1.7;margin:0 0 4px;color:#3d0f14">אם הכפתור לא נפתח — העתק/י את הקישור והדבק/י בשורת הכתובת בדפדפן:</p>
  <p style="font-size:13px;color:#7a1e2b;margin:2px 0 0;word-break:break-all"><a href="${esc(r.link)}" style="color:#7a1e2b">&#8206;${esc(r.link)}</a></p>
  <div style="margin-top:30px;padding-top:16px;border-top:1px solid #ddd;font-size:13px;line-height:1.7;color:#3d0f14">
    בברכה,<br>צוות הפרקטיקום — משאבי אנוש, אוניברסיטת אריאל<br>יריב ורחל
  </div>
  <div style="margin-top:14px;font-size:11px;color:#aaa;letter-spacing:0.1em;text-transform:uppercase">נשלח אוטומטית · עותק ליריב ולרחל</div>
</body></html>`;
}

function missingSummaryHtml(rows: Rec[], now: Date): string {
  const dateStr = now.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  const items = rows
    .map((r) => `<li style="margin-bottom:4px"><strong>${esc(r.studentName)}</strong> · ${esc(r.orgName)} · ${r.ageDays != null ? `ממתין ${r.ageDays} ימים` : 'ממתין מזה זמן'}</li>`)
    .join('');
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"></head>
<body style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:28px;color:#3d0f14;background:#f4efe6;direction:rtl">
  <div style="border-bottom:2px solid #7a1e2b;padding-bottom:14px;margin-bottom:20px">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7a1e2b;margin-bottom:5px">פרקטיקום · ניהול</div>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:0;color:#3d0f14">משוב מעסיק חסר — אין מייל מנחה</h1>
    <div style="font-size:13px;color:#888;margin-top:4px">${dateStr}</div>
  </div>
  <p style="font-size:14.5px;line-height:1.7;margin:0 0 12px">
    לא נשלחה תזכורת אוטומטית ל‑${rows.length} סטודנטים כי לא מוגדר מייל מנחה/מעסיק בכרטיס הארגון. יש לפנות אליהם ידנית או להוסיף מייל בדף המעסיקים:
  </p>
  <ul style="padding-right:20px;line-height:1.7;font-size:14px">${items}</ul>
  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;font-size:11px;color:#aaa;letter-spacing:0.12em;text-transform:uppercase">
    פרקטיקום · אוניברסיטת אריאל · נשלח אוטומטית
  </div>
</body></html>`;
}

function integrityAlertHtml(reason: string): string {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"></head>
<body style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:28px;color:#3d0f14;background:#fdf0f0;direction:rtl">
  <div style="border-bottom:2px solid #b91c1c;padding-bottom:14px;margin-bottom:20px">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#b91c1c;margin-bottom:5px">פרקטיקום · התראת מערכת</div>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:0;color:#3d0f14">⚠️ תזכורות המשוב לא נשלחו — בעיית תקינות נתונים</h1>
  </div>
  <p style="font-size:15px;line-height:1.75;margin:0 0 14px">
    התזכורת השבועית למעסיקים <strong>לא נשלחה השבוע</strong>, כי בבדיקת תקינות אוטומטית לפני השליחה נמצא סימן לאובדן נתונים:
  </p>
  <p style="font-size:14px;line-height:1.7;margin:0 0 16px;background:#fff;border:1px solid #f0c0c0;border-radius:8px;padding:12px 14px;color:#7a1e2b"><strong>${esc(reason)}</strong></p>
  <p style="font-size:14.5px;line-height:1.7;margin:0 0 12px">
    כדי למנוע שליחת מיילים למעסיקים על סמך נתונים פגומים — השליחה נעצרה. אנא בדוק/י את הנתונים (ושחזר/י מ‑practicum_snapshots אם צריך), ואז אפשר להריץ שוב את הפונקציה ידנית. הריצה הבאה תישלח כרגיל ברגע שהתקינות תשוחזר.
  </p>
  <p style="font-size:14px;line-height:1.7;margin:0 0 16px;background:#fff;border:1px solid #e6d9c8;border-radius:8px;padding:12px 14px">
    <strong>אם הירידה מכוונת</strong> (נמחקו שורות בדיקה או סטודנט/ית שפרש/ה) — אין תקלה, וניתן לשלוח בכל זאת עם הוספת <code style="background:#f4efe6;padding:1px 5px;border-radius:4px">?force=1</code> לכתובת הפונקציה.
  </p>
  <div style="margin-top:26px;padding-top:16px;border-top:1px solid #ddd;font-size:11px;color:#aaa;letter-spacing:0.12em;text-transform:uppercase">פרקטיקום · אוניברסיטת אריאל · נשלח אוטומטית</div>
</body></html>`;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sendResend(key: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  try {
    return await res.json();
  } catch {
    return { status: res.status };
  }
}

Deno.serve(async (req) => {
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  try {
    const { data: row, error } = await supabase
      .from('practicum_data')
      .select('data')
      .eq('org_id', 'default')
      .single();
    if (error || !row) return json({ ok: false, error: error?.message || 'no data' }, 500);

    const d = ((row as any).data || {}) as any;
    const students: any[] = Array.isArray(d.students) ? d.students : [];
    const employers: any[] = Array.isArray(d.employers) ? d.employers : [];
    const now = new Date();

    // Employer email/contact lookup by exact org name (how students link to an org).
    const empByName = new Map<string, any>();
    for (const e of employers) if (e?.name) empByName.set(String(e.name).trim(), e);

    // CC list (built early so the integrity guard below can alert to it), de-duped, from three
    // sources (any/all optional): d.supervisorEmail (Yariv), d.feedbackReminderCc (array/string in
    // the app data — the CLI-free way to add Rachel), and the legacy FEEDBACK_REMINDER_CC env.
    const yariv = String(d.supervisorEmail || 'itzkovichyariv@gmail.com').trim();
    const fromData = Array.isArray(d.feedbackReminderCc)
      ? d.feedbackReminderCc
      : String(d.feedbackReminderCc || '').split(',');
    const ccList = Array.from(new Set([
      yariv,
      ...fromData.map((x: unknown) => String(x).trim()).filter(Boolean),
      ...String(Deno.env.get('FEEDBACK_REMINDER_CC') || '').split(',').map((x) => x.trim()).filter(Boolean),
    ]));
    const resendKey = Deno.env.get('RESEND_API_KEY');

    // ── Data-integrity guard ──────────────────────────────────────────────────────
    // Feedback is MONOTONIC — an employer never un-submits. If a student who is STILL in the
    // roster has LOST their feedback (or the roster collapsed), a bad write likely clobbered
    // data. Never email employers on corrupted data: abort the send and alert Yariv+Rachel so
    // they can recover from practicum_snapshots. A ?dry=1 run reports the abort without alerting;
    // ?force=1 runs anyway (escape hatch — see below).
    //
    // ⚠️ The comparison is INTERSECTED with the CURRENT roster (2026-07-27): a snapshot's
    // feedback only counts if that student id still exists today. Otherwise DELIBERATE deletions
    // (removing test rows, dropping a withdrawn student) look identical to corruption and the
    // guard jams for as long as the tainted snapshots stay in the window — which is exactly what
    // happened when this session's audit-seed students, which carried feedback, were cleaned up:
    // 4 fake feedbacks vanished, curFb 20 < recent max 24, and every weekly send aborted. Real
    // corruption still trips it, because a clobbered student REMAINS in the roster with their
    // feedback missing; a mass roster wipe is caught by the student-count check below.
    const curIds = new Set(students.map((s: any) => String(s?.id)));
    const curFbCount = students.filter(hasEmployerFeedback).length;
    const { data: snaps } = await supabase
      .from('practicum_snapshots').select('data').order('created_at', { ascending: false }).limit(25);
    const snapArr = (snaps || []) as any[];
    const maxFb = Math.max(curFbCount, ...snapArr.map((r) =>
      (r.data?.students || []).filter((s: any) => curIds.has(String(s?.id)) && hasEmployerFeedback(s)).length));
    const maxStu = Math.max(students.length, ...snapArr.map((r) => (r.data?.students || []).length));
    const integrityIssue = curFbCount < maxFb
      ? `feedback count dropped — now ${curFbCount}, recent max ${maxFb} (students still on the roster)`
      : (students.length < Math.floor(maxStu * 0.9)
        ? `student count dropped — now ${students.length}, recent max ${maxStu}`
        : null);
    // ?force=1 — send anyway despite the guard. Needed because the alert tells Yariv to "re-run
    // manually", but a plain re-run re-trips the same guard: without this the only way out was to
    // wait for the tainted snapshots to age out of the 25-row window (days).
    const force = new URL(req.url).searchParams.get('force') === '1';
    if (integrityIssue && force) {
      console.warn(`[feedback-reminders] integrity issue OVERRIDDEN by ?force=1 — ${integrityIssue}`);
    }
    if (integrityIssue && !force) {
      if (!dry && resendKey && ccList.length) {
        await sendResend(resendKey, {
          from: FROM, to: ccList,
          subject: '⚠️ תזכורות משוב לא נשלחו — בעיית תקינות נתונים',
          html: integrityAlertHtml(integrityIssue),
        });
      }
      return json({ ok: false, aborted: true, reason: 'data-integrity', detail: integrityIssue, curFbCount, maxFb, curStudents: students.length, maxStu, alerted: !dry && !!resendKey, override: 'If the drop was intentional (deleted test/withdrawn rows), re-run with ?force=1 to send anyway.' });
    }

    const toRemind: Rec[] = [];
    const missingEmail: Rec[] = [];

    for (const s of students) {
      const orgName = String(s.acceptedOrg || s.placementInterviewOrg || '').trim();
      if (!orgName) continue;                       // not placed / no org to name → can't identify a mentor
      if (hasEmployerFeedback(s)) continue;         // already has feedback → done
      if (!s.feedbackToken) continue;               // no link was ever generated → no request was made
      // Anchor = when the feedback link was first requested (fallback: placement time). If we
      // HAVE an anchor, honour the 7-day grace. If we DON'T — a legacy link that predates the
      // feedbackRequestedAt field, or an anchor that was lost to a stale save — the link was
      // clearly sent long ago, so the student is OVERDUE: remind rather than skip. This keeps
      // reminders robust to a missing/wiped anchor (they hinge on the stable feedbackToken).
      const anchor = s.feedbackRequestedAt || s.placedAt;
      const age = anchor ? daysSince(anchor, now) : NaN;
      if (anchor && !(age >= REMIND_AFTER_DAYS)) continue; // has an anchor but < a week → wait

      const emp = empByName.get(orgName);
      const rec: Rec = {
        studentName: String(s.name || s.id),
        orgName,
        mentorEmail: String(emp?.contactEmail || '').trim(),
        mentorName: String(emp?.contactPerson || '').trim(),
        link: buildFeedbackUrl(String(s.feedbackToken)),
        ageDays: Number.isNaN(age) ? null : Math.floor(age),
      };
      (rec.mentorEmail ? toRemind : missingEmail).push(rec);
    }

    const counts = { remind: toRemind.length, missing: missingEmail.length };

    if (dry) {
      return json({ ok: true, dryRun: true, counts, cc: ccList, wouldSend: toRemind, missingEmail });
    }

    if (!resendKey) return json({ ok: true, sent: false, reason: 'no RESEND_API_KEY', counts });

    const results: any[] = [];
    for (let i = 0; i < toRemind.length; i++) {
      const r = toRemind[i];
      const out = await sendResend(resendKey, {
        from: FROM,
        to: [r.mentorEmail],
        cc: ccList,
        subject: `תזכורת: משוב על הסטודנט/ית ${r.studentName} — פרקטיקום אריאל`,
        html: mentorEmailHtml(r),
      });
      results.push({ student: r.studentName, org: r.orgName, to: r.mentorEmail, id: out?.id, error: out?.error || out?.message });
      if (i < toRemind.length - 1) await new Promise((res) => setTimeout(res, SEND_GAP_MS));
    }

    let summary: any = null;
    if (missingEmail.length) {
      summary = await sendResend(resendKey, {
        from: FROM,
        to: ccList,
        subject: `משוב מעסיק חסר — ${missingEmail.length} סטודנטים ללא מייל מנחה`,
        html: missingSummaryHtml(missingEmail, now),
      });
    }

    return json({ ok: true, sent: true, counts, results, summary });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err) }, 500);
  }
});
