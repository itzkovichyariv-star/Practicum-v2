-- Stage-2 organization preferences on the /cv-update form.
-- Run once in the Supabase SQL editor.
--
--   org_pref_1/2/3 : up to three ranked choices from the approved org list (org name).
--   suggested_org  : a candidate-proposed organization (private to them, needs admin
--                    approval). JSON shape:
--                    { name, contactName, contactRole, email, phone, location, notes }
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS org_pref_1 text;
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS org_pref_2 text;
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS org_pref_3 text;
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS suggested_org jsonb;
