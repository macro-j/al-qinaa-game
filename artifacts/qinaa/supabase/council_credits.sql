-- ==========================================================================
-- القناع — consumable council credits + permanently owned masks
-- Apply once before deploying the matching API/frontend release.
-- ==========================================================================

alter table public.user_entitlements
  add column if not exists game_credits integer not null default 2
  check (game_credits >= 0);

alter table public.payments
  add column if not exists credits_granted integer not null default 0
  check (credits_granted >= 0);
alter table public.payments
  add column if not exists roles_granted text[] not null default '{}';

-- Record the reset as a migration so re-running the schema never resets a
-- customer's later purchases. There are no live purchasers at this launch.
create table if not exists public.qinaa_schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);
alter table public.qinaa_schema_migrations enable row level security;
revoke all on public.qinaa_schema_migrations from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from public.qinaa_schema_migrations
     where id = '2026-09-25-council-credits-v1'
  ) then
    update public.user_entitlements
       set game_credits = 2,
           games_played = 0,
           consumed_game_ids = '{}',
           has_base_game = false,
           has_all_access = false,
           owned_items = '{}',
           updated_at = now();
    insert into public.qinaa_schema_migrations (id)
    values ('2026-09-25-council-credits-v1');
  end if;
end;
$$;

drop policy if exists "insert own entitlements" on public.user_entitlements;
create policy "insert own entitlements"
  on public.user_entitlements
  for insert
  with check (
    auth.uid() = id
    and game_credits = 2
    and games_played = 0
    and has_base_game = false
    and has_all_access = false
    and owned_items = '{}'
  );

-- One stable game id may consume at most one council. The row lock prevents
-- two tabs/devices from spending the final credit simultaneously.
create or replace function public.consume_game_credit(target_game_id uuid)
returns table (status text, game_credits integer, games_played integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  current_credits integer;
  current_games integer;
  is_duplicate boolean;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  if target_game_id is null then raise exception 'invalid_game_id'; end if;

  insert into public.user_entitlements (id)
  values (caller_id)
  on conflict (id) do nothing;

  select e.game_credits,
         e.games_played,
         target_game_id = any(e.consumed_game_ids)
    into current_credits, current_games, is_duplicate
    from public.user_entitlements e
   where e.id = caller_id
   for update;

  if is_duplicate then
    return query select 'already_consumed'::text, current_credits, current_games;
    return;
  end if;
  if current_credits <= 0 then
    return query select 'limit_reached'::text, current_credits, current_games;
    return;
  end if;

  update public.user_entitlements e
     set game_credits = e.game_credits - 1,
         games_played = e.games_played + 1,
         consumed_game_ids = array_append(e.consumed_game_ids, target_game_id),
         updated_at = now()
   where e.id = caller_id
   returning e.game_credits, e.games_played
        into current_credits, current_games;

  return query select 'consumed'::text, current_credits, current_games;
end;
$$;

revoke all on function public.consume_game_credit(uuid) from public, anon;
grant execute on function public.consume_game_credit(uuid) to authenticated;

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
    'councils_5', 'councils_15', 'councils_40',
    'roles_bundle', 'full_bundle', 'role_wizard', 'role_madman',
    'role_avenger', 'role_twins', 'role_sniper'
  ) then raise exception 'invalid_item'; end if;
  if payment_row.credits_granted < 0 then raise exception 'invalid_credit_grant'; end if;
  if exists (
    select 1 from unnest(payment_row.roles_granted) role_id
     where role_id not in (
       'role_wizard', 'role_madman', 'role_avenger', 'role_twins', 'role_sniper'
     )
  ) then raise exception 'invalid_role_grant'; end if;

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
     set game_credits = e.game_credits + payment_row.credits_granted,
         owned_items = coalesce((
           select array_agg(distinct role_id order by role_id)
             from unnest(coalesce(e.owned_items, '{}') || payment_row.roles_granted) role_id
         ), '{}'),
         has_base_game = false,
         has_all_access = false,
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
  if payment_row.status not in ('creating', 'pending', 'failed', 'canceled', 'completed') then
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
     set game_credits = greatest(0, e.game_credits - payment_row.credits_granted),
         owned_items = coalesce((
           select array_agg(distinct role_id order by role_id)
             from public.payments p
             cross join lateral unnest(p.roles_granted) role_id
            where p.user_id = payment_row.user_id
              and p.status = 'completed'
         ), '{}'),
         has_base_game = false,
         has_all_access = false,
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
