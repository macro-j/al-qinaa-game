---
name: Qinaa auth + entitlement gating
description: How the Supabase auth/entitlement wrapper around the Qinaa game is designed and the rules that keep it safe.
---

# Qinaa auth + entitlement gating

The Qinaa SPA (`artifacts/qinaa`) is wrapped with Supabase auth + a 2-free-game
entitlement gate. Auth/entitlement code lives in `src/lib/auth.tsx`,
`src/lib/supabase.ts`, `src/lib/shop.tsx`; gameplay is in `src/App.tsx`.

## Gate must be fail-CLOSED
**Rule:** `canStartGame` is only `true` when entitlements have actually loaded
and permit play. While entitlements are `null` (loading OR fetch/insert error)
the gate stays closed.
**Why:** An earlier version was fail-open (`!entitlements ? true : ...`) and on
error set `DEFAULT_ENTITLEMENTS`, which let a user slip past the free-game limit
during the fetch or whenever the backend failed. Code review caught this.
**How to apply:** Never grant a trial on backend failure. The app gate only
waits on `authLoading`, not entitlement load, so the start-game check itself
must be the thing that blocks until entitlements are trustworthy.

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
