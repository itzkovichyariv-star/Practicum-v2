-- Add questionnaire JSONB column to candidate_submissions
-- Run once in Supabase SQL editor
ALTER TABLE candidate_submissions ADD COLUMN IF NOT EXISTS questionnaire JSONB;
