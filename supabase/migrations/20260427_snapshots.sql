-- Run this once in Supabase Dashboard → SQL Editor
create table if not exists public.practicum_snapshots (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now() not null,
  editor_name text,
  action text,
  entity text,
  target text,
  version integer default 0,
  data jsonb not null
);
alter table public.practicum_snapshots enable row level security;
create policy "auth users can manage snapshots"
  on public.practicum_snapshots for all
  to authenticated using (true) with check (true);
