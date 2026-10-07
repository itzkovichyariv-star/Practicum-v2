-- The master's-practicum link (/ma): who the practicum is done WITH.
-- Run once in the Supabase SQL editor, BEFORE sending the link to students.
--
-- Why these live on cv_updates rather than a new table: the coordinator's whole intake
-- path already reads this table — the student card's "אמץ הגשה" banner, the submission
-- history, the org-suggestion inbox. A separate table would need all of that rebuilt.
--
--   partner_mode  : 'alone' | 'with' | NULL (a row written by the BA form, which does
--                   not ask the question)
--   partner_names : the chosen classmates, as a JSON array of names taken from the
--                   course's own student list — never free text, so two submissions
--                   naming the same pair can actually be matched up.
--                   ["אבי לוי"]  ·  ["אבי לוי","דנה מזרחי"]  ·  []
--
-- Safe to run more than once. Nothing here touches existing rows or the BA flow.
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS partner_mode  text;
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS partner_names jsonb DEFAULT '[]'::jsonb;

-- A typo in the app must not become a third state nobody handles.
ALTER TABLE cv_updates DROP CONSTRAINT IF EXISTS cv_updates_partner_mode_check;
ALTER TABLE cv_updates ADD  CONSTRAINT cv_updates_partner_mode_check
  CHECK (partner_mode IS NULL OR partner_mode IN ('alone', 'with'));

-- Verify (expect two rows: partner_mode / partner_names):
--   select column_name, data_type from information_schema.columns
--   where table_name = 'cv_updates' and column_name like 'partner%';
