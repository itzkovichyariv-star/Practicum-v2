// Supabase Edge Function — Candidate Acceptance Notification
// Sends acceptance email to candidate with personal CV-update link.
//
// Deploy: supabase functions deploy notify-acceptance
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

const BASE_URL = 'https://practicum.yarivitzkovich.org';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { candidate } = await req.json();
    if (!candidate?.email) {
      return new Response(JSON.stringify({ ok: false, error: 'no candidate email' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      return new Response(JSON.stringify({ ok: true, sent: false, reason: 'no key' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Load coordinator email from practicum_data
    const { data: row } = await supabase.from('practicum_data').select('data').eq('org_id', 'default').single();
    const d = (row?.data || {}) as any;
    const supervisorEmail: string = d.supervisorEmail || 'itzkovichyariv@gmail.com';

    const name: string = candidate.name || 'מועמד/ת';
    const firstName = name.split(' ')[0] || name;
    const cvUpdateLink = `${BASE_URL}/cv-update/?email=${encodeURIComponent(candidate.email)}&name=${encodeURIComponent(name)}`;

    const html = `
      <!DOCTYPE html><html dir="rtl" lang="he">
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#3d0f14;background:#f4efe6;direction:rtl">

        <div style="border-bottom:2px solid #7a1e2b;padding-bottom:14px;margin-bottom:24px">
          <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7a1e2b;margin-bottom:5px">
            פרקטיקום · אוניברסיטת אריאל
          </div>
          <h1 style="font-family:Georgia,serif;font-size:28px;margin:0;color:#3d0f14">
            ברכות, ${firstName}!
          </h1>
        </div>

        <p style="font-size:15.5px;line-height:1.7">
          שמחים לבשר לך שעברת את ראיון הקבלה לפרקטיקום בניהול משאבי אנוש.
          ברוך/ה הבא/ה לתוכנית!
        </p>

        <p style="font-size:15px;line-height:1.65">
          <strong>השלב הבא:</strong> השתתפות בסדנת קורות חיים שתתקיים בהמשך.
          לאחר הסדנה, יש לעדכן את קורות החיים ולהעלות גרסה משופרת דרך הקישור האישי שלהלן:
        </p>

        <div style="margin:24px 0;text-align:center">
          <a href="${cvUpdateLink}"
            style="display:inline-block;background:#7a1e2b;color:#f4efe6;text-decoration:none;
                   padding:14px 28px;border-radius:8px;font-size:15px;font-weight:bold;letter-spacing:0.03em">
            העלאת CV מעודכן ←
          </a>
        </div>

        <div style="background:#fff;border-radius:8px;padding:14px 16px;margin:16px 0;border:1px solid #e8e0d5;font-size:12.5px;color:#666;word-break:break-all">
          ${cvUpdateLink}
        </div>

        <p style="font-size:13.5px;line-height:1.6;color:#666">
          הקישור שמור עבורך ופעיל לאורך כל התוכנית — ניתן להשתמש בו שוב אם תרצה/י לעדכן שוב בהמשך.
        </p>

        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:13.5px;color:#555;line-height:1.6">
          בברכה,<br>
          <strong>רחל שליו</strong><br>
          רכזת פרקטיקום · המחלקה לניהול · אוניברסיטת אריאל
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
        to: [candidate.email],
        bcc: [supervisorEmail],
        subject: `ברכות ${firstName} — התקבלת לפרקטיקום!`,
        html,
      }),
    });

    const result = await r.json();
    return new Response(JSON.stringify({ ok: r.ok, result }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
