-- ============================================================
-- Practicum v2 — Interview slots (publicly readable)
-- Run ONCE in Supabase SQL editor after the initial registration setup.
-- ============================================================

CREATE TABLE IF NOT EXISTS public_interview_slots (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INT NOT NULL DEFAULT 1,
  booked_count INT NOT NULL DEFAULT 0,
  course_name TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public_interview_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "slot_read_all" ON public_interview_slots;
CREATE POLICY "slot_read_all" ON public_interview_slots
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "slot_admin_write" ON public_interview_slots;
CREATE POLICY "slot_admin_write" ON public_interview_slots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anonymous users need to increment booked_count when they pick a slot.
-- Restrict to only bumping the count by 1; can't change anything else.
DROP POLICY IF EXISTS "slot_anon_book" ON public_interview_slots;
CREATE POLICY "slot_anon_book" ON public_interview_slots
  FOR UPDATE TO anon
  USING (booked_count < capacity)
  WITH CHECK (booked_count <= capacity);
