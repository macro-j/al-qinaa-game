-- ============================================================================
-- قناع (Qinaa) — Supabase schema for auth-backed entitlements
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

-- 1) Entitlements table -------------------------------------------------------
-- One row per authenticated user. `id` IS the auth user's uuid (it references
-- auth.users.id directly), so the row key and the user key are the same value.
-- The client may READ its own row and INSERT its own initial (all-false / zero)
-- row, but must NEVER write directly: the counter is bumped only via the
-- SECURITY DEFINER RPC below, and the paid flags (has_base_game / has_all_access)
-- are granted only by a trusted server path (payment webhook) using the
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

-- Deliberately NO client UPDATE policy. The counter is bumped via the
-- SECURITY DEFINER RPC below; paid flags are set server-side with the
-- service-role key after a verified payment. Defense-in-depth: also strip any
-- direct UPDATE privilege from the client role.
drop policy if exists "update own entitlements" on public.user_entitlements;
revoke update on public.user_entitlements from authenticated;

-- 3) Counter RPC --------------------------------------------------------------
-- SECURITY DEFINER so it can write the row despite there being no client UPDATE
-- policy/privilege. Hard-scoped to the caller's own uid (= the `id` column).
create or replace function public.increment_games_played()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_entitlements (id, games_played)
  values (auth.uid(), 1)
  on conflict (id)
  do update set games_played = public.user_entitlements.games_played + 1,
                updated_at   = now();
end;
$$;

revoke all on function public.increment_games_played() from public;
grant execute on function public.increment_games_played() to authenticated;
