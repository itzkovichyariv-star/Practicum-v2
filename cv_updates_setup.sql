CREATE TABLE IF NOT EXISTS cv_updates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  name         text,
  cv_file_path text NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  seen_at      timestamptz
);

ALTER TABLE cv_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon insert cv_updates" ON cv_updates;
CREATE POLICY "anon insert cv_updates" ON cv_updates
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon select cv_updates" ON cv_updates;
CREATE POLICY "anon select cv_updates" ON cv_updates
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "auth select cv_updates" ON cv_updates;
CREATE POLICY "auth select cv_updates" ON cv_updates
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth update cv_updates" ON cv_updates;
CREATE POLICY "auth update cv_updates" ON cv_updates
  FOR UPDATE TO authenticated USING (true);
