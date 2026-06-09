---
name: qinaa entitlements & freemium gates
description: How per-role ownership works in qinaa and the non-obvious id naming mismatch
---

# qinaa entitlements model

Source of truth is Supabase `public.user_entitlements` (see `artifacts/qinaa/supabase/schema.sql`):
`games_played`, `has_base_game`, `has_all_access`, and **`owned_items text[]`** (a-la-carte role purchases).

**Gate rule for any single role add-on:** `owned = has_all_access || owned_items.includes(<item_id>)`.
All-Access cascades to everything; base_game/all_access are tracked by the booleans, only `role_*`
items land in `owned_items` (enforced server-side in the `grant_specific_entitlement` RPC).

**Non-obvious id mismatch (easy to get wrong):** the in-game expansion-mod logic ids differ from
the store/catalog/owned_items ids. The magician is the worst trap:
- `magician` (logic id, الساحر)  → store id **`role_wizard`**
- `madman` → `role_madman`, `twins` → `role_twins`, `avenger` → `role_avenger`
There is a `MOD_TO_ITEM` map in `App.tsx` for this — use it, don't assume `role_<modid>`.

**Why this bites:** the DB had `owned_items` and the server already granted into it, but the CLIENT
auth layer historically did NOT select/read it, so any per-role UI gate silently saw an empty list.
If adding a new freemium gate, confirm `owned_items` is in the `Entitlements` type AND in every
`.select()` / insert / setEntitlements path in `lib/auth.tsx`.

**How to apply:** entitlements can be `null` while loading — gates must fail-closed (treat as not
owned / locked) and ideally disable buy CTAs while `entitlementsLoading`. Never gate gameplay engine
logic (shuffle/deck/voting/timers/night); gate only setup UI + sanitize `activeMods` by ownership.

# Deferred-auth gating (client routing)

qinaa uses **deferred auth**: the dashboard (GameModeSelector) is public; gated
actions (Council/narrator mode, Shop) intercept guests into the AuthModal.

**Trap:** `selectedMode` is hydrated from localStorage (`qinaa_selected_mode`) and
drives top-level routing in App. Gating ONLY the dashboard buttons is insufficient —
a signed-out user with a stale/ tampered persisted mode routes straight into
NarratorMode (and its internal openShop calls) without ever passing the button gate.

**Rule:** any auth/entitlement gate on a persisted-state-driven route must ALSO be
enforced at the route decision point, not just on the button. Fix used: route gate
`if (selectedMode === null || !user) return <GameModeSelector/>` + an effect that
clears mode/narrator state once auth resolves to no-user (guarded on !authLoading so
a legit user's persisted mode survives the initial check).
