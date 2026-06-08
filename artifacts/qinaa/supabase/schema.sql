-- ============================================================================
-- قناع (Qinaa) — Supabase schema for auth-backed entitlements
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

-- 1) Entitlements table -------------------------------------------------------
-- One row per authenticated user. `id` IS the auth user's uuid (it references
-- auth.users.id directly), so the row key and the user key are the same value.
-- The client may READ its own row, INSERT its own initial (all-false / zero)
-- row, and UPDATE *only* its own games_played counter (see column grant below).
-- The paid flags (has_base_game / has_all_access) are NOT client-writable —
-- they are granted only by a trusted server path (payment webhook) using the
-- service-role key, which bypasses RLS.
create table if not exists public.user_entitlements (
  id             uuid primary key references auth.users (id) on delete cascade,
  games_played   integer not null default 0 check (games_played >= 0),
  has_base_game  boolean not null default false,
  has_all_access boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.user_entitlements enable row level security;

-- 2) RLS policies -------------------------------------------------------------
-- Read own row.
drop policy if exists "read own entitlements" on public.user_entitlements;
create policy "read own entitlements"
  on public.user_entitlements
  for select
  using (auth.uid() = id);

-- Insert own row, but only in the safe default state (no self-granting).
drop policy if exists "insert own entitlements" on public.user_entitlements;
create policy "insert own entitlements"
  on public.user_entitlements
  for insert
  with check (
    auth.uid() = id
    and games_played = 0
    and has_base_game = false
    and has_all_access = false
  );

-- Update own row. The row-level guard keeps users locked to their own row.
-- Column-level privilege (below) keeps the paid flags off-limits so this
-- direct-update path can never self-grant has_base_game / has_all_access.
drop policy if exists "update own entitlements" on public.user_entitlements;
create policy "update own entitlements"
  on public.user_entitlements
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 3) Column-level privileges --------------------------------------------------
-- Authenticated users may write ONLY games_played. Without games_played in this
-- grant the client update silently affects 0 rows; without restricting the
-- grant to games_played a client could flip the paid flags for free.
revoke update on public.user_entitlements from authenticated;
grant update (games_played) on public.user_entitlements to authenticated;
