// Supabase Edge Function — Candidate Acceptance Notification
// Sends a branded HTML acceptance email to a candidate, with the personal
// CV-update link and the workshop date pulled from the course settings
// (course.workshopDate set in ניהול → קורסים → ערוך → תאריך סדנת הכנה).
//
// Body wording is kept in sync with the client-side template in
// CandidatesPage.tsx (EMAIL_TEMPLATES.acceptance) so both paths render the
// same content. If candidate.courseId is missing or the course has no
// workshopDate, the date line falls back to "⚠️ תאריך טרם נקבע".
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

    // Load practicum_data once — used for coordinator email AND course lookup.
    const { data: row } = await supabase.from('practicum_data').select('data').eq('org_id', 'default').single();
    const d = (row?.data || {}) as any;
    const supervisorEmail: string = d.supervisorEmail || 'itzkovichyariv@gmail.com';
    const courses: any[] = Array.isArray(d.courses) ? d.courses : [];

    const course = candidate.courseId
      ? courses.find((c: any) => c?.id === candidate.courseId)
      : null;
    const workshopDate: string = (course?.workshopDate || '').toString().trim();

    const name: string = candidate.name || 'מועמד/ת';
    const firstName = name.split(' ')[0] || name;
    const cvUpdateLink = `${BASE_URL}/cv-update/?email=${encodeURIComponent(candidate.email)}&name=${encodeURIComponent(name)}`;
    const orgsLink = `${BASE_URL}/organizations`;

    const dateValue = workshopDate || '⚠️ תאריך טרם נקבע';

    const html = `
      <!DOCTYPE html><html dir="rtl" lang="he">
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;color:#3d0f14;background:#f4efe6;direction:rtl">

        <div style="border-bottom:2px solid #7a1e2b;padding-bottom:14px;margin-bottom:24px">
          <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7a1e2b;margin-bottom:5px">
            פרקטיקום · אוניברסיטת אריאל
          </div>
          <h1 style="font-family:Georgia,serif;font-size:28px;margin:0;color:#3d0f14">
            ברכות, ${firstName}!
          </h1>
        </div>

        <p style="font-size:15.5px;line-height:1.7;margin:0 0 14px">
          ברכות חמות! אנו שמחים לבשר כי עברת בהצלחה את ראיון הקבלה לתכנית הפרקטיקום במשאבי אנוש, אוניברסיטת אריאל.
        </p>

        <p style="font-size:15.5px;line-height:1.7;margin:18px 0 8px;font-weight:600">
          📌 השלבים הקרובים:
        </p>

        <div style="background:#fff;border-radius:8px;padding:16px 18px;margin:10px 0;border:1px solid #e8e0d5">
          <p style="font-size:15px;margin:0 0 6px;font-weight:600;color:#7a1e2b">
            1. סדנת הכנה לפרקטיקום
          </p>
          <p style="font-size:14.5px;line-height:1.6;margin:0">
            הסדנה תתקיים בתאריך <strong style="color:#3d0f14">${dateValue}</strong>. פרטים נוספים יישלחו בנפרד.
          </p>
        </div>

        <div style="background:#fff;border-radius:8px;padding:16px 18px;margin:10px 0;border:1px solid #e8e0d5">
          <p style="font-size:15px;margin:0 0 6px;font-weight:600;color:#7a1e2b">
            2. הגשת קורות חיים ובחירת ארגון
          </p>
          <p style="font-size:14.5px;line-height:1.65;margin:0 0 12px">
            לאחר הסדנה אתה/את מתבקש/ת להעלות קורות חיים מעודכנים ולציין את העדפותיך לארגון — הכל דרך הקישור המצורף:
          </p>
          <div style="text-align:center;margin:14px 0 8px">
            <a href="${cvUpdateLink}"
              style="display:inline-block;background:#7a1e2b;color:#f4efe6;text-decoration:none;
                     padding:12px 24px;border-radius:8px;font-size:14.5px;font-weight:bold;letter-spacing:0.03em">
              העלאת CV מעודכן ←
            </a>
          </div>
          <p style="font-size:13.5px;line-height:1.6;margin:14px 0 0;color:#666">
            תהליך השיבוץ יחל רק לאחר הגשת קורות החיים המעודכנים והעדפותיך — אנא הקפד/י לבצע זאת בסמוך לסיום הסדנה.
          </p>
          <p style="font-size:13.5px;line-height:1.6;margin:10px 0 0">
            לצפייה מראש ברשימת הארגונים ותיאוריהם: <a href="${orgsLink}" style="color:#7a1e2b;text-decoration:underline">${orgsLink}</a>
          </p>
          <p style="font-size:13.5px;line-height:1.6;margin:8px 0 0;color:#666">
            לכל ארגון מצורף תיאור המפרט את תחומי פעילותו ואת סוג הניסיון שתצבור/י בו — אנא קרא/י בעיון לפני הבחירה.
          </p>
          <p style="font-size:13.5px;line-height:1.6;margin:8px 0 0;color:#666">
            שים/י לב: מאחר שהארגון עתיד לראיין אותך בהמשך התהליך, ומאחר שישנם מועמדים נוספים, איננו יכולים להבטיח שיבוץ בהתאם להעדפה.
          </p>
        </div>

        <div style="background:#fff;border-radius:8px;padding:16px 18px;margin:10px 0;border:1px solid #e8e0d5">
          <p style="font-size:15px;margin:0 0 6px;font-weight:600;color:#7a1e2b">
            3. הצעת ארגון מטעמך (אופציונלי)
          </p>
          <p style="font-size:14.5px;line-height:1.6;margin:0">
            אם יש ברשותך קשר עם ארגון שבו מנהלת משאבי אנוש המעוניינת לקלוט מתמחה/ת — תוכל/י להוסיף את פרטיו בטופס הקישור לעיל, ומנחה התכנית יבחן את אישורו.
          </p>
        </div>

        <p style="font-size:14.5px;line-height:1.65;margin:18px 0 0">
          לכל שאלה, נשמח לענות.
        </p>

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
        to: [candidate.email],
        bcc: [supervisorEmail],
        subject: `ברכות — התקבלת לתכנית הפרקטיקום`,
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
