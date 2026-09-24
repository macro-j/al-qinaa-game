-- ============================================================================
-- قناع (Qinaa) — Supabase schema for auth-backed entitlements
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent.
-- Then apply `council_credits.sql`; it contains the current consumable-credit
-- model and overrides the legacy free-game/payment fulfillment functions.
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

-- 3b) Idempotent per-game counter --------------------------------------------
-- The legacy no-argument RPC above remains temporarily available for older
-- deployed clients. Current clients settle a completed first night with a
-- stable game UUID, making lost responses and retries safe.
alter table public.user_entitlements
  add column if not exists consumed_game_ids uuid[] not null default '{}';

create or replace function public.consume_free_game(target_game_id uuid)
returns table (status text, games_played integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  current_games integer;
  is_paid boolean;
  is_duplicate boolean;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  if target_game_id is null then raise exception 'invalid_game_id'; end if;

  insert into public.user_entitlements (id)
  values (caller_id)
  on conflict (id) do nothing;

  select e.games_played,
         e.has_base_game or e.has_all_access,
         target_game_id = any(e.consumed_game_ids)
    into current_games, is_paid, is_duplicate
    from public.user_entitlements e
   where e.id = caller_id
   for update;

  if is_paid then
    return query select 'paid'::text, current_games;
    return;
  end if;

  if is_duplicate then
    return query select 'already_consumed'::text, current_games;
    return;
  end if;

  if current_games >= 2 then
    return query select 'limit_reached'::text, current_games;
    return;
  end if;

  update public.user_entitlements e
     set games_played = e.games_played + 1,
         consumed_game_ids = array_append(e.consumed_game_ids, target_game_id),
         updated_at = now()
   where e.id = caller_id
   returning e.games_played into current_games;

  return query select 'consumed'::text, current_games;
end;
$$;

revoke all on function public.consume_free_game(uuid) from public, anon;
grant execute on function public.consume_free_game(uuid) to authenticated;

-- 4) All-Access fulfillment RPC (server-only) ---------------------------------
-- Grants the lifetime All-Access entitlement (which also implies the base game)
-- to a specific user. Called ONLY by a trusted server using the service-role
-- key after the payment gateway has verified a completed payment.
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
-- user. Called ONLY by a trusted payment webhook / verify route using the
-- service-role key after the gateway has verified a completed payment.
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

-- 6) Paylink payment intents + atomic fulfillment ----------------------------
-- A standalone copy of this migration also lives in paylink_payments.sql for
-- applying it by itself to an existing project.
create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  item_id               text,
  amount                integer not null check (amount > 0),
  currency              text not null default 'SAR',
  gateway               text not null,
  gateway_order_id      text,
  merchant_order_number text,
  idempotency_key       text,
  environment           text not null default 'production',
  status                text not null default 'creating',
  payment_method        text,
  verified_at           timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.payments add column if not exists item_id text;
alter table public.payments add column if not exists merchant_order_number text;
alter table public.payments add column if not exists idempotency_key text;
alter table public.payments add column if not exists payment_method text;
alter table public.payments add column if not exists verified_at timestamptz;
alter table public.payments add column if not exists completed_at timestamptz;
alter table public.payments alter column gateway_order_id drop not null;

alter table public.payments drop constraint if exists payments_user_id_fkey;
alter table public.payments
  add constraint payments_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade not valid;

create unique index if not exists payments_paylink_order_unique
  on public.payments (merchant_order_number)
  where gateway = 'paylink' and merchant_order_number is not null;
create unique index if not exists payments_gateway_transaction_unique
  on public.payments (gateway, environment, gateway_order_id)
  where gateway_order_id is not null;
create unique index if not exists payments_idempotency_unique
  on public.payments (idempotency_key)
  where idempotency_key is not null;
create index if not exists payments_user_created_idx
  on public.payments (user_id, created_at desc);

alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;

create or replace function public.complete_verified_paylink_payment(
  target_payment uuid,
  expected_transaction_no text,
  expected_amount integer,
  expected_currency text
)
returns table (item_id text, user_id uuid, already_completed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  was_completed boolean;
begin
  select p.* into payment_row
    from public.payments p
   where p.id = target_payment
   for update;

  if not found then raise exception 'payment_not_found'; end if;
  if payment_row.gateway <> 'paylink' then raise exception 'invalid_gateway'; end if;
  if payment_row.gateway_order_id is not null
     and payment_row.gateway_order_id <> expected_transaction_no then
    raise exception 'transaction_mismatch';
  end if;
  if payment_row.amount <> expected_amount then raise exception 'amount_mismatch'; end if;
  if upper(coalesce(payment_row.currency, '')) <> upper(expected_currency) then
    raise exception 'currency_mismatch';
  end if;
  if payment_row.item_id is null or payment_row.item_id not in (
    'base_game', 'all_access', 'role_wizard', 'role_madman',
    'role_avenger', 'role_twins', 'role_sniper'
  ) then
    raise exception 'invalid_item';
  end if;

  was_completed := payment_row.status = 'completed';
  if was_completed then
    return query select payment_row.item_id, payment_row.user_id, true;
    return;
  end if;
  if payment_row.status not in ('creating', 'pending') then
    raise exception 'invalid_payment_status';
  end if;

  insert into public.user_entitlements (id)
  values (payment_row.user_id)
  on conflict (id) do nothing;

  update public.user_entitlements e
     set has_base_game = e.has_base_game
                          or payment_row.item_id in ('base_game', 'all_access'),
         has_all_access = e.has_all_access
                          or payment_row.item_id = 'all_access',
         owned_items = case
           when payment_row.item_id in ('base_game', 'all_access')
             then e.owned_items
           else (
             select array(
               select distinct unnest(
                 coalesce(e.owned_items, '{}') || array[payment_row.item_id]
               )
             )
           )
         end,
         updated_at = now()
   where e.id = payment_row.user_id;

  update public.payments p
     set status = 'completed',
         gateway_order_id = expected_transaction_no,
         verified_at = coalesce(p.verified_at, now()),
         completed_at = coalesce(p.completed_at, now()),
         updated_at = now()
   where p.id = payment_row.id;

  return query select payment_row.item_id, payment_row.user_id, false;
end;
$$;

revoke all on function public.complete_verified_paylink_payment(
  uuid, text, integer, text
) from public, anon, authenticated;
grant execute on function public.complete_verified_paylink_payment(
  uuid, text, integer, text
) to service_role;

-- 7) NalPay fields + signed webhook ledger + atomic fulfillment -------------

alter table public.payments add column if not exists gateway_payment_id text;
alter table public.payments add column if not exists refunded_at timestamptz;

create unique index if not exists payments_gateway_payment_unique
  on public.payments (gateway, environment, gateway_payment_id)
  where gateway_payment_id is not null;

-- Prevent two devices/tabs from opening two payable links for the same item.
create unique index if not exists payments_nalpay_active_purchase_unique
  on public.payments (user_id, item_id, gateway, environment)
  where gateway = 'nalpay' and status in ('creating', 'pending');

create table if not exists public.payment_webhook_deliveries (
  gateway           text not null,
  event_id          text not null,
  event_type        text not null,
  gateway_payment_id text,
  payment_id        uuid references public.payments (id) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (gateway, event_id)
);

create unique index if not exists payment_webhook_semantic_unique
  on public.payment_webhook_deliveries (
    gateway, event_type, gateway_payment_id
  )
  where gateway_payment_id is not null;

alter table public.payment_webhook_deliveries enable row level security;
revoke all on public.payment_webhook_deliveries from anon, authenticated;

create or replace function public.complete_verified_nalpay_payment(
  target_payment uuid,
  expected_link_id text,
  expected_payment_id text,
  expected_amount integer,
  expected_currency text,
  expected_event_id text default null
)
returns table (item_id text, user_id uuid, already_completed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  was_completed boolean;
begin
  select p.* into payment_row
    from public.payments p
   where p.id = target_payment
   for update;

  if not found then raise exception 'payment_not_found'; end if;
  if payment_row.gateway <> 'nalpay' then raise exception 'invalid_gateway'; end if;
  if payment_row.gateway_order_id is null
     or payment_row.gateway_order_id <> expected_link_id then
    raise exception 'payment_link_mismatch';
  end if;
  if payment_row.gateway_payment_id is not null
     and payment_row.gateway_payment_id <> expected_payment_id then
    raise exception 'gateway_payment_mismatch';
  end if;
  if payment_row.amount <> expected_amount then raise exception 'amount_mismatch'; end if;
  if upper(coalesce(payment_row.currency, '')) <> upper(expected_currency) then
    raise exception 'currency_mismatch';
  end if;
  if payment_row.item_id is null or payment_row.item_id not in (
    'base_game', 'all_access', 'role_wizard', 'role_madman',
    'role_avenger', 'role_twins', 'role_sniper'
  ) then
    raise exception 'invalid_item';
  end if;

  if expected_event_id is not null then
    insert into public.payment_webhook_deliveries (
      gateway, event_id, event_type, gateway_payment_id, payment_id
    ) values (
      'nalpay', expected_event_id, 'payment_paid', expected_payment_id,
      payment_row.id
    ) on conflict do nothing;
  end if;

  was_completed := payment_row.status = 'completed';
  if was_completed then
    update public.payments p
       set gateway_payment_id = coalesce(p.gateway_payment_id, expected_payment_id),
           verified_at = coalesce(p.verified_at, now()),
           updated_at = now()
     where p.id = payment_row.id;
    return query select payment_row.item_id, payment_row.user_id, true;
    return;
  end if;
  if payment_row.status not in ('creating', 'pending') then
    raise exception 'invalid_payment_status';
  end if;

  insert into public.user_entitlements (id)
  values (payment_row.user_id)
  on conflict (id) do nothing;

  update public.user_entitlements e
     set has_base_game = e.has_base_game
                          or payment_row.item_id in ('base_game', 'all_access'),
         has_all_access = e.has_all_access
                          or payment_row.item_id = 'all_access',
         owned_items = case
           when payment_row.item_id in ('base_game', 'all_access')
             then e.owned_items
           else (
             select array(
               select distinct unnest(
                 coalesce(e.owned_items, '{}') || array[payment_row.item_id]
               )
             )
           )
         end,
         updated_at = now()
   where e.id = payment_row.user_id;

  update public.payments p
     set status = 'completed',
         gateway_payment_id = expected_payment_id,
         verified_at = coalesce(p.verified_at, now()),
         completed_at = coalesce(p.completed_at, now()),
         refunded_at = null,
         updated_at = now()
   where p.id = payment_row.id;

  return query select payment_row.item_id, payment_row.user_id, false;
end;
$$;

revoke all on function public.complete_verified_nalpay_payment(
  uuid, text, text, integer, text, text
) from public, anon, authenticated;
grant execute on function public.complete_verified_nalpay_payment(
  uuid, text, text, integer, text, text
) to service_role;

create or replace function public.refund_verified_nalpay_payment(
  target_payment uuid,
  expected_link_id text,
  expected_payment_id text,
  expected_event_id text default null
)
returns table (item_id text, user_id uuid, already_refunded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  was_refunded boolean;
begin
  select p.* into payment_row
    from public.payments p
   where p.id = target_payment
   for update;

  if not found then raise exception 'payment_not_found'; end if;
  if payment_row.gateway <> 'nalpay' then raise exception 'invalid_gateway'; end if;
  if payment_row.gateway_order_id <> expected_link_id then
    raise exception 'payment_link_mismatch';
  end if;
  if payment_row.gateway_payment_id is not null
     and payment_row.gateway_payment_id <> expected_payment_id then
    raise exception 'gateway_payment_mismatch';
  end if;

  if expected_event_id is not null then
    insert into public.payment_webhook_deliveries (
      gateway, event_id, event_type, gateway_payment_id, payment_id
    ) values (
      'nalpay', expected_event_id, 'payment_refunded', expected_payment_id,
      payment_row.id
    ) on conflict do nothing;
  end if;

  was_refunded := payment_row.status = 'refunded';
  if was_refunded then
    return query select payment_row.item_id, payment_row.user_id, true;
    return;
  end if;
  if payment_row.status not in (
    'creating', 'pending', 'failed', 'canceled', 'completed'
  ) then
    raise exception 'invalid_payment_status';
  end if;

  update public.payments p
     set status = 'refunded',
         gateway_payment_id = coalesce(p.gateway_payment_id, expected_payment_id),
         refunded_at = now(),
         verified_at = coalesce(p.verified_at, now()),
         updated_at = now()
   where p.id = payment_row.id;

  insert into public.user_entitlements (id)
  values (payment_row.user_id)
  on conflict (id) do nothing;

  update public.user_entitlements e
     set has_all_access = exists (
           select 1 from public.payments p
            where p.user_id = payment_row.user_id
              and p.status = 'completed'
              and p.item_id = 'all_access'
         ),
         has_base_game = exists (
           select 1 from public.payments p
            where p.user_id = payment_row.user_id
              and p.status = 'completed'
              and p.item_id in ('base_game', 'all_access')
         ),
         owned_items = coalesce((
           select array_agg(distinct p.item_id)
             from public.payments p
            where p.user_id = payment_row.user_id
              and p.status = 'completed'
              and p.item_id in (
                'role_wizard', 'role_madman', 'role_avenger',
                'role_twins', 'role_sniper'
              )
         ), '{}'),
         updated_at = now()
   where e.id = payment_row.user_id;

  return query select payment_row.item_id, payment_row.user_id, false;
end;
$$;

revoke all on function public.refund_verified_nalpay_payment(
  uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.refund_verified_nalpay_payment(
  uuid, text, text, text
) to service_role;
