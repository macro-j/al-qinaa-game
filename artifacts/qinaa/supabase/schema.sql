-- ============================================================================
-- قناع (Qinaa) — Supabase schema for auth-backed entitlements
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- ============================================================================

-- 1) Entitlements table -------------------------------------------------------
-- One row per authenticated user. The client may READ its own row, and may
-- INSERT its own initial (all-false / zero) row, but must NEVER be allowed to
-- write the paid flags directly — those are granted only by a trusted server
-- path (payment webhook) using the service-role key, which bypasses RLS.
create table if not exists public.user_entitlements (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  games_played   integer not null default 0,
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
  using (auth.uid() = user_id);

-- Insert own row, but only in the safe default state (no self-granting).
drop policy if exists "insert own entitlements" on public.user_entitlements;
create policy "insert own entitlements"
  on public.user_entitlements
  for insert
  with check (
    auth.uid() = user_id
    and games_played = 0
    and has_base_game = false
    and has_all_access = false
  );

-- NOTE: deliberately NO client UPDATE policy.
-- games_played is bumped via the SECURITY DEFINER RPC below; paid flags are set
-- server-side with the service-role key after a verified payment.

-- 3) Counter RPC --------------------------------------------------------------
-- SECURITY DEFINER so it can update the row despite there being no client
-- UPDATE policy. It is hard-scoped to the caller's own uid.
create or replace function public.increment_games_played()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_entitlements (user_id, games_played)
  values (auth.uid(), 1)
  on conflict (user_id)
  do update set games_played = public.user_entitlements.games_played + 1,
                updated_at   = now();
end;
$$;

revoke all on function public.increment_games_played() from public;
grant execute on function public.increment_games_played() to authenticated;
