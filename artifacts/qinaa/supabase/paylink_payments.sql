-- ==========================================================================
-- القناع — Paylink payment intents and atomic fulfillment
-- Safe to run more than once on the existing Supabase project.
-- Existing payment rows are preserved.
-- ==========================================================================

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

-- A Paylink transaction number exists only after addInvoice succeeds.
alter table public.payments alter column gateway_order_id drop not null;

-- Link payments directly to auth.users so account deletion cascades even when
-- a legacy profile row is missing. NOT VALID preserves any historical orphan
-- rows while enforcing the relationship for all new writes.
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

-- Completes a verified Paylink payment and grants its exact entitlement in one
-- database transaction. Safe to call repeatedly from both callback and webhook.
create or replace function public.complete_verified_paylink_payment(
  target_payment uuid,
  expected_transaction_no text,
  expected_amount integer,
  expected_currency text
)
returns table (
  item_id text,
  user_id uuid,
  already_completed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  was_completed boolean;
begin
  select p.*
    into payment_row
    from public.payments p
   where p.id = target_payment
   for update;

  if not found then
    raise exception 'payment_not_found';
  end if;
  if payment_row.gateway <> 'paylink' then
    raise exception 'invalid_gateway';
  end if;
  if payment_row.gateway_order_id is not null
     and payment_row.gateway_order_id <> expected_transaction_no then
    raise exception 'transaction_mismatch';
  end if;
  if payment_row.amount <> expected_amount then
    raise exception 'amount_mismatch';
  end if;
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
    return query
      select payment_row.item_id, payment_row.user_id, true;
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

  return query
    select payment_row.item_id, payment_row.user_id, false;
end;
$$;

revoke all on function public.complete_verified_paylink_payment(
  uuid, text, integer, text
) from public, anon, authenticated;
grant execute on function public.complete_verified_paylink_payment(
  uuid, text, integer, text
) to service_role;
