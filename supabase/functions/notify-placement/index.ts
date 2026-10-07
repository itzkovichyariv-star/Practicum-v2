// Supabase Edge Function — Student Placement Notification
//
// Two things happen to a student after they submit the practicum form, and the
// form itself promises the student an email for each of them:
//
//   kind: 'placed'       the organization the student asked to be screened for
//                        (פסגות and the like) accepted them, and the coordinator
//                        moved the card to 'שובץ'.
//   kind: 'org-approved' the student proposed their OWN organization and
//                        ד"ר יריב איצקוביץ approved it, so they may start.
//
// Wording is deliberately close to notify-acceptance: the student has already
// had one email in this voice, and this is the next step of the same process.
//
// Deploy: supabase functions deploy notify-placement
// Secrets: RESEND_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { student, orgName, kind } = await req.json();
    if (!student?.email) return json({ ok: false, error: 'no student email' }, 400);
    if (kind !== 'placed' && kind !== 'org-approved') return json({ ok: false, error: 'bad kind' }, 400);

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ ok: true, sent: false, reason: 'no key' });

    const { data: row } = await supabase.from('practicum_data').select('data').eq('org_id', 'default').single();
    const d = (row?.data || {}) as any;
    const supervisorEmail: string = d.supervisorEmail || 'itzkovichyariv@gmail.com';

    const name: string = student.name || 'סטודנט/ית';
    const firstName = name.split(' ')[0] || name;
    const org: string = (orgName || '').toString().trim() || 'הארגון';

    const headline = kind === 'placed'
      ? `שובצת ל${org}`
      : `הארגון שהצעת אושר`;

    const lead = kind === 'placed'
      ? `${org} אישרו את מועמדותך, והשיבוץ שלך לפרקטיקום נרשם במערכת. מכאן הפרקטיקום שלך מתקיים ב${org}.`
      : `ד"ר יריב איצקוביץ בחן את הארגון שהצעת — ${org} — ואישר אותו. מעתה זהו הארגון שבו תבצע/י את הפרקטיקום, ותוכל/י להתחיל.`;

    const nextLine = kind === 'placed'
      ? 'הארגון יצור איתך קשר להמשך התהליך ולתיאום תחילת הפרקטיקום. אם לא תישמע/י מהם בימים הקרובים — אנא עדכן/י אותנו.'
      : 'אנא צור/צרי קשר עם איש/אשת הקשר בארגון לתיאום תחילת הפרקטיקום. לכל שאלה או קושי — נשמח לסייע.';

    const html = `
      <!DOCTYPE html><html dir="rtl" lang="he">
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;color:#3d0f14;background:#f4efe6;direction:rtl">

        <div style="border-bottom:2px solid #7a1e2b;padding-bottom:14px;margin-bottom:24px">
          <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7a1e2b;margin-bottom:5px">
            פרקטיקום · אוניברסיטת אריאל
          </div>
          <h1 style="font-family:Georgia,serif;font-size:26px;margin:0;color:#3d0f14">
            ${firstName}, ${headline}
          </h1>
        </div>

        <p style="font-size:15.5px;line-height:1.7;margin:0 0 14px">${lead}</p>

        <div style="background:#fff;border-radius:8px;padding:16px 18px;margin:14px 0;border:1px solid #e8e0d5">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888;margin-bottom:5px">הארגון</div>
          <div style="font-size:17px;font-weight:600;color:#7a1e2b">${org}</div>
        </div>

        <p style="font-size:14.5px;line-height:1.7;margin:16px 0 0">${nextLine}</p>

        <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;font-size:13.5px;color:#555;line-height:1.6">
          בברכה,<br>
          <strong>צוות הפרקטיקום</strong><br>
          אוניברסיטת אריאל
        </div>

        <div style="margin-top:20px;font-size:11px;color:#aaa;letter-spacing:.1em;text-transform:uppercase">
          פרקטיקום · אוניברסיטת אריאל · נשלח אוטומטית
        </div>
      </body></html>
    `;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'practicum@yarivitzkovich.org',
        to: [student.email],
        cc: [supervisorEmail],
        subject: kind === 'placed' ? `שובצת ל${org} — פרקטיקום` : `הארגון שהצעת (${org}) אושר — אפשר להתחיל`,
        html,
      }),
    });
    const result = await r.json();
    return json({ ok: r.ok, sent: r.ok, result });

  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
