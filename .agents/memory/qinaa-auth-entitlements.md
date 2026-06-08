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

## Security boundary (current model: direct client update, no RPC)
**Rule:** On explicit user instruction (2026-06-08) `games_played` is now bumped
by a DIRECT client update (`incrementGamesPlayed`: read current `games_played`,
+1, `update(...).eq("id", uid)`) — NO RPC, no custom DB functions/triggers. This
requires an RLS UPDATE policy. Paid flags stay protected via a COLUMN-LEVEL grant:
`grant update (games_played) ... to authenticated` (after `revoke update`), so the
client can write only `games_played`, never `has_base_game`/`has_all_access`.
Insert policy still forces `games_played = 0`; table has `check (games_played >= 0)`.
**Why:** The user's DB never had the SECURITY DEFINER RPC, so the RPC-based bump
silently failed. They chose direct updates over fixing the RPC.
**Tradeoff (informed-consent, flagged to user):** A client can set its OWN
`games_played` to any non-negative value (e.g. reset to 0) → metering integrity is
NOT enforceable with pure client writes. The only real fixes (atomic SECURITY
DEFINER RPC, or a BEFORE UPDATE trigger blocking decreases) were declined ("no
RPC/functions"). Paid-flag self-granting IS still prevented by the column grant.
**How to apply:** Do NOT add a client UPDATE policy that covers the paid-flag
columns. If metering abuse ever matters, revisit the no-RPC constraint.

## Gameplay guardrails (do NOT touch)
Fisher-Yates shuffle, audio, voting math, Tajawal font, timers, role selections,
night-phase logic. Online multiplayer mode is intentionally hidden behind
`{false && ...}` and carries 7 pre-existing baseline TS errors (online-mode
`isHost`/`isAlive`/`ReactNode`) that are expected — the typecheck bar is
"still exactly 7", not "zero".
