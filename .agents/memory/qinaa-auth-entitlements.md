---
name: Qinaa auth + entitlement gating
description: How the Supabase auth/entitlement wrapper around the Qinaa game is designed and the rules that keep it safe.
---

# Qinaa auth + entitlement gating

The Qinaa SPA (`artifacts/qinaa`) is wrapped with Supabase auth + a 2-free-game
entitlement gate. Auth/entitlement code lives in `src/lib/auth.tsx`,
`src/lib/supabase.ts`, `src/lib/shop.tsx`; gameplay is in `src/App.tsx`.

## Entitlement load is now fail-SAFE (was fail-closed)
**Rule:** `loadEntitlements` (`src/lib/auth.tsx`) must NEVER leave `entitlements`
as `null` after it finishes. On any error path — query error, insert error, or a
thrown exception — it sets `DEFAULT_ENTITLEMENTS` (0 games, no purchases) and
clears loading in a `finally`. `canStartGame` still stays closed only while
`entitlements === null` (i.e. genuinely mid-fetch).
**Why:** The UI shows `entitlements === null` as a permanent "verifying account"
(جارٍ التحقق من الحساب) state, so the old fail-CLOSED design (leave `null` on
error) hung the whole app forever whenever the backend failed — most commonly
when the `user_entitlements` table / RLS / RPC schema had not been applied in the
Supabase project. The user explicitly chose "never hang" over "never grant a
trial on failure" on 2026-06-06.
**Tradeoff to remember:** This is fail-OPEN. Any backend failure now grants the
2-free-game trial (0 < FREE_GAME_LIMIT). If `increment_games_played` also fails
(e.g. schema missing) the count never persists → effectively unlimited free
games. The real fix for production is to apply `supabase/schema.sql` so the happy
path works; the fail-safe is only a guard against hanging.
**How to apply:** Keep the no-hang guarantee. If monetization tightening is ever
requested, do it by making the schema reliable + server-verified paid flags, NOT
by reverting to leaving `entitlements` null on error.

## Single chokepoint
**Rule:** The only place a new narrator round is gated is `handleDistribute` in
NarratorMode. Game completion is counted by a ref-guarded effect watching
`phase === "game_over"`, with the ref initialized from the hydrated phase so a
refresh on the game-over screen never double-counts; it resets on `phase ===
"setup"`.
**How to apply:** If you add another way to start a round, gate it too. Don't add
a second increment site — the phase effect already owns counting.

## Stale-response guard
Entitlement fetches compare against `activeUidRef` before calling setState, and
entitlements are cleared on user switch, so a response for a signed-out/switched
account can't overwrite the current user's state.

## Live table is keyed on `id`, NOT `user_id`
**Rule:** The production `user_entitlements` table uses `id uuid primary key`
(= the auth user's uuid) as the user key — there is NO `user_id` column. All
client queries (select/insert/update) in `src/lib/auth.tsx` must key on `id`.
**Why:** The original repo schema used `user_id`; the user's live table was
created with `id`. The mismatch made every read/insert error out → fail-safe
defaulted to 0 games → counter looked permanently "stuck at 2", and the
`increment_games_played` RPC didn't exist in their DB either. Discovered
2026-06-08.
**How to apply:** Keep code and `supabase/schema.sql` both keyed on `id`.

## Security boundary (current model: SECURITY DEFINER RPC)
**Rule:** `games_played` is bumped ONLY via `supabase.rpc("increment_games_played")`
— a SECURITY DEFINER function scoped to `auth.uid()` (= the `id` column) that does
insert-on-conflict. The client has NO direct UPDATE privilege (revoked from
`authenticated`) and NO UPDATE RLS policy. Client may READ its own row and INSERT
only the all-false/zero default row. Paid flags (`has_base_game`/`has_all_access`)
are server-only via the service-role key after verified payment. Table keeps
`check (games_played >= 0)`; insert policy forces `games_played = 0`.
**Why:** A brief 2026-06-08 experiment used direct client `.update()` (with a
column-level grant) because the user's DB lacked the RPC — but that let a user
reset their own counter, so there was no metering integrity. Same day, the user
created the secure RPC + revoked client UPDATE, and we reverted to the RPC call.
**How to apply:** Keep the increment as the RPC call. Do NOT reintroduce a client
UPDATE policy/privilege or a direct `.update()` on user_entitlements. Exactly-once
counting is still owned by the `phase === "game_over"` ref-guarded effect — don't
add a second increment site.

## Gameplay guardrails (do NOT touch)
Fisher-Yates shuffle, audio, voting math, Tajawal font, timers, role selections,
night-phase logic. Online multiplayer mode is intentionally hidden behind
`{false && ...}` and carries 7 pre-existing baseline TS errors (online-mode
`isHost`/`isAlive`/`ReactNode`) that are expected — the typecheck bar is
"still exactly 7", not "zero".
