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
  ageDays: number;
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
    .map((r) => `<li style="margin-bottom:4px"><strong>${esc(r.studentName)}</strong> · ${esc(r.orgName)} · ממתין ${r.ageDays} ימים</li>`)
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

    const toRemind: Rec[] = [];
    const missingEmail: Rec[] = [];

    for (const s of students) {
      const orgName = String(s.acceptedOrg || s.placementInterviewOrg || '').trim();
      if (!orgName) continue;                       // not placed / no org to name → can't identify a mentor
      if (hasEmployerFeedback(s)) continue;         // already has feedback → done
      if (!s.feedbackToken) continue;               // no link was ever generated → no request was made
      const anchor = s.feedbackRequestedAt || s.placedAt; // request time (fallback: placement, for legacy links)
      if (!anchor) continue;                         // can't measure "a week" → skip
      const age = daysSince(anchor, now);
      if (!(age >= REMIND_AFTER_DAYS)) continue;     // less than a week since the request → wait

      const emp = empByName.get(orgName);
      const rec: Rec = {
        studentName: String(s.name || s.id),
        orgName,
        mentorEmail: String(emp?.contactEmail || '').trim(),
        mentorName: String(emp?.contactPerson || '').trim(),
        link: buildFeedbackUrl(String(s.feedbackToken)),
        ageDays: Math.floor(age),
      };
      (rec.mentorEmail ? toRemind : missingEmail).push(rec);
    }

    // CC = Yariv (always) + whatever's in the FEEDBACK_REMINDER_CC secret (Rachel), de-duped.
    const yariv = String(d.supervisorEmail || 'itzkovichyariv@gmail.com').trim();
    const ccList = Array.from(
      new Set([
        yariv,
        ...String(Deno.env.get('FEEDBACK_REMINDER_CC') || '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      ]),
    );

    const counts = { remind: toRemind.length, missing: missingEmail.length };

    if (dry) {
      return json({ ok: true, dryRun: true, counts, cc: ccList, wouldSend: toRemind, missingEmail });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
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
