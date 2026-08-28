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

-- Self-heal older databases whose table predates these columns. `create table
-- if not exists` does NOT alter an existing table, so add any missing columns
-- here (the unlock_all_access / increment_games_played RPCs write to updated_at).
alter table public.user_entitlements
  add column if not exists created_at timestamptz not null default now();
alter table public.user_entitlements
  add column if not exists updated_at timestamptz not null default now();
-- Records every specific a-la-carte item the user has purchased (e.g.
-- role_wizard, role_twins, …). The two booleans above remain the gate for the
-- base game / all-access; this array tracks granular add-ons and future items.
alter table public.user_entitlements
  add column if not exists owned_items text[] not null default '{}';

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
    and owned_items = '{}'
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

-- 4) All-Access fulfillment RPC (server-only) ---------------------------------
-- Grants the lifetime All-Access entitlement (which also implies the base game)
-- to a specific user. Called ONLY by the trusted Stripe payment webhook using
-- the service-role key, after Stripe has verified a completed payment.
-- SECURITY DEFINER so it can write despite there being no client UPDATE policy.
-- Execute is granted ONLY to service_role — never to anon/authenticated — so a
-- logged-in client can NEVER self-grant access by calling this directly.
create or replace function public.unlock_all_access(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_entitlements (id, has_all_access, has_base_game)
  values (target_user, true, true)
  on conflict (id)
  do update set has_all_access = true,
                has_base_game  = true,
                updated_at      = now();
end;
$$;

revoke all on function public.unlock_all_access(uuid) from public;
revoke all on function public.unlock_all_access(uuid) from anon, authenticated;
grant execute on function public.unlock_all_access(uuid) to service_role;

-- 5) Per-item fulfillment RPC (server-only) -----------------------------------
-- Grants exactly ONE purchased item, identified by `item_id`, to a specific
-- user. Called ONLY by the trusted Stripe payment webhook / verify route using
-- the service-role key, after Stripe has verified a completed payment.
--   • base_game  → has_base_game
--   • all_access → has_all_access (+ implies base_game)
--   • everything else (role_*) → appended to owned_items
-- Idempotent: re-running for the same item is a no-op, so the webhook and the
-- verify-on-return path can both call it safely. SECURITY DEFINER so it can
-- write despite there being no client UPDATE policy; execute granted ONLY to
-- service_role so a client can never self-grant.
create or replace function public.grant_specific_entitlement(
  target_user uuid,
  item_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_entitlements (id)
  values (target_user)
  on conflict (id) do nothing;

  update public.user_entitlements
     set has_base_game  = has_base_game  or item_id in ('base_game', 'all_access'),
         has_all_access = has_all_access or item_id = 'all_access',
         -- base_game / all_access are tracked via the booleans above; only the
         -- granular add-ons (role_*) are recorded in owned_items.
         owned_items    = case
           when item_id in ('base_game', 'all_access') then owned_items
           else (
             select array(
               select distinct
                 unnest(coalesce(owned_items, '{}') || array[item_id])
             )
           )
         end,
         updated_at     = now()
   where id = target_user;
end;
$$;

revoke all on function public.grant_specific_entitlement(uuid, text) from public;
revoke all on function public.grant_specific_entitlement(uuid, text) from anon, authenticated;
grant execute on function public.grant_specific_entitlement(uuid, text) to service_role;

-- 6) Account-backed role-distribution memory ---------------------------------
-- Keeps the compact, last-80 local distribution ledger in sync across devices.
-- Each authenticated user can read and replace only their own JSON history.
create table if not exists public.role_distribution_history (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  entries    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.role_distribution_history enable row level security;

drop policy if exists "read own role distribution history" on public.role_distribution_history;
create policy "read own role distribution history"
  on public.role_distribution_history
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert own role distribution history" on public.role_distribution_history;
create policy "insert own role distribution history"
  on public.role_distribution_history
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own role distribution history" on public.role_distribution_history;
create policy "update own role distribution history"
  on public.role_distribution_history
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.role_distribution_history to authenticated;
