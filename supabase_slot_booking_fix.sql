-- ============================================================
-- Fix: allow anonymous candidates to bump booked_count on slot pickup.
-- Run this ONCE in Supabase SQL editor if submissions are booking the
-- same slot repeatedly (RLS was silently blocking the UPDATE).
-- ============================================================

-- Drop existing policies on public_interview_slots
DROP POLICY IF EXISTS "slot_read_all" ON public_interview_slots;
DROP POLICY IF EXISTS "slot_admin_write" ON public_interview_slots;
DROP POLICY IF EXISTS "slot_anon_book" ON public_interview_slots;

-- Everyone can read
CREATE POLICY "slot_read_all" ON public_interview_slots
  FOR SELECT TO anon, authenticated USING (true);

-- Admins (logged in) have full access
CREATE POLICY "slot_admin_write" ON public_interview_slots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anonymous candidates can UPDATE (to bump booked_count) as long as
-- the slot still has capacity. No USING predicate restrictions other
-- than sanity — the WITH CHECK keeps count within bounds.
CREATE POLICY "slot_anon_book" ON public_interview_slots
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (booked_count <= capacity);

-- Sanity check:
-- SELECT * FROM public_interview_slots ORDER BY date, start_time;
