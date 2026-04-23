-- ============================================================
-- Practicum v2 — Public candidate registration setup
-- Run this ONCE in Supabase SQL editor.
-- ============================================================

-- 1. Submissions table (public insert, auth-only read)
CREATE TABLE IF NOT EXISTS candidate_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  city TEXT,
  course_name TEXT,
  year TEXT,
  cv_file_path TEXT,
  application_file_path TEXT,
  notes TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  candidate_id UUID     -- filled when admin accepts submission
);

ALTER TABLE candidate_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert" ON candidate_submissions;
CREATE POLICY "public_insert" ON candidate_submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth_select" ON candidate_submissions;
CREATE POLICY "auth_select" ON candidate_submissions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth_update" ON candidate_submissions;
CREATE POLICY "auth_update" ON candidate_submissions
  FOR UPDATE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth_delete" ON candidate_submissions;
CREATE POLICY "auth_delete" ON candidate_submissions
  FOR DELETE TO authenticated
  USING (true);

-- 2. Storage bucket for CV/application uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('candidate-uploads', 'candidate-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Anyone (including unauthenticated visitors) can upload to this bucket
DROP POLICY IF EXISTS "public_can_upload" ON storage.objects;
CREATE POLICY "public_can_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'candidate-uploads');

-- Only authenticated users (Yariv/Rachel) can read
DROP POLICY IF EXISTS "auth_can_download" ON storage.objects;
CREATE POLICY "auth_can_download" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'candidate-uploads');

-- Authenticated admins can delete uploaded files (when deleting submissions)
DROP POLICY IF EXISTS "auth_can_delete_files" ON storage.objects;
CREATE POLICY "auth_can_delete_files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'candidate-uploads');

-- Done. The public registration page can now:
--   - INSERT to candidate_submissions (anonymously)
--   - UPLOAD files to candidate-uploads bucket (anonymously)
-- And the admin app can:
--   - SELECT submissions to review them
--   - SELECT files via signed URLs to show uploaded documents
