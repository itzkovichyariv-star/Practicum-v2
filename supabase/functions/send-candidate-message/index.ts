// Supabase Edge Function — send a custom message to a candidate via the official
// practicum address (practicum@yarivitzkovich.org), so admin notices (e.g. an
// interview reschedule) go out as a real SYSTEM email rather than a personal one.
//
// SECURITY: service-role ONLY. The caller must present the project's
// SUPABASE_SERVICE_ROLE_KEY as the bearer token; the anon/publishable keys are
// rejected. This prevents the endpoint from being used as an open email relay.
//
// Deploy: supabase functions deploy send-candidate-message
// Secrets: RESEND_API_KEY (already set for the project)
//
// Body: { to: string|string[], cc?: string|string[], subject: string, html: string }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Authorize: bearer must be the service-role key (not anon/publishable).
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!serviceKey || bearer !== serviceKey) return json({ error: 'forbidden — service role required' }, 403);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'RESEND_API_KEY not set' }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const { to, cc, subject, html } = body || {};
  if (!to || !subject || !html) return json({ error: 'to, subject and html are required' }, 400);

  const payload: any = {
    from: 'practicum@yarivitzkovich.org',
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (cc) payload.cc = Array.isArray(cc) ? cc : [cc];

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await r.json().catch(() => ({}));
  return json({ ok: r.ok, result }, r.ok ? 200 : 502);
});
