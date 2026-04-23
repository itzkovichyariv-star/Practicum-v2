-- Practicum v2 — Public courses catalog
-- Run ONCE in Supabase SQL editor. Admin writes, anyone reads.

CREATE TABLE IF NOT EXISTS public_courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year TEXT,
  institution TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public_courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "courses_read_all" ON public_courses;
CREATE POLICY "courses_read_all" ON public_courses
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "courses_admin_write" ON public_courses;
CREATE POLICY "courses_admin_write" ON public_courses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
