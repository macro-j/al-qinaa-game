-- Idempotent free-game settlement.
-- Apply once in Supabase before deploying the matching web client.

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

  -- Serialize settlements per user, then identify retries by the game UUID.
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
