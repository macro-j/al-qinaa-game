-- ==========================================================================
-- القناع — NalPay payment fields, signed webhook ledger, and atomic fulfillment
-- Safe to run more than once on the existing Supabase project.
-- Apply this file before deploying the NalPay API routes.
-- ==========================================================================

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
