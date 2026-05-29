-- Adds organization-preference columns to cv_updates so stage-2 candidates can
-- indicate which organization(s) they'd like, directly on the /cv-update form.
-- Run once in the Supabase SQL editor.
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS org_pref_1 text;
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS org_pref_2 text;
