-- The master's-practicum link (/ma): where the student IS, when the answer is not an
-- organization's name.
-- Run once in the Supabase SQL editor, BEFORE sending the link to students.
--
-- Yariv 2026-10-07: "אפשרות לסטודנט לכתוב הערה בסגנון אני בקשר עם ארגון ועדיין זה לא סופי …
-- אין לי ארגון (אבל אז שיגיד מדוע לא בחר בפסגות) … ומקום לסטטוס כללי שלא מוגבל לאחת מאלה".
--
-- Until now the form had two answers — a listed organization, or a full proposal — so a
-- student mid-conversation with a company had to invent one or abandon the form, and the
-- coordinator learned nothing either way.
--
--   org_status   : 'pending' — in touch with an organization, nothing settled yet
--                  'none'    — no organization, and the note says why not the listed one
--                  NULL      — the student picked or proposed an organization, as before,
--                              and every row written by the BA form
--   contact_permission : 'now'   — he may approach the organization today
--                        'later' — still being settled; the student will come back and
--                                  release him with one click
--                        NULL    — no organization of the student's own on this row
--
--   There was a third value, 'wait', carrying a date. Yariv struck it 2026-10-07:
--   "לא צריך תאריך שיוגדר זה במילא לא ראלי" — a date a student guesses at is a date
--   nobody honours, and it only invited him to diarise a fiction.
--   student_note : one readable Hebrew line composed by the form (orgStatusLine) —
--                  the status, the organization named if any, the reason, and whatever
--                  the student wrote in the open box. Free text BY DESIGN: the open box
--                  exists precisely for what the options above cannot anticipate.
--
-- Safe to run more than once. Nothing here touches existing rows or the BA flow.
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS org_status         text;
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS student_note       text;
ALTER TABLE cv_updates ADD COLUMN IF NOT EXISTS contact_permission text;

-- A typo in the app must not become a third state nobody handles.
ALTER TABLE cv_updates DROP CONSTRAINT IF EXISTS cv_updates_org_status_check;
ALTER TABLE cv_updates ADD  CONSTRAINT cv_updates_org_status_check
  CHECK (org_status IS NULL OR org_status IN ('pending', 'none'));

ALTER TABLE cv_updates DROP CONSTRAINT IF EXISTS cv_updates_contact_permission_check;
ALTER TABLE cv_updates ADD  CONSTRAINT cv_updates_contact_permission_check
  CHECK (contact_permission IS NULL OR contact_permission IN ('now', 'later'));

-- Verify (expect three rows):
--   select column_name, data_type from information_schema.columns
--   where table_name = 'cv_updates'
--     and column_name in ('org_status', 'student_note', 'contact_permission');
--
-- Whom may I approach today?
--   select name, email, suggested_org->>'name' as org, contact_permission, student_note
--   from cv_updates where contact_permission = 'now' order by uploaded_at desc;
