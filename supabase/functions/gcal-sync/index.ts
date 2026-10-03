// Supabase Edge Function — mirror the practicum calendar into Google Calendar.
//
// Yariv 2026-10-02: "כל שינוי יכנס לגוגל ויעודכן שם". The app computes what Google
// should hold (src/lib/gcalModel.ts → a list of events, each with a stable `key`) and
// posts it here after every save. This function makes ONE dedicated Google calendar equal
// to that list:
//   · a key Google does not have        → insert
//   · a key whose date/title/etc. moved → update   (a moved lecture moves, not duplicates)
//   · a key Google has that the app no longer lists → delete
// Only events this function created are ever touched: each carries the private extended
// property app=practicum, and the reconcile lists by that property. His primary calendar
// and anything he adds by hand are never read or written.
//
// Auth to Google: a service account (no OAuth dance, no expiring refresh token). He
// creates a Google calendar "פרקטיקום", shares it with the service account's e-mail with
// "Make changes to events", and stores two secrets:
//   GCAL_SA_KEY       the service account's JSON key, verbatim
//   GCAL_CALENDAR_ID  the calendar's ID (Google Calendar → settings → "Integrate calendar")
// Without them the function answers { configured: false } and does nothing.
//
// Deploy: supabase functions deploy gcal-sync --no-verify-jwt --project-ref vpqgmcmavnszcnakhiat
//   (--no-verify-jwt: the app calls with the sb_publishable key, which is not a JWT)
// Secrets: supabase secrets set GCAL_CALENDAR_ID=... GCAL_SA_KEY="$(cat key.json)" --project-ref vpqgmcmavnszcnakhiat

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const API = 'https://www.googleapis.com/calendar/v3';
const TAG = 'practicum';
const MAX_EVENTS = 1500;

type When = { date: string } | { dateTime: string; timeZone: string };
interface GEvent {
  key: string; summary: string; description: string; location?: string;
  start: When; end: When; colorId: string;
}

/* ── Google access token from the service account, signed here with WebCrypto ── */
const b64url = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function accessToken(sa: { client_email: string; private_key: string; token_uri?: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar', aud, iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${claim}.${b64url(sig)}`,
    }),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) throw new Error(`token: ${r.status} ${JSON.stringify(t).slice(0, 200)}`);
  return t.access_token;
}

/* ── comparison: only the fields the app owns ── */
const whenKey = (w: any) => (w?.date ? `d:${w.date}` : `t:${String(w?.dateTime || '').slice(0, 16)}`);
const same = (g: any, e: GEvent) =>
  (g.summary || '') === e.summary
  && (g.description || '') === e.description
  && (g.location || '') === (e.location || '')
  && whenKey(g.start) === whenKey(e.start)
  && whenKey(g.end) === whenKey(e.end)
  && String(g.colorId || '') === e.colorId;

const body = (e: GEvent) => ({
  summary: e.summary,
  description: e.description,
  location: e.location || '',
  start: e.start,
  end: e.end,
  colorId: e.colorId,
  extendedProperties: { private: { app: TAG, key: e.key } },
});

const valid = (e: any): e is GEvent =>
  e && typeof e.key === 'string' && e.key.length < 300 && typeof e.summary === 'string'
  && e.start && e.end && (e.start.date || e.start.dateTime) && (e.end.date || e.end.dateTime);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const saRaw = Deno.env.get('GCAL_SA_KEY');
  const calendarId = Deno.env.get('GCAL_CALENDAR_ID');
  if (!saRaw || !calendarId) return json({ ok: true, configured: false });

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }
  const wanted: GEvent[] = Array.isArray(payload?.events) ? payload.events.filter(valid) : [];
  if (!Array.isArray(payload?.events)) return json({ ok: false, error: 'events[] required' }, 400);
  if (wanted.length > MAX_EVENTS) return json({ ok: false, error: `too many events (${wanted.length})` }, 400);
  const dryRun = !!payload?.dryRun;

  try {
    const token = await accessToken(JSON.parse(saRaw));
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const cal = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;

    // Everything this function ever put there — and nothing else.
    const have = new Map<string, any>();
    let pageToken = '';
    do {
      const u = new URL(cal);
      u.searchParams.set('privateExtendedProperty', `app=${TAG}`);
      u.searchParams.set('maxResults', '2500');
      u.searchParams.set('showDeleted', 'false');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const r = await fetch(u, { headers: H });
      const j = await r.json();
      if (!r.ok) throw new Error(`list: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
      for (const ev of j.items || []) {
        const k = ev.extendedProperties?.private?.key;
        if (!k) continue;
        if (have.has(k)) {   // a duplicate from an interrupted run — drop the extra
          if (!dryRun) await fetch(`${cal}/${ev.id}`, { method: 'DELETE', headers: H });
          continue;
        }
        have.set(k, ev);
      }
      pageToken = j.nextPageToken || '';
    } while (pageToken);

    const plan = { created: [] as string[], updated: [] as string[], deleted: [] as string[], unchanged: 0 };
    const seen = new Set<string>();
    for (const e of wanted) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      const g = have.get(e.key);
      if (!g) {
        plan.created.push(e.key);
        if (!dryRun) {
          const r = await fetch(cal, { method: 'POST', headers: H, body: JSON.stringify(body(e)) });
          if (!r.ok) throw new Error(`insert ${e.key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
        }
      } else if (!same(g, e)) {
        plan.updated.push(e.key);
        if (!dryRun) {
          const r = await fetch(`${cal}/${g.id}`, { method: 'PUT', headers: H, body: JSON.stringify(body(e)) });
          if (!r.ok) throw new Error(`update ${e.key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
        }
      } else {
        plan.unchanged++;
      }
    }
    for (const [k, g] of have) {
      if (seen.has(k)) continue;
      plan.deleted.push(k);
      if (!dryRun) {
        const r = await fetch(`${cal}/${g.id}`, { method: 'DELETE', headers: H });
        if (!r.ok && r.status !== 410) throw new Error(`delete ${k}: ${r.status}`);
      }
    }
    return json({
      ok: true, configured: true, dryRun,
      created: plan.created.length, updated: plan.updated.length, deleted: plan.deleted.length,
      unchanged: plan.unchanged, keys: dryRun ? plan : undefined,
    });
  } catch (err: any) {
    return json({ ok: false, configured: true, error: String(err?.message || err) }, 500);
  }
});
