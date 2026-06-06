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

## Security boundary (must keep)
Client may READ its own row and INSERT only the all-false/zero default row. There
is deliberately **no client UPDATE policy**. `games_played` is bumped via the
`increment_games_played` SECURITY DEFINER RPC scoped to `auth.uid()`. Paid flags
(`has_base_game`, `has_all_access`) must be set server-side with the service-role
key after a verified payment — never trust the client to self-grant. Schema +
RLS + RPC live in `artifacts/qinaa/supabase/schema.sql`.

## Gameplay guardrails (do NOT touch)
Fisher-Yates shuffle, audio, voting math, Tajawal font, timers, role selections,
night-phase logic. Online multiplayer mode is intentionally hidden behind
`{false && ...}` and carries 7 pre-existing baseline TS errors (online-mode
`isHost`/`isAlive`/`ReactNode`) that are expected — the typecheck bar is
"still exactly 7", not "zero".
