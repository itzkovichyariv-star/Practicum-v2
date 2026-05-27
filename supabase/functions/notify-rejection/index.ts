// Supabase Edge Function — Candidate / Student Rejection Notification
// Sends a respectful rejection email in Hebrew.
//
// Deploy: supabase functions deploy notify-rejection
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { person } = await req.json(); // { name, email }
    if (!person?.email) {
      return new Response(JSON.stringify({ ok: false, error: 'no email' }), {
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

    const name: string = person.name || 'מועמד/ת';
    const firstName = name.split(' ')[0] || name;

    const html = `
      <!DOCTYPE html><html dir="rtl" lang="he">
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#3d0f14;background:#f4efe6;direction:rtl">

        <div style="border-bottom:2px solid #7a1e2b;padding-bottom:14px;margin-bottom:24px">
          <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7a1e2b;margin-bottom:5px">
            פרקטיקום · אוניברסיטת אריאל
          </div>
          <h1 style="font-family:Georgia,serif;font-size:26px;margin:0;color:#3d0f14">
            שלום ${firstName}
          </h1>
        </div>

        <p style="font-size:15.5px;line-height:1.75">
          תודה על עניינך בתוכנית הפרקטיקום בניהול משאבי אנוש ועל השתתפותך בתהליך הקבלה.
        </p>

        <p style="font-size:15.5px;line-height:1.75">
          לאחר שקילת כל המועמדים, ולצערנו, <strong>לא נוכל לאשר את קבלתך לתוכנית בשלב זה.</strong>
        </p>

        <p style="font-size:15px;line-height:1.75;color:#555">
          ההחלטה אינה מעידה בהכרח על כישוריך, אלא על מגבלות הקיבולת ומאפייני הקבוצה של השנה הנוכחית.
          אנחנו מעריכים את המאמץ שהשקעת בתהליך ומאחלים לך הצלחה בהמשך הדרך.
        </p>

        <div style="margin:28px 0;padding:18px 20px;border-radius:8px;background:rgba(122,30,43,0.06);border:1px solid rgba(122,30,43,0.15)">
          <p style="margin:0;font-size:14px;line-height:1.7;color:#3d0f14">
            אם יש לך שאלות נוספות, אנא פנה/י אלינו בתשובה למייל זה.
          </p>
        </div>

        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:13.5px;color:#555;line-height:1.6">
          בברכה,<br>
          <strong>רחל שליו</strong><br>
          רכזת אקדמיה משלבת התנסות אמ״ה · אוניברסיטת אריאל
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
        to: [person.email],
        bcc: [supervisorEmail],
        subject: `עדכון לגבי ראיון הקבלה לפרקטיקום — ${firstName}`,
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
