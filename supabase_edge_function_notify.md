# Email notification setup

When a candidate submits the registration form, send a confirmation email to:
- The candidate (confirmation of submission + interview slot if chosen)
- You (`yarivi@ariel.ac.il`) and Rachel (`rachelshal@ariel.ac.il`) — with CC/summary

This requires **two one-time setups**: Resend (free email provider) + a Supabase Edge Function.

---

## Step 1 — Get a Resend API key (2 minutes)

1. Go to https://resend.com/signup and create a free account (100 emails/day, no credit card)
2. On the dashboard, click **API Keys → Create API Key** → name it `practicum` → **Copy** the key (starts with `re_...`)
3. Keep it in a safe place for Step 2

**Optional (recommended later):** verify a domain — for now, Resend lets you send test emails to any address from `onboarding@resend.dev`.

---

## Step 2 — Create the Supabase Edge Function (5 minutes)

1. Open https://supabase.com/dashboard/project/vpqgmcmavnszcnakhiat/functions
2. Click **"Create a new function"**
3. Name: `notify-submission`
4. Paste the code from `supabase_edge_function_notify.ts` below
5. Click **Deploy function**

### Set the Resend API key as a secret

6. In the function page, find **Secrets** (or go to **Settings → Edge Functions → Secrets**)
7. Add a new secret:
   - Name: `RESEND_API_KEY`
   - Value: the `re_...` key you got from Resend
8. Save

---

## Step 3 — Tell Supabase to call this function on every new submission

Run this SQL once in the SQL editor:

```sql
-- Enable pg_net (HTTP requests from the database)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Function that calls our edge function
CREATE OR REPLACE FUNCTION notify_new_submission()
RETURNS TRIGGER AS $$
DECLARE
  fn_url TEXT := 'https://vpqgmcmavnszcnakhiat.supabase.co/functions/v1/notify-submission';
BEGIN
  PERFORM net.http_post(
    url := fn_url,
    body := jsonb_build_object('record', row_to_json(NEW))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger the function on every new candidate submission
DROP TRIGGER IF EXISTS trg_notify_submission ON candidate_submissions;
CREATE TRIGGER trg_notify_submission
  AFTER INSERT ON candidate_submissions
  FOR EACH ROW EXECUTE FUNCTION notify_new_submission();
```

That's it. From now on, every candidate submission triggers three emails:
- The candidate (confirmation with slot details)
- You + Rachel (alert with a summary + links to download files)

---

## To stop or pause emails later

Run: `DROP TRIGGER trg_notify_submission ON candidate_submissions;`

To restart: re-run the `CREATE TRIGGER` line.
