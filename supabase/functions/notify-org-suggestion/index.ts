// Supabase Edge Function — Candidate Organization Suggestion Alert
// Fired from the /cv-update (stage-2) form when a candidate proposes their own
// organization. Emails the coordinator + supervisor the full HR-rep details so
// they can review and approve (the suggestion is also saved in cv_updates).
//
// Deploy: supabase functions deploy notify-org-suggestion
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
    const { record } = await req.json();
    if (!record?.suggestedOrg) {
      return new Response(JSON.stringify({ ok: false, error: 'no suggestedOrg' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      console.warn('RESEND_API_KEY not set');
      return new Response(JSON.stringify({ ok: true, sent: false, reason: 'no key' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Load coordinator + supervisor emails from practicum_data
    const { data: row } = await supabase.from('practicum_data').select('data').eq('org_id', 'default').single();
    const d = (row?.data || {}) as any;
    const coordEmail: string      = d.coordinatorEmail || '';
    const supervisorEmail: string = d.supervisorEmail || 'itzkovichyariv@gmail.com';
    const adminRecipients = [coordEmail, supervisorEmail].filter(Boolean);
    if (adminRecipients.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: false, reason: 'no recipients' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const candidateName: string  = record.candidateName || 'מועמד/ת';
    const candidateEmail: string = record.candidateEmail || '—';
    const o = record.suggestedOrg as Record<string, string>;
    const submittedAt = new Date().toLocaleString('he-IL');

    function detailRow(label: string, value?: string) {
      if (!value) return '';
      return `<tr><td style="padding:5px 12px 5px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.08em">${label}</td><td style="font-size:14px">${value}</td></tr>`;
    }

    const adminHtml = `
      <!DOCTYPE html><html dir="rtl" lang="he">
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#3d0f14;background:#f4efe6;direction:rtl">
        <div style="border-bottom:2px solid #7a1e2b;padding-bottom:14px;margin-bottom:20px">
          <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7a1e2b;margin-bottom:5px">פרקטיקום · הצעת ארגון — דרוש אישור</div>
          <h1 style="font-family:Georgia,serif;font-size:24px;margin:0;color:#3d0f14">${candidateName} הציע/ה ארגון</h1>
          <div style="font-size:12px;color:#888;margin-top:4px">${submittedAt}</div>
        </div>
        <p style="font-size:14px;line-height:1.6">
          מועמד/ת מהשלב השני הציע/ה ארגון מטעמו/ה. ההצעה פרטית למועמד/ת זה/זו וכפופה לאישורך.
          אם תאושר — הארגון יהפוך לבחירה הראשונה שלו/ה.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
          ${detailRow('מועמד/ת', candidateName)}
          ${detailRow('מייל המועמד/ת', candidateEmail)}
          <tr><td colspan="2" style="padding-top:10px"></td></tr>
          ${detailRow('שם הארגון', o.name)}
          ${detailRow('איש/אשת קשר', o.contactName)}
          ${detailRow('תפקיד', o.contactRole)}
          ${detailRow('אימייל', o.email)}
          ${detailRow('טלפון', o.phone)}
          ${detailRow('מיקום', o.location)}
        </table>
        ${o.notes ? `<div style="background:#fff;border-radius:8px;padding:12px 14px;font-size:13px;border:1px solid #e8e0d5"><div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px">פרטים / הקשר</div>${o.notes}</div>` : ''}
        <div style="margin-top:22px;font-size:13px;color:#666;line-height:1.6">
          לאישור ההצעה: היכנס/י למערכת → כרטיס הסטודנט/ית → סעיף "CV מעודכן ממתין" → אשר/דחה את ההצעה.
        </div>
        <div style="margin-top:20px;padding-top:14px;border-top:1px solid #ddd;font-size:11px;color:#aaa;letter-spacing:.1em;text-transform:uppercase">
          פרקטיקום · אוניברסיטת אריאל · נשלח אוטומטית
        </div>
      </body></html>
    `;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'practicum@yarivitzkovich.org',
        to: adminRecipients,
        subject: `הצעת ארגון מ${candidateName} — דרוש אישור`,
        html: adminHtml,
      }),
    });
    const result = await r.json();

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
